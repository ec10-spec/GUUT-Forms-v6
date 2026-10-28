import express, { Router } from "express";
import mongoose from "mongoose";
import FormIndex, { syncIndex } from "../models/FormIndex.js";
import User from "../models/User.js";
import { requireAuth, withTenant, tenantForCompanyId, isAdminOf } from "../middleware/auth.js";
import { accessOf, canView, canEdit, canManage } from "../utils/access.js";
import { notifyFormCreated, notifyListingRequest } from "../utils/notify.js";
import { assertCanCreateForm } from "../utils/plans.js";
import Company from "../models/Company.js";
import { assertStorageRoom, bumpStorage, formSize, formStats, recordFormSize } from "../utils/storage.js";
import { httpError, escapeRegex } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import { sanitizeFields, sanitizeTheme, publicView } from "../utils/formRules.js";
import { MAX_HEADER_BYTES, sniffOk, writeFile, findFile, streamFile, deleteFiles, bucket, oid } from "../utils/uploads.js";

const router = Router();

// Only these keys can be set by a client. Everything else (ownerId,
// publishedAt, ...) is controlled by the server.
const EDITABLE = ["title", "description", "fields", "theme", "isPublic", "source", "generationPrompt"];
const pickRaw = (body) => Object.fromEntries(EDITABLE.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));
/** Client-editable keys, with the questions' logic and the theme checked. */
function pick(body, { formId = null, previousTheme = null } = {}) {
  const out = pickRaw(body);
  if (out.fields !== undefined) out.fields = sanitizeFields(out.fields);
  if (out.theme !== undefined) out.theme = sanitizeTheme(out.theme, { formId, previous: previousTheme?.headerImage ?? null });
  return out;
}

// Finds a form's directory entry and the database it lives in.
async function locate(id, opts) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw httpError(404, "Form not found");
  const idx = await FormIndex.findById(id);
  if (!idx) throw httpError(404, "Form not found");
  return { idx, tenant: await tenantForCompanyId(idx.companyId, opts) };
}

// Requires the given permission level on this form. People with no access at all
// get the same "not found" as a form that doesn't exist.
function assertAccess(req, idx, check, message) {
  const access = accessOf(req, idx);
  if (!access) throw httpError(403, "You don't have access to this form.");
  if (!check(access)) throw httpError(403, message || "You don't have permission to do that.");
  return access;
}

const withAccess = (doc, access) => ({ ...(doc.toObject ? doc.toObject() : doc), myAccess: access });

// Create a form in the caller's company database.
router.post("/", requireAuth, withTenant, async (req, res) => {
  await assertCanCreateForm(req.company, req.tenant, req.userId, FormIndex);
  const body = pick(req.body);
  await assertStorageRoom(req.company, formSize(body));
  const form = await req.tenant.Form.create({ ...body, ownerId: req.userId, publishedAt: null });
  try {
    await syncIndex(form, req.user.companyId);
  } catch (err) {
    await req.tenant.Form.findByIdAndDelete(form._id).catch(() => {});
    throw err;
  }
  await recordFormSize(req.tenant, req.user.companyId, form);
  logger.info("form", `Form created: ${form.title}`, { req, meta: { formId: form._id, db: req.tenant.mode } });
  notifyFormCreated({ form, companyId: req.user.companyId, creator: req.user });
  res.status(201).json(withAccess(form, "owner"));
});

