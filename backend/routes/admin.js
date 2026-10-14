import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FormIndex from "../models/FormIndex.js";
import Log from "../models/Log.js";
import { requireSuperadmin } from "../middleware/auth.js";
import { dropTenant, getTenant, hostedTenant, openVerifiedConnection, platformStatus } from "../config/db.js";
import { linkDatabase, checkDatabase, normalizeUri, copyCompanyData } from "../utils/companyDb.js";
import { usageByUser } from "../utils/usageBilling.js";
import { httpError, escapeRegex } from "../utils/http.js";
import { uniqueJoinCode } from "../utils/joinCode.js";
import { planById } from "../utils/plans.js";
import { recalculateStorage, storageLimitBytes } from "../utils/storage.js";
import Team from "../models/Team.js";
import { logger } from "../utils/logger.js";

const router = Router();
router.use(requireSuperadmin);

const oid = (id) => {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, "Not found");
  return id;
};

// ------------------------------------------------------------------ overview
router.get("/overview", async (_req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [users, companies, forms, errors24h, warns24h, individuals, pendingJoins] = await Promise.all([
    User.countDocuments(), Company.countDocuments({ type: { $ne: "individual" } }), FormIndex.countDocuments(),
    Log.countDocuments({ level: "error", createdAt: { $gte: since } }),
    Log.countDocuments({ level: "warn", createdAt: { $gte: since } }),
    Company.countDocuments({ type: "individual" }), User.countDocuments({ "membership.status": "pending" }),
  ]);
  res.json({
    platformDb: platformStatus(),
    counts: { users, companies, individuals, pendingJoins, forms, errors24h, warns24h },
  });
});

// ----------------------------------------------------------------- companies
router.get("/companies", async (req, res) => {
  // Businesses by default (individuals are one-person workspaces and can number in the thousands).
  const filter = req.query.type === "individual" ? { type: "individual" } : req.query.type === "all" ? {} : { type: { $ne: "individual" } };
  if (req.query.q) filter.name = { $regex: escapeRegex(req.query.q), $options: "i" };
  const [companies, userCounts, formCounts] = await Promise.all([
    Company.find(filter).sort({ createdAt: -1 }).limit(300),
    User.aggregate([{ $group: { _id: "$companyId", n: { $sum: 1 } } }]),
    FormIndex.aggregate([{ $group: { _id: "$companyId", n: { $sum: 1 } } }]),
  ]);
  const u = new Map(userCounts.map((r) => [String(r._id), r.n]));
  const f = new Map(formCounts.map((r) => [String(r._id), r.n]));
  res.json(companies.map((c) => ({ ...c.toJSON(), userCount: u.get(String(c._id)) || 0, formCount: f.get(String(c._id)) || 0, storageLimitBytes: storageLimitBytes(c) })));
});

// Creates a business and, optionally, its first company admin in one step (businesses can also
// sign themselves up from the login page).
router.post("/companies", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) throw httpError(400, "Company name is required.");
  const { adminEmail, adminName, adminPassword } = req.body || {};
  const wantsAdmin = !!String(adminEmail || "").trim();
  let email = "";
  if (wantsAdmin) {
    email = String(adminEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "A valid admin email is required.");
    if (typeof adminPassword !== "string" || adminPassword.length < 8) throw httpError(400, "The admin's temporary password must be at least 8 characters.");
    if (await User.findOne({ email })) throw httpError(409, "An account with that email already exists.");
  }
  const company = await Company.create({ name, type: "business", joinCode: await uniqueJoinCode(), billing: { plan: planById(req.body?.plan) ? req.body.plan : null, status: "active", updatedAt: new Date() } });
  let admin = null;
  if (wantsAdmin) {
    try {
      admin = await User.create({
        email, name: String(adminName || "").trim().slice(0, 80), role: "admin", companyId: company._id,
        passwordHash: await bcrypt.hash(adminPassword, 10),
      });
    } catch (err) {
      await company.deleteOne().catch(() => {});
      throw err;
    }
  }
  logger.info("admin", `Company created: ${name}`, { req, meta: { companyId: company._id, firstAdmin: admin?.email || null } });
  res.status(201).json({ company, admin });
});

router.put("/companies/:id", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) throw httpError(400, "Company name is required.");
  const company = await Company.findByIdAndUpdate(oid(req.params.id), { name }, { new: true });
  if (!company) throw httpError(404, "Company not found");
  res.json(company);
});

