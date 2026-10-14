import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FormIndex, { syncIndex } from "../models/FormIndex.js";
import Log from "../models/Log.js";
import { requireAuth, requireCompanyAdmin } from "../middleware/auth.js";
import { openVerifiedConnection, getTenant } from "../config/db.js";
import { linkDatabase, checkDatabase, normalizeUri } from "../utils/companyDb.js";
import { httpError } from "../utils/http.js";
import { uniqueJoinCode, formatJoinCode } from "../utils/joinCode.js";
import { BUSINESS_PLANS, planById, assertSeatAvailable } from "../utils/plans.js";
import { notifyJoinDecision, notifyListingDecision } from "../utils/notify.js";
import { ensureStorageKnown, recalculateStorage, storageLimitBytes } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

// Everything a COMPANY ADMIN can do, always scoped to their OWN company id taken
// from their session, never from the request, so one company can't touch another.
const router = Router();
router.use(requireAuth, requireCompanyAdmin);

async function myCompany(req) {
  const company = await Company.findById(req.user.companyId);
  if (!company) throw httpError(404, "Company not found");
  return company;
}

router.get("/", async (req, res) => {
  const company = await myCompany(req);
  const [users, forms] = await Promise.all([User.countDocuments({ companyId: company._id }), FormIndex.countDocuments({ companyId: company._id })]);
  res.json({ ...company.toJSON(), userCount: users, formCount: forms });
});

// --- database: paste a link, test it, save it
router.post("/database/test", async (req, res) => {
  const { conn, host, dbName } = await openVerifiedConnection(normalizeUri(req.body?.uri));
  await conn.close();
  res.json({ ok: true, host, dbName });
});

router.put("/database", async (req, res) => {
  res.json(await linkDatabase({ company: await myCompany(req), rawUri: req.body?.uri, migrate: req.body?.migrate, req }));
});

router.post("/database/check", async (req, res) => {
  const company = await myCompany(req);
  if (!company.customUriEncrypted) throw httpError(400, "No database linked yet.");
  res.json(await checkDatabase(company, req));
});

// --- team
router.get("/users", async (req, res) => {
  res.json(await User.find({ companyId: req.user.companyId }).sort({ createdAt: -1 }).limit(500));
});

router.post("/users", async (req, res) => {
  assertSeatAvailable(await myCompany(req), await User.countDocuments({ companyId: req.user.companyId }));
  const { email, name, password, role } = req.body || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) throw httpError(400, "A valid email is required.");
  if (typeof password !== "string" || password.length < 8) throw httpError(400, "Temporary password must be at least 8 characters.");
  if (await User.findOne({ email: email.toLowerCase() })) throw httpError(409, "An account with that email already exists.");
  const user = await User.create({
    email: email.toLowerCase(), name: String(name || "").trim().slice(0, 80),
    role: role === "admin" ? "admin" : "user", companyId: req.user.companyId,
    passwordHash: await bcrypt.hash(password, 10),
  });
  logger.info("admin", `Team member added: ${user.email} (${user.role})`, { req });
  res.status(201).json(user);
});

router.put("/users/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, "User not found");
  // Looked up by company too, so another company's users simply don't exist here.
  const user = await User.findOne({ _id: req.params.id, companyId: req.user.companyId });
  if (!user || user.role === "superadmin") throw httpError(404, "User not found");
  const { name, role, active, newPassword } = req.body || {};
  const self = String(user._id) === req.userId;
  if (self && ((role && role !== "admin") || active === false)) throw httpError(400, "You can't demote or disable your own account.");
  if (name !== undefined) user.name = String(name).trim().slice(0, 80);
  if (role !== undefined) {
    if (!["user", "admin"].includes(role)) throw httpError(400, "Invalid role.");
    user.role = role;
  }
  if (active !== undefined) user.active = !!active;
  if (newPassword !== undefined) {
    if (typeof newPassword !== "string" || newPassword.length < 8) throw httpError(400, "Password must be at least 8 characters.");
    user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  await user.save();
  logger.info("admin", `Team member updated: ${user.email}`, { req });
  res.json(user);
});