// The caller's forms: ones they own, ones shared with them, and (for company
// admins) every form in the company.
router.get("/", requireAuth, withTenant, async (req, res) => {
  const teamIds = [...(req.teamIds || [])];
  const isAdmin = req.user.role === "admin";
  const ownerIdOf = new Map();
  const shared = new Map(); // formId -> role, for forms shared with me
  const listingOf = new Map();
  const note = (i) => { ownerIdOf.set(String(i._id), i.ownerId); listingOf.set(String(i._id), i.listing?.status || "none"); };

  // 1) Forms in my own workspace (and database).
  const ownFilter = isAdmin
    ? { companyId: req.user.companyId }
    : { companyId: req.user.companyId, $or: [{ ownerId: req.userId }, { "collaborators.userId": req.userId }, ...(teamIds.length ? [{ "teamShares.teamId": { $in: teamIds } }] : [])] };
  const own = await FormIndex.find(ownFilter).select("ownerId companyId collaborators teamShares listing");
  for (const i of own) {
    note(i);
    const role = accessOf(req, i);
    if (i.ownerId !== req.userId && role) shared.set(String(i._id), role);
  }
  const titleFilter = req.query.q ? { title: { $regex: escapeRegex(req.query.q), $options: "i" } } : {};
  let forms = (await req.tenant.Form.find({ _id: { $in: own.map((i) => i._id) }, ...titleFilter }).sort({ updatedAt: -1 })).map((f) => f.toObject());

  // 2) Forms an individual shared with me (directly or through an open team). They live in that person's
  // storage, which can be a different database from mine, so each is read from its own database.
  const outside = await FormIndex.find({
    companyId: { $ne: req.user.companyId },
    $or: [{ "collaborators.userId": req.userId }, ...(teamIds.length ? [{ "teamShares.teamId": { $in: teamIds } }] : [])],
  }).select("ownerId companyId collaborators teamShares listing");
  const byCompany = new Map();
  for (const i of outside) {
    const role = accessOf(req, i);
    if (!role) continue;
    note(i); shared.set(String(i._id), role);
    byCompany.set(String(i.companyId), [...(byCompany.get(String(i.companyId)) || []), i._id]);
  }
  for (const [companyId, ids] of byCompany) {
    try {
      const t = await tenantForCompanyId(companyId);
      forms.push(...(await t.Form.find({ _id: { $in: ids }, ...titleFilter })).map((f) => f.toObject()));
    } catch { /* that person's storage is unreachable right now: skip it */ }
  }
  forms.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const otherOwners = [...new Set([...ownerIdOf.values()].filter((o) => o !== req.userId && mongoose.isValidObjectId(o)))];
  const owners = new Map((await User.find({ _id: { $in: otherOwners } }).select("name email")).map((u) => [String(u._id), u.name || u.email]));
  res.json(forms.map((f) => {
    const owner = ownerIdOf.get(String(f._id)) ?? f.ownerId;
    const myAccess = owner === req.userId ? "owner" : shared.get(String(f._id)) || (isAdmin ? "admin" : null);
    return { ...f, myAccess, ownerName: owner === req.userId ? null : owners.get(owner) || null, listingStatus: listingOf.get(String(f._id)) || "none" };
  }));
});

// Public repository, served from the platform directory (no customer DB hit).
// Declared before "/:id".
router.get("/public", async (req, res) => {
  const filter = { isPublic: true, publishedAt: { $ne: null } };
  if (req.query.q) filter.title = { $regex: escapeRegex(req.query.q), $options: "i" };
  res.json(await FormIndex.find(filter).select("title description fieldCount publishedAt").sort({ publishedAt: -1 }).limit(100));
});

// Fetch one form. Published forms are public (that's what a share link opens);
// drafts are visible only to people with access (owner, collaborators, company admin).
router.get("/:id", async (req, res) => {
  const peek = await FormIndex.findById(/^[a-f\d]{24}$/i.test(req.params.id) ? req.params.id : null);
  const access = peek ? accessOf(req, peek) : null;
  const mine = canView(access);
  if (peek && !peek.publishedAt && !mine) throw httpError(404, "Form not found");
  req.logCompanyId = peek?.companyId;
  const { tenant } = await locate(req.params.id, { publicFacing: !mine });
  const form = await tenant.Form.findById(req.params.id);
  if (!form) throw httpError(404, "Form not found");
  const out = form.toObject();
  // Paid (business) plans remove the "Made with GUUT Forms" footer from their public forms.
  out.hideBranding = (await Company.findById(peek?.companyId || undefined).select("type").lean())?.type === "business";
  if (mine) { out.myAccess = access; out.listingStatus = peek?.listing?.status || "none"; return res.json(out); }
  // Respondents get only what they need to fill the form in: no owner, prompt or internal fields.
  res.json(publicView(out));
});