// Re-measure one company's stored data (also fills in sizes for data saved before tracking existed).
router.post("/companies/:id/recalculate-storage", async (req, res) => {
  const company = await Company.findById(oid(req.params.id));
  if (!company) throw httpError(404, "Company not found");
  res.json({ bytes: await recalculateStorage(company) });
});

// Billing is set by the platform team (no payment processor yet).
router.put("/companies/:id/billing", async (req, res) => {
  const company = await Company.findById(oid(req.params.id));
  if (!company || company.type !== "business") throw httpError(404, "Company not found");
  const { plan, status } = req.body || {};
  if (plan !== undefined) {
    if (plan !== null && !planById(plan)) throw httpError(400, "Unknown plan.");
    company.billing.plan = plan;
    if (plan && company.billing.requestedPlan === plan) company.billing.requestedPlan = null;
  }
  if (status !== undefined) {
    if (!["trialing", "active", "past_due", "canceled"].includes(status)) throw httpError(400, "Unknown status.");
    company.billing.status = status;
  }
  company.billing.updatedAt = new Date();
  await company.save();
  logger.info("admin", `Billing updated: ${company.name}`, { req, meta: { companyId: company._id, plan: company.billing.plan, status: company.billing.status } });
  res.json(company);
});

// Test a connection string without saving anything.
router.post("/database/test", async (req, res) => {
  const { conn, host, dbName } = await openVerifiedConnection(normalizeUri(req.body?.uri));
  await conn.close();
  res.json({ ok: true, host, dbName });
});

// Link (or change) a company's own database.  { uri, migrate? }
router.put("/companies/:id/database", async (req, res) => {
  const company = await Company.findById(oid(req.params.id));
  if (!company) throw httpError(404, "Company not found");
  res.json(await linkDatabase({ company, rawUri: req.body?.uri, migrate: req.body?.migrate, req }));
});

// Unlink. The company can't create forms until a database is linked again;
// its data stays untouched in its own database.
router.delete("/companies/:id/database", async (req, res) => {
  const company = await Company.findById(oid(req.params.id));
  if (!company) throw httpError(404, "Company not found");
  if (!company.customUriEncrypted) throw httpError(400, "This company has no linked database.");
  // Without its own database the company falls back to our hosted storage, so its data is copied
  // there first (the original in their own database is left untouched).
  const copied = await copyCompanyData(company._id, await getTenant(company), hostedTenant());
  delete copied.sourceIds;
  company.customUriEncrypted = null;
  company.dbHost = company.dbName = null;
  await company.save();
  await dropTenant(company._id);
  logger.info("admin", `Database unlinked for ${company.name}`, { req, meta: { companyId: company._id } });
  res.json({ company, copied });
});

// Re-check a linked database is still reachable and writable.
router.post("/companies/:id/database/check", async (req, res) => {
  const company = await Company.findById(oid(req.params.id));
  if (!company?.customUriEncrypted) throw httpError(400, "This company has no linked database.");
  res.json(await checkDatabase(company, req));
});

// --------------------------------------------------------------------- users
router.get("/users", async (_req, res) => {
  const [users, companies] = await Promise.all([User.find().sort({ createdAt: -1 }).limit(500), Company.find().select("name")]);
  const names = new Map(companies.map((c) => [String(c._id), c.name]));
  res.json(users.map((u) => ({ ...u.toJSON(), companyName: names.get(String(u.companyId)) || "" })));
});

router.post("/users", async (req, res) => {
  const { email, password, name, role, companyId } = req.body || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) throw httpError(400, "A valid email is required.");
  if (typeof password !== "string" || password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
  if (await User.findOne({ email: email.toLowerCase() })) throw httpError(409, "An account with that email already exists.");
  let company = companyId ? await Company.findById(oid(companyId)) : null;
  if (companyId && !company) throw httpError(404, "Company not found");
  if (!company) company = await Company.create({ name: `${String(name || email.split("@")[0]).slice(0, 60)}'s workspace` });
  const user = await User.create({
    email: email.toLowerCase(), name: String(name || "").trim().slice(0, 80),
    role: ["superadmin", "admin"].includes(role) ? role : "user", companyId: company._id,
    passwordHash: await bcrypt.hash(password, 10),
  });
  logger.info("admin", `User created: ${user.email} (${user.role})`, { req, meta: { companyId: company._id } });
  res.status(201).json({ ...user.toJSON(), companyName: company.name });
});

