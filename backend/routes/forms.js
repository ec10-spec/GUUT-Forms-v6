import { Router } from "express";
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

const router = Router();

// Only these keys can be set by a client. Everything else (ownerId,
// publishedAt, ...) is controlled by the server.
const EDITABLE = ["title", "description", "fields", "theme", "isPublic", "source", "generationPrompt"];
const pick = (body) => Object.fromEntries(EDITABLE.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));

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
  await assertStorageRoom(req.company, formSize(pick(req.body)));
  const form = await req.tenant.Form.create({ ...pick(req.body), ownerId: req.userId, publishedAt: null });
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
  if (mine) { out.myAccess = access; out.listingStatus = peek?.listing?.status || "none"; }
  else delete out.ownerId;
  res.json(out);
});

router.put("/:id", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req.params.id);
  const access = assertAccess(req, idx, canEdit, "You have view-only access to this form.");
  const body = pick(req.body);
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
    fields: plain.fields, theme: plain.theme, source: "manual", generationPrompt: null, isPublic: false, publishedAt: null,
  });
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
  await bumpStorage(idx.companyId, -freed);
  await idx.deleteOne();
  logger.info("form", `Form deleted: ${idx.title}`, { req, meta: { formId: req.params.id } });
  res.status(204).end();
});

export default router;
