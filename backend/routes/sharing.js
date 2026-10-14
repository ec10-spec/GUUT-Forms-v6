import { Router } from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FormIndex from "../models/FormIndex.js";
import Team from "../models/Team.js";
import { requireAuth, tenantForCompanyId, isSuperadmin } from "../middleware/auth.js";
import { getTenant } from "../config/db.js";
import { accessOf, canManage, rankOf } from "../utils/access.js";
import { notifyAccessRequest, notifyAccessDecision } from "../utils/notify.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";

// Per-form sharing and access requests. Business forms stay inside ONE company: people can only be
// given access by an email on the form's own team. An individual's form can be shared with anyone who
// has an account, one form at a time.
const router = Router();
router.use(requireAuth);

const ROLES = ["viewer", "editor"];
const brief = (u) => (u ? { _id: String(u._id), name: u.name || "", email: u.email } : null);
const sameCompany = (req, idx) => isSuperadmin(req) || String(req.user.companyId) === String(idx.companyId);

async function loadIdx(req, id) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw httpError(404, "Form not found");
  const idx = await FormIndex.findById(id);
  // Another company's form looks exactly like a form that doesn't exist (unless it was shared with you).
  if (!idx || (!sameCompany(req, idx) && !accessOf(req, idx))) throw httpError(404, "Form not found");
  return idx;
}

function assertManage(req, idx) {
  if (!canManage(accessOf(req, idx))) throw httpError(403, "Only the form's owner or a company admin can manage sharing.");
}

async function overview(req, idx) {
  const access = accessOf(req, idx);
  const owner = await User.findById(idx.ownerId).select("name email");
  const out = { myAccess: access, canManage: canManage(access), owner: brief(owner) };
  if (!out.canManage) return out;
  const ids = [...idx.collaborators.map((c) => c.userId), ...idx.accessRequests.map((r) => r.userId)];
  const users = new Map((await User.find({ _id: { $in: ids } }).select("name email")).map((u) => [String(u._id), u]));
  // Teams: who the form is shared with, and which of MY teams could still be added.
  // Business forms use the company's teams; an individual's forms use their own open teams.
  const formCompany = await Company.findById(idx.companyId).select("type");
  const shared = new Map(idx.teamShares.map((s) => [s.teamId, s.role]));
  const sharedTeams = shared.size ? await Team.find({ _id: { $in: [...shared.keys()].filter((t) => mongoose.isValidObjectId(t)) } }) : [];
  const candidates = formCompany?.type === "individual"
    ? await Team.find({ "members.userId": req.userId, open: true }).sort({ nameLower: 1 }).limit(100)
    : await Team.find({ companyId: idx.companyId, open: { $ne: true } }).sort({ nameLower: 1 }).limit(300);
  out.teams = sharedTeams.map((t) => ({ _id: String(t._id), name: t.name, memberCount: t.members.length, role: shared.get(String(t._id)), open: !!t.open }));
  out.availableTeams = candidates.filter((t) => !shared.has(String(t._id))).map((t) => ({ _id: String(t._id), name: t.name, memberCount: t.members.length, open: !!t.open }));
  out.collaborators = idx.collaborators.filter((c) => users.has(c.userId)).map((c) => ({ ...brief(users.get(c.userId)), role: c.role, addedAt: c.addedAt }));
  out.requests = idx.accessRequests.filter((r) => users.has(r.userId)).map((r) => ({ ...brief(users.get(r.userId)), role: r.role, message: r.message, createdAt: r.createdAt }));
  return out;
}

// GET /api/sharing/forms/:id
router.get("/forms/:id", async (req, res) => {
  res.json(await overview(req, await loadIdx(req, req.params.id)));
});

// GET /api/sharing/forms/:id/eligible: teammates who can still be added (picker suggestions).
router.get("/forms/:id/eligible", async (req, res) => {
  const idx = await loadIdx(req, req.params.id);
  assertManage(req, idx);
  // Individuals have no team directory: they type the email of another individual account.
  if ((await Company.findById(idx.companyId).select("type"))?.type === "individual") return res.json([]);
  const skip = [idx.ownerId, ...idx.collaborators.map((c) => c.userId)];
  const users = await User.find({ companyId: idx.companyId, active: true, _id: { $nin: skip.filter((s) => mongoose.isValidObjectId(s)) } })
    .select("name email role").sort({ email: 1 }).limit(500);
  // Company admins already have full access, so they're not offered.
  res.json(users.filter((u) => u.role !== "admin").map(brief));
});