// --- employees joining with the company code
async function ensureJoinCode(company) {
  if (company.type === "business" && !company.joinCode) { company.joinCode = await uniqueJoinCode(); await company.save(); }
}

router.get("/join", async (req, res) => {
  const company = await myCompany(req);
  await ensureJoinCode(company);
  const pending = await User.find({ "membership.status": "pending", "membership.requestedCompanyId": company._id }).sort({ "membership.requestedAt": 1 }).limit(200).select("name email membership");
  res.json({
    code: formatJoinCode(company.joinCode), enabled: company.joinEnabled,
    requests: pending.map((u) => ({ _id: String(u._id), name: u.name, email: u.email, requestedAt: u.membership.requestedAt })),
  });
});

router.put("/join", async (req, res) => {
  const company = await myCompany(req);
  company.joinEnabled = !!req.body?.enabled;
  await company.save();
  res.json({ enabled: company.joinEnabled });
});

router.post("/join/regenerate", async (req, res) => {
  const company = await myCompany(req);
  company.joinCode = await uniqueJoinCode();
  await company.save();
  logger.info("admin", "Company join code regenerated", { req });
  res.json({ code: formatJoinCode(company.joinCode) });
});

async function decideJoin(req, res, approve) {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, "Request not found");
  const company = await myCompany(req);
  // Only people who asked for THIS company can be decided here.
  const user = await User.findOne({ _id: req.params.id, "membership.status": "pending", "membership.requestedCompanyId": company._id });
  if (!user) throw httpError(404, "That request no longer exists.");
  if (approve) {
    assertSeatAvailable(company, await User.countDocuments({ companyId: company._id }));
    const oldCompanyId = user.companyId;
    user.companyId = company._id;
    user.role = "user";
    // Someone who had an empty personal workspace leaves it behind.
    if (oldCompanyId && String(oldCompanyId) !== String(company._id)) {
      const old = await Company.findById(oldCompanyId);
      if (old?.type === "individual" && !(await FormIndex.exists({ companyId: old._id }))) await old.deleteOne();
    }
    user.membership = { status: "active", requestedCompanyId: null, requestedAt: null };
  } else {
    user.membership = { status: "declined", requestedCompanyId: null, requestedAt: null };
  }
  await user.save();
  logger.info("admin", `Join request ${approve ? "approved" : "declined"}: ${user.email}`, { req });
  notifyJoinDecision({ company, user, approved: approve });
  res.json({ ok: true });
}
router.post("/join/requests/:id/approve", (req, res) => decideJoin(req, res, true));
router.post("/join/requests/:id/deny", (req, res) => decideJoin(req, res, false));


// --- approvals: everything waiting for a company admin (people joining, forms to list publicly)
router.get("/approvals", async (req, res) => {
  const company = await myCompany(req);
  const pendingUsers = await User.find({ "membership.status": "pending", "membership.requestedCompanyId": company._id }).sort({ "membership.requestedAt": 1 }).limit(200).select("name email membership");
  const idxs = await FormIndex.find({ companyId: company._id, "listing.status": "pending" }).limit(200);
  let titles = new Map();
  if (idxs.length) {
    try {
      const tenant = await getTenant(company);
      titles = new Map((await tenant.Form.find({ _id: { $in: idxs.map((i) => i._id) } }).select("title description fields").lean()).map((f) => [String(f._id), f]));
    } catch { /* database unreachable: show requests without titles */ }
  }
  const people = new Map((await User.find({ _id: { $in: idxs.map((i) => i.listing.requestedBy).filter((x) => mongoose.isValidObjectId(x)) } }).select("name email")).map((u) => [String(u._id), u]));
  const joins = pendingUsers.map((u) => ({ _id: String(u._id), name: u.name, email: u.email, requestedAt: u.membership.requestedAt }));
  const listings = idxs.map((i) => {
    const f = titles.get(String(i._id));
    const who = people.get(i.listing.requestedBy);
    return { formId: String(i._id), title: f?.title || "Untitled form", description: f?.description || "", fieldCount: f?.fields?.length || 0, requestedBy: who ? { name: who.name || "", email: who.email } : null, requestedAt: i.listing.requestedAt };
  });
  res.json({ joins, listings, total: joins.length + listings.length });
});