router.put("/users/:id", async (req, res) => {
  const user = await User.findById(oid(req.params.id));
  if (!user) throw httpError(404, "User not found");
  const { name, role, companyId, active, newPassword } = req.body || {};
  const self = String(user._id) === req.userId;
  if (self && ((role && role !== "superadmin") || active === false)) throw httpError(400, "You can't demote or disable your own account.");
  if (name !== undefined) user.name = String(name).trim().slice(0, 80);
  if (role !== undefined) {
    if (!["user", "admin", "superadmin"].includes(role)) throw httpError(400, "Invalid role.");
    user.role = role;
  }
  if (active !== undefined) user.active = !!active;
  if (companyId !== undefined) {
    if (!(await Company.exists({ _id: oid(companyId) }))) throw httpError(404, "Company not found");
    if (String(user.companyId) !== String(companyId)) {
      // Form-level access belongs to the old company; it must not follow the person to a new one.
      const uid = String(user._id);
      const touched = await FormIndex.find({ $or: [{ "collaborators.userId": uid }, { "accessRequests.userId": uid }] });
      for (const idx of touched) {
        idx.collaborators = idx.collaborators.filter((c) => c.userId !== uid);
        idx.accessRequests = idx.accessRequests.filter((r) => r.userId !== uid);
        await idx.save();
      }
      // ...and neither do team memberships.
      for (const t of await Team.find({ "members.userId": uid })) {
        t.members = t.members.filter((m) => m.userId !== uid);
        await t.save();
      }
    }
    user.companyId = companyId;
  }
  if (newPassword !== undefined) {
    if (typeof newPassword !== "string" || newPassword.length < 8) throw httpError(400, "Password must be at least 8 characters.");
    user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  await user.save();
  logger.info("admin", `User updated: ${user.email}`, { req, meta: { changed: Object.keys(req.body || {}).filter((k) => k !== "newPassword") } });
  const company = await Company.findById(user.companyId).select("name");
  res.json({ ...user.toJSON(), companyName: company?.name || "" });
});

// --------------------------------------------------------------- AI usage
// GET /api/admin/usage?days=30: token usage for every user on the platform.
router.get("/usage", async (req, res) => {
  const days = Number(req.query.days) || 30;
  const [usage, users, companies] = await Promise.all([usageByUser({ days }), User.find().select("name email role companyId active").limit(2000), Company.find().select("name")]);
  const cname = new Map(companies.map((c) => [String(c._id), c.name]));
  const u = new Map(usage.map((r) => [r.userId, r]));
  const rows = users.map((x) => {
    const r = u.get(String(x._id));
    return { userId: String(x._id), name: x.name || "", email: x.email, role: x.role, active: x.active, companyId: String(x.companyId || ""), companyName: cname.get(String(x.companyId)) || "", calls: r?.calls || 0, tokens: r?.tokens || 0, today: r?.today || 0, lastAt: r?.lastAt || null, estimatedCostUsd: r?.estimatedCostUsd || 0 };
  }).sort((a, b) => b.tokens - a.tokens);
  const perCompany = new Map();
  for (const r of rows) {
    const c = perCompany.get(r.companyId) || { companyId: r.companyId, companyName: r.companyName, calls: 0, tokens: 0, estimatedCostUsd: 0 };
    c.calls += r.calls; c.tokens += r.tokens; c.estimatedCostUsd = Number((c.estimatedCostUsd + r.estimatedCostUsd).toFixed(4));
    perCompany.set(r.companyId, c);
  }
  res.json({ days, totalTokens: rows.reduce((a, r) => a + r.tokens, 0), totalCalls: rows.reduce((a, r) => a + r.calls, 0), estimatedCostUsd: Number(rows.reduce((a, r) => a + r.estimatedCostUsd, 0).toFixed(4)), companies: [...perCompany.values()].sort((a, b) => b.tokens - a.tokens), rows });
});

// ---------------------------------------------------------------------- logs
// GET /api/admin/logs?level=&category=&q=&before=<ISO date>&limit=
router.get("/logs", async (req, res) => {
  const { level, category, q, before } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  const filter = {};
  if (level) filter.level = level;
  if (category) filter.category = category;
  if (before) filter.createdAt = { $lt: new Date(before) };
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ message: rx }, { route: rx }, { email: rx }];
  }
  const rows = await Log.find(filter).sort({ createdAt: -1 }).limit(limit + 1);
  const hasMore = rows.length > limit;
  res.json({ logs: rows.slice(0, limit), hasMore });
});

// One log including its attachment (user reports).
router.get("/logs/:id", async (req, res) => {
  const row = await Log.findById(oid(req.params.id)).select("+attachment.base64");
  if (!row) throw httpError(404, "Log not found");
  res.json(row);
});

export default router;