// POST /api/sharing/forms/:id/collaborators  { email, role }  (give access)
router.post("/forms/:id/collaborators", async (req, res) => {
  const idx = await loadIdx(req, req.params.id);
  assertManage(req, idx);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = req.body?.role;
  if (!email) throw httpError(400, "Enter a team member's email.");
  if (!ROLES.includes(role)) throw httpError(400, "Choose Viewer or Editor.");
  const formCompany = await Company.findById(idx.companyId).select("type");
  const individualShare = formCompany?.type === "individual";
  let user;
  if (individualShare) {
    // An individual can share with anyone who has an account (another individual, or someone at a business).
    // They only ever get this one form. Same answer whether the email is unknown or not shareable.
    user = await User.findOne({ email, active: true });
    if (!user || user.role === "superadmin") {
      throw httpError(404, "No GUUT Forms account was found for that email. They need to create a free account first.");
    }
  } else {
    // A business form: the email must belong to an active person on THIS form's team. Same message
    // whether the email is unknown or belongs to another company.
    user = await User.findOne({ email, companyId: idx.companyId, active: true });
    if (!user) throw httpError(404, "That email isn't on your team. You can only share with people in your team's directory.");
  }
  if (String(user._id) === idx.ownerId) throw httpError(400, "That person already owns this form.");
  if (user.role === "admin" && String(user.companyId) === String(idx.companyId)) throw httpError(400, "That person is a company admin and already has full access.");

  const existing = idx.collaborators.find((c) => c.userId === String(user._id));
  if (existing) existing.role = role;
  else idx.collaborators.push({ userId: String(user._id), role, addedBy: req.userId, external: individualShare && String(user.companyId) !== String(idx.companyId) });
  idx.accessRequests = idx.accessRequests.filter((r) => r.userId !== String(user._id));
  await idx.save();
  logger.info("form", `Access granted (${role}): ${user.email}`, { req, meta: { formId: idx._id } });
  notifyAccessDecision({ idx, user, outcome: "granted", role });
  res.status(201).json(await overview(req, idx));
});

// PUT /api/sharing/forms/:id/collaborators/:userId  { role }
router.put("/forms/:id/collaborators/:userId", async (req, res) => {
  const idx = await loadIdx(req, req.params.id);
  assertManage(req, idx);
  if (!ROLES.includes(req.body?.role)) throw httpError(400, "Choose Viewer or Editor.");
  const c = idx.collaborators.find((x) => x.userId === req.params.userId);
  if (!c) throw httpError(404, "That person doesn't have access.");
  c.role = req.body.role;
  await idx.save();
  res.json(await overview(req, idx));
});

// DELETE /api/sharing/forms/:id/collaborators/:userId  (owner/admin removes; a collaborator may remove themselves)
router.delete("/forms/:id/collaborators/:userId", async (req, res) => {
  const idx = await loadIdx(req, req.params.id);
  if (req.params.userId !== req.userId) assertManage(req, idx);
  idx.collaborators = idx.collaborators.filter((c) => c.userId !== req.params.userId);
  await idx.save();
  res.json(await overview(req, idx));
});

// Team sharing: everyone in the team gets the role, for as long as they're in it.
async function teamOfForm(req, idx, teamId) {
  const team = mongoose.isValidObjectId(teamId) ? await Team.findById(teamId) : null;
  const formCompany = await Company.findById(idx.companyId).select("type");
  const ok = team && (team.open
    ? formCompany?.type === "individual" && team.members.some((m) => m.userId === req.userId) // my open team, my personal form
    : String(team.companyId) === String(idx.companyId)); // a business team of this form's own company
  if (!ok) throw httpError(404, "That team doesn't exist.");
  return team;
}
router.post("/forms/:id/teams", async (req, res) => {
  const idx = await loadIdx(req, req.params.id);
  assertManage(req, idx);
  if (!ROLES.includes(req.body?.role)) throw httpError(400, "Choose Viewer or Editor.");
  const team = await teamOfForm(req, idx, req.body?.teamId);
  const existing = idx.teamShares.find((s) => s.teamId === String(team._id));
  if (existing) existing.role = req.body.role;
  else idx.teamShares.push({ teamId: String(team._id), role: req.body.role, addedBy: req.userId, external: !!team.open });
  await idx.save();
  logger.info("form", `Shared with team (${req.body.role}): ${team.name}`, { req, meta: { formId: idx._id } });
  res.status(201).json(await overview(req, idx));
});
router.put("/forms/:id/teams/:teamId", async (req, res) => {
  const idx = await loadIdx(req, req.params.id);
  assertManage(req, idx);
  if (!ROLES.includes(req.body?.role)) throw httpError(400, "Choose Viewer or Editor.");
  const s = idx.teamShares.find((x) => x.teamId === req.params.teamId);
  if (!s) throw httpError(404, "That team doesn't have access.");
  s.role = req.body.role;
  await idx.save();
  res.json(await overview(req, idx));
});
router.delete("/forms/:id/teams/:teamId", async (req, res) => {
  const idx = await loadIdx(req, req.params.id);
  assertManage(req, idx);
  idx.teamShares = idx.teamShares.filter((s) => s.teamId !== req.params.teamId);
  await idx.save();
  res.json(await overview(req, idx));
});