router.put("/:id", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  const access = assertAccess(req, idx, canEdit, "You have view-only access to this form.");
  const current = await tenant.Form.findById(req.params.id).select("theme").lean();
  const body = pick(req.body, { formId: req.params.id, previousTheme: current?.theme });
  const company = await Company.findById(idx.companyId);
  // Listing a form in the public repository is the owner's/admin's call, not an editor's.
  if (body.isPublic !== undefined && !!body.isPublic !== !!idx.isPublic && !canManage(access)) {
    throw httpError(403, "Only the owner or a company admin can change whether this form is listed publicly.");
  }
  // Business forms need a company admin's approval before they appear in the public repository.
  // Until then the form stays unlisted and the request waits under Approvals.
  let askedApproval = false;
  if (body.isPublic !== undefined) {
    const wants = !!body.isPublic;
    if (!wants) {
      idx.listing = { status: "none", requestedBy: null, requestedAt: null, decidedBy: null };
    } else if (company?.type === "business" && !isAdminOf(req, idx.companyId)) {
      if (!idx.isPublic) {
        askedApproval = idx.listing?.status !== "pending";
        idx.listing = { status: "pending", requestedBy: req.userId, requestedAt: idx.listing?.status === "pending" ? idx.listing.requestedAt : new Date(), decidedBy: null };
        body.isPublic = false;
      }
    } else if (company?.type === "business") {
      idx.listing = { status: "approved", requestedBy: idx.listing?.requestedBy || null, requestedAt: idx.listing?.requestedAt || null, decidedBy: req.userId };
    }
    await idx.save();
  }
  const before = await tenant.Form.findById(req.params.id).select("sizeBytes").lean();
  await assertStorageRoom(company, formSize(body) - (before?.sizeBytes || 0));
  const updated = await tenant.Form.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!updated) throw httpError(404, "Form not found");
  await syncIndex(updated, idx.companyId);
  await recordFormSize(tenant, idx.companyId, updated, before?.sizeBytes || 0);
  if (askedApproval) notifyListingRequest({ company, requester: req.user, title: updated.title });
  res.json({ ...withAccess(updated, access), listingStatus: idx.listing?.status || "none" });
});

router.post("/:id/publish", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  const access = assertAccess(req, idx, canEdit, "You have view-only access to this form.");
  const updated = await tenant.Form.findByIdAndUpdate(req.params.id, { publishedAt: new Date() }, { new: true });
  if (!updated) throw httpError(404, "Form not found");
  await syncIndex(updated, idx.companyId);
  logger.info("form", `Form published: ${updated.title}`, { req, meta: { formId: updated._id } });
  res.json(withAccess(updated, access));
});

// "Save as template": copies a form into the caller's own company database.
// Allowed for forms the caller can open, or published forms their owner made public.
router.post("/:id/duplicate", requireAuth, withTenant, async (req, res) => {
  await assertCanCreateForm(req.company, req.tenant, req.userId, FormIndex);
  const { idx, tenant: sourceTenant } = await locate(req.params.id, { publicFacing: true });
  const mine = canView(accessOf(req, idx));
  if (!mine && !(idx.isPublic && idx.publishedAt)) throw httpError(403, "This form isn't public, so it can't be saved as a template.");
  const source = await sourceTenant.Form.findById(req.params.id);
  if (!source) throw httpError(404, "Form not found");
  const plain = source.toObject();
  await assertStorageRoom(req.company, formSize(plain));
  const copy = await req.tenant.Form.create({
    title: `${plain.title} (copy)`, description: plain.description, ownerId: req.userId,
    fields: plain.fields, theme: { ...plain.theme, headerImage: null }, source: "manual", generationPrompt: null, isPublic: false, publishedAt: null,
  });
  // The header image belongs to the source form, so the copy gets its own copy of the file.
  const m = /\/header-image\/([a-f\d]{24})$/i.exec(plain.theme?.headerImage || "");
  const asset = m ? await findFile(sourceTenant, "assets", m[1]) : null;
  if (asset && asset.metadata?.formId === String(source._id)) {
    const chunks = [];
    await new Promise((resolve, reject) => bucket(sourceTenant, "assets").openDownloadStream(asset._id).on("data", (c) => chunks.push(c)).on("error", reject).on("end", resolve));
    const newId = await writeFile(req.tenant, "assets", { filename: asset.filename, contentType: asset.contentType, buffer: Buffer.concat(chunks), metadata: { formId: String(copy._id), kind: "header", contentType: asset.contentType } });
    copy.theme.headerImage = `/api/forms/${copy._id}/header-image/${newId}`;
    await copy.save();
    await bumpStorage(req.user.companyId, asset.length);
  }
  await syncIndex(copy, req.user.companyId);
  await recordFormSize(req.tenant, req.user.companyId, copy);
  notifyFormCreated({ form: copy, companyId: req.user.companyId, creator: req.user });
  res.status(201).json(withAccess(copy, "owner"));
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  assertAccess(req, idx, canManage, "Only the owner or a company admin can delete this form.");
  const freed = (await formStats(tenant, [idx._id])).get(String(idx._id))?.bytes || 0;
  await tenant.Form.findByIdAndDelete(req.params.id);
  await tenant.Submission.deleteMany({ formId: req.params.id });
  await tenant.AnalysisChat.deleteMany({ formId: req.params.id }).catch(() => {});
  for (const b of ["uploads", "assets"]) await deleteFiles(tenant, b, { "metadata.formId": String(req.params.id) }).catch(() => {});
  await bumpStorage(idx.companyId, -freed);
  await idx.deleteOne();
  logger.info("form", `Form deleted: ${idx.title}`, { req, meta: { formId: req.params.id } });
  res.status(204).end();
});