async function decideListing(req, res, approve) {
  if (!/^[a-f\d]{24}$/i.test(req.params.formId)) throw httpError(404, "Request not found");
  const company = await myCompany(req);
  const idx = await FormIndex.findOne({ _id: req.params.formId, companyId: company._id, "listing.status": "pending" });
  if (!idx) throw httpError(404, "That request no longer exists.");
  const tenant = await getTenant(company);
  const form = await tenant.Form.findByIdAndUpdate(idx._id, { isPublic: approve }, { new: true });
  if (!form) throw httpError(404, "Form not found");
  const requesterId = idx.listing.requestedBy;
  idx.listing = { status: approve ? "approved" : "denied", requestedBy: requesterId, requestedAt: idx.listing.requestedAt, decidedBy: req.userId };
  await idx.save();
  await syncIndex(form, company._id);
  logger.info("admin", `Public listing ${approve ? "approved" : "declined"}: ${form.title}`, { req, meta: { formId: idx._id } });
  const requester = mongoose.isValidObjectId(requesterId) ? await User.findById(requesterId) : null;
  if (requester) notifyListingDecision({ user: requester, title: form.title, approved: approve });
  res.json({ ok: true });
}
router.post("/listings/:formId/approve", (req, res) => decideListing(req, res, true));
router.post("/listings/:formId/deny", (req, res) => decideListing(req, res, false));

// Re-measures stored data from scratch (corrects any drift in the running total).
router.post("/storage/recalculate", async (req, res) => {
  const company = await myCompany(req);
  res.json({ bytes: await recalculateStorage(company) });
});

// --- billing: shows the plan and tiers. No payment processor yet, so a plan change is a
// request that the platform team activates.
router.get("/billing", async (req, res) => {
  const company = await myCompany(req);
  const [seats, forms] = await Promise.all([User.countDocuments({ companyId: company._id }), FormIndex.countDocuments({ companyId: company._id })]);
  await ensureStorageKnown(company);
  res.json({
    plan: company.billing?.plan || null, requestedPlan: company.billing?.requestedPlan || null, status: company.billing?.status || "active",
    planDetails: planById(company.billing?.plan), plans: BUSINESS_PLANS,
    usage: { seats, forms, storageBytes: company.storage.bytes, storageLimitBytes: storageLimitBytes(company), ownDatabase: !!company.customUriEncrypted },
  });
});

router.put("/billing/plan-request", async (req, res) => {
  const company = await myCompany(req);
  if (!planById(req.body?.plan)) throw httpError(400, "Choose one of the plans.");
  company.billing.requestedPlan = req.body.plan;
  await company.save();
  logger.info("admin", `Plan change requested: ${req.body.plan}`, { req, meta: { companyId: company._id } });
  res.json({ ok: true, requestedPlan: company.billing.requestedPlan });
});

// --- problems with THIS company's forms (platform-wide issues go to us, not here)
router.get("/problems", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const filter = {
    companyId: String(req.user.companyId),
    $or: [
      { category: { $in: ["form", "db"] }, level: { $in: ["warn", "error"] } },
      { category: "user_report", "meta.topic": "form" },
      { category: "server_error" },
    ],
  };
  if (req.query.before) filter.createdAt = { $lt: new Date(req.query.before) };
  const rows = await Log.find(filter).sort({ createdAt: -1 }).limit(limit + 1)
    .select("level category message route statusCode name email createdAt");
  const problems = rows.slice(0, limit).map((l) => {
    const o = l.toJSON();
    // Internal error text stays with the platform team; the admin gets a plain summary.
    if (o.category === "server_error") o.message = "A technical error happened while handling a request for your forms. The platform team has been notified.";
    return o;
  });
  res.json({ problems, hasMore: rows.length > limit });
});

export default router;