// POST /api/sharing/forms/:id/request  { role, message? }  (ask for access)
router.post("/forms/:id/request", async (req, res) => {
  const idx = await loadIdx(req, req.params.id);
  if (!req.user.companyId || String(req.user.companyId) !== String(idx.companyId)) throw httpError(404, "Form not found");
  const role = ROLES.includes(req.body?.role) ? req.body.role : "viewer";
  const have = accessOf(req, idx);
  if (rankOf(have) >= rankOf(role)) throw httpError(400, have === "viewer" || have === "editor" ? `You already have ${have} access.` : "You already have full access to this form.");
  const message = String(req.body?.message || "").trim().slice(0, 300);
  idx.accessRequests = idx.accessRequests.filter((r) => r.userId !== req.userId);
  idx.accessRequests.push({ userId: req.userId, role, message });
  await idx.save();
  notifyAccessRequest({ idx, requester: req.user, role, message });
  res.status(201).json({ ok: true });
});

// GET /api/sharing/requests: pending requests I can act on (forms I own; every form if I'm a company admin).
router.get("/requests", async (req, res) => {
  const scope = req.user.role === "admin" && req.user.companyId ? { companyId: req.user.companyId } : { ownerId: req.userId };
  const idxs = await FormIndex.find({ ...scope, "accessRequests.0": { $exists: true } }).limit(200);
  if (!idxs.length) return res.json([]);
  const userIds = [...new Set(idxs.flatMap((i) => i.accessRequests.map((r) => r.userId)))];
  const users = new Map((await User.find({ _id: { $in: userIds } }).select("name email")).map((u) => [String(u._id), u]));
  const titles = new Map();
  for (const companyId of new Set(idxs.map((i) => String(i.companyId)))) {
    try {
      const tenant = await tenantForCompanyId(companyId);
      const forms = await tenant.Form.find({ _id: { $in: idxs.filter((i) => String(i.companyId) === companyId).map((i) => i._id) } }).select("title").lean();
      forms.forEach((f) => titles.set(String(f._id), f.title));
    } catch { /* database unreachable: show requests without titles */ }
  }
  res.json(idxs.flatMap((i) => i.accessRequests.filter((r) => users.has(r.userId)).map((r) => ({
    formId: String(i._id), formTitle: titles.get(String(i._id)) || "Untitled form",
    ...brief(users.get(r.userId)), role: r.role, message: r.message, createdAt: r.createdAt,
  }))).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

async function resolveRequest(req, res, approve) {
  const idx = await loadIdx(req, req.params.id);
  assertManage(req, idx);
  const reqRow = idx.accessRequests.find((r) => r.userId === req.params.userId);
  if (!reqRow) throw httpError(404, "That request no longer exists.");
  const user = await User.findOne({ _id: req.params.userId, companyId: idx.companyId, active: true });
  idx.accessRequests = idx.accessRequests.filter((r) => r.userId !== req.params.userId);
  let role = reqRow.role;
  if (approve && user) {
    role = ROLES.includes(req.body?.role) ? req.body.role : reqRow.role;
    const existing = idx.collaborators.find((c) => c.userId === String(user._id));
    if (existing) existing.role = role;
    else idx.collaborators.push({ userId: String(user._id), role, addedBy: req.userId });
  }
  await idx.save();
  if (user) notifyAccessDecision({ idx, user, outcome: approve ? "granted" : "declined", role });
  res.json({ ok: true });
}
router.post("/forms/:id/requests/:userId/approve", (req, res) => resolveRequest(req, res, true));
router.post("/forms/:id/requests/:userId/deny", (req, res) => resolveRequest(req, res, false));

// GET /api/sharing/team-forms: the forms on MY team I could ask for access to (titles and owners only).
router.get("/team-forms", async (req, res) => {
  if (!req.user.companyId || isSuperadmin(req)) return res.json([]);
  const idxs = await FormIndex.find({ companyId: req.user.companyId, ownerId: { $ne: req.userId } }).sort({ updatedAt: -1 }).limit(300);
  if (!idxs.length) return res.json([]);
  let tenant;
  try {
    tenant = await getTenant(await Company.findById(req.user.companyId));
  } catch {
    return res.json([]); // no database linked or unreachable: nothing to browse yet
  }
  const forms = await tenant.Form.find({ _id: { $in: idxs.map((i) => i._id) } }).select("title publishedAt").lean();
  const titles = new Map(forms.map((f) => [String(f._id), f]));
  const owners = new Map((await User.find({ _id: { $in: [...new Set(idxs.map((i) => i.ownerId))].filter((x) => mongoose.isValidObjectId(x)) } }).select("name email")).map((u) => [String(u._id), u]));
  res.json(idxs.filter((i) => titles.has(String(i._id))).map((i) => ({
    _id: String(i._id), title: titles.get(String(i._id)).title, published: !!titles.get(String(i._id)).publishedAt,
    owner: brief(owners.get(i.ownerId)),
    myAccess: accessOf(req, i),
    requestedRole: i.accessRequests.find((r) => r.userId === req.userId)?.role || null,
  })));
});

export default router;