// ---- Header images. Stored as files next to the form (not inside it) and served by URL, so a public form
// loads a few KB of JSON instead of an embedded image. The builder resizes to 1600px wide and compresses
// before uploading; the server enforces the type and a 2 MB cap.
const HEADER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const rawImage = express.raw({ type: () => true, limit: "3mb" });

router.post("/:id/header-image", requireAuth, rawImage, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  const access = assertAccess(req, idx, canEdit, "You have view-only access to this form.");
  const type = String(req.header("content-type") || "").split(";")[0].trim().toLowerCase();
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!HEADER_TYPES.has(type)) throw httpError(400, "Header images must be JPEG, PNG or WebP.", { code: "FILE_TYPE" });
  if (!buffer.length) throw httpError(400, "That image is empty.");
  if (buffer.length > MAX_HEADER_BYTES) throw httpError(413, "That image is larger than 2 MB. Use a smaller image (1600 x 400 works best).", { code: "FILE_TOO_LARGE" });
  if (!sniffOk(type, buffer)) throw httpError(400, "That file isn't a valid image.", { code: "FILE_TYPE" });
  const company = await Company.findById(idx.companyId);
  await assertStorageRoom(company, buffer.length);
  const form = await tenant.Form.findById(idx._id);
  if (!form) throw httpError(404, "Form not found");
  const id = await writeFile(tenant, "assets", { filename: `header-${idx._id}`, contentType: type, buffer, metadata: { formId: String(idx._id), kind: "header", contentType: type } });
  // Replace: remove older header files for this form.
  const { bytes } = await deleteFiles(tenant, "assets", { "metadata.formId": String(idx._id), "metadata.kind": "header", _id: { $ne: id } });
  const before = form.sizeBytes || 0;
  form.theme.headerImage = `/api/forms/${idx._id}/header-image/${id}`;
  await form.save();
  await syncIndex(form, idx.companyId);
  await recordFormSize(tenant, idx.companyId, form, before);
  await bumpStorage(idx.companyId, buffer.length - bytes);
  res.status(201).json({ headerImage: form.theme.headerImage, bytes: buffer.length, form: withAccess(form, access) });
});

router.delete("/:id/header-image", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  const access = assertAccess(req, idx, canEdit, "You have view-only access to this form.");
  const form = await tenant.Form.findById(idx._id);
  if (!form) throw httpError(404, "Form not found");
  const { bytes } = await deleteFiles(tenant, "assets", { "metadata.formId": String(idx._id), "metadata.kind": "header" });
  const before = form.sizeBytes || 0;
  form.theme.headerImage = null;
  await form.save();
  await recordFormSize(tenant, idx.companyId, form, before);
  await bumpStorage(idx.companyId, -bytes);
  res.json({ headerImage: null, form: withAccess(form, access) });
});

// Public: the image itself. The id changes on every upload, so it can be cached for a long time.
router.get("/:id/header-image/:assetId", async (req, res) => {
  const { idx, tenant } = await locate(req.params.id, { publicFacing: true });
  const file = await findFile(tenant, "assets", req.params.assetId);
  if (!file || file.metadata?.formId !== String(idx._id)) throw httpError(404, "Image not found");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  await streamFile(tenant, "assets", file, res);
});

export default router;
