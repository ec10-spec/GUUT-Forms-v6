import { Router } from "express";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FormIndex from "../models/FormIndex.js";
import { getTenant } from "../config/db.js";
import { ensureStorageKnown, formStats, storageLimitBytes } from "../utils/storage.js";
import { httpError } from "../utils/http.js";
import { requireAuth, requireCompanyAdmin } from "../middleware/auth.js";
import { getBudget } from "../middleware/tokenLimiter.js";
import { usageByUser, usageDetail } from "../utils/usageBilling.js";

// AI token tracking. Everyone sees their own; company admins see their own
// team; the platform team sees everyone (routes/admin.js).
const router = Router();
router.use(requireAuth);

// GET /api/usage/me?days=30
router.get("/me", async (req, res) => {
  const days = Number(req.query.days) || 30;
  res.json({ budget: await getBudget(req.user), ...(await usageDetail(req.userId, days, req.query.tz)) });
});

// GET /api/usage/storage: stored form + response bytes. Individuals and company admins see the whole
// workspace; regular company members see only the forms they own.
router.get("/storage", async (req, res) => {
  const company = req.user.companyId ? await Company.findById(req.user.companyId) : null;
  if (!company) throw httpError(403, "No workspace for this account.");
  await ensureStorageKnown(company);
  const tenant = await getTenant(company);
  const whole = company.type === "individual" || req.user.role !== "user";
  const idxs = await FormIndex.find({ companyId: company._id }).select("ownerId");
  const mine = whole ? idxs : idxs.filter((i) => i.ownerId === req.userId);
  const stats = await formStats(tenant, mine.map((i) => i._id));
  const rows = [...stats].map(([id, s]) => ({ _id: id, title: s.title, bytes: s.bytes, responses: s.responses })).sort((a, b) => b.bytes - a.bytes);
  res.json({
    scope: whole ? "workspace" : "mine",
    bytes: whole ? company.storage.bytes : rows.reduce((a, r) => a + r.bytes, 0),
    limitBytes: storageLimitBytes(company),
    mode: company.customUriEncrypted ? "custom" : "hosted",
    forms: rows.length, responses: rows.reduce((a, r) => a + r.responses, 0),
    // When the total last changed (updated on every write); recountedAt is the last full recount.
    topForms: rows.slice(0, 10), measuredAt: company.storage.updatedAt || company.storage.verifiedAt, recountedAt: company.storage.verifiedAt,
  });
});

// GET /api/usage/team?days=30: always the caller's OWN company, taken from the session.
router.get("/team", requireCompanyAdmin, async (req, res) => {
  const days = Number(req.query.days) || 30;
  const users = await User.find({ companyId: req.user.companyId }).select("name email role active").limit(500);
  const usage = new Map((await usageByUser({ userIds: users.map((u) => String(u._id)), days, tz: req.query.tz })).map((r) => [r.userId, r]));
  const rows = users.map((u) => {
    const r = usage.get(String(u._id));
    return { userId: String(u._id), name: u.name || "", email: u.email, role: u.role, active: u.active, calls: r?.calls || 0, tokens: r?.tokens || 0, today: r?.today || 0, lastAt: r?.lastAt || null, estimatedCostUsd: r?.estimatedCostUsd || 0 };
  }).sort((a, b) => b.tokens - a.tokens);
  res.json({ days, totalTokens: rows.reduce((a, r) => a + r.tokens, 0), totalCalls: rows.reduce((a, r) => a + r.calls, 0), estimatedCostUsd: Number(rows.reduce((a, r) => a + r.estimatedCostUsd, 0).toFixed(4)), rows });
});

export default router;
