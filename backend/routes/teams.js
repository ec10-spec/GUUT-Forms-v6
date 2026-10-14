import { Router } from "express";
import mongoose from "mongoose";
import Team from "../models/Team.js";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FormIndex from "../models/FormIndex.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyTeamAdded } from "../utils/notify.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";

// Teams are named groups of people you can share a form with in one step.
//  - Business: any member can create a team and add anyone from the company. Company admins can manage all of them.
//  - Individual: any account can create an "open" team (friends, a class, a club) and add anyone who has an
//    account, by email. Members only ever see forms that were shared with that team.
// Everyone in a team can see who else is in it, so a form owner knows exactly who a team share reaches.
const router = Router();
router.use(requireAuth);
router.use(async (req, _res, next) => {
  if (!req.user.companyId) throw httpError(403, "Your account is waiting for your company admin's approval.", { code: "MEMBERSHIP_PENDING" });
  req.companyType = (await Company.findById(req.user.companyId).select("type"))?.type || "individual";
  next();
});

const brief = (u) => (u ? { _id: String(u._id), name: u.name || "", email: u.email } : null);
const sameCompany = (req, t) => String(t.companyId) === String(req.user.companyId);
const canManage = (req, team) => team.createdBy === req.userId || (req.user.role === "admin" && !team.open && sameCompany(req, team));
const isMember = (req, t) => t.members.some((m) => m.userId === req.userId);

async function loadTeam(req, id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, "Team not found");
  const team = await Team.findOne({ _id: id, $or: [{ companyId: req.user.companyId, open: { $ne: true } }, { "members.userId": req.userId }, { createdBy: req.userId }] });
  if (!team) throw httpError(404, "Team not found");
  return team;
}
function assertManage(req, team) {
  if (!canManage(req, team)) throw httpError(403, "Only the person who created this team, or a company admin, can change it.");
}
async function cleanName(req, raw, exceptId) {
  const name = String(raw || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw httpError(400, "Team names are 2 to 60 characters.");
  const clash = await Team.findOne({ companyId: req.user.companyId, nameLower: name.toLowerCase() });
  if (clash && String(clash._id) !== String(exceptId)) throw httpError(409, req.companyType === "business" ? "Your company already has a team with that name." : "You already have a team with that name.");
  return name;
}
const view = (req, t, creators) => ({
  _id: String(t._id), name: t.name, open: !!t.open, memberCount: t.members.length,
  isMember: isMember(req, t), canManage: canManage(req, t),
  createdBy: brief(creators?.get(t.createdBy)),
});
async function creatorsOf(teams) {
  const ids = [...new Set(teams.map((t) => t.createdBy).filter((x) => mongoose.isValidObjectId(x)))];
  return new Map((await User.find({ _id: { $in: ids } }).select("name email")).map((u) => [String(u._id), u]));
}

// Business: every company team, plus any open team I was added to. Individual: the open teams I'm in.
router.get("/", async (req, res) => {
  const mine = await Team.find({ "members.userId": req.userId }).limit(300);
  const company = req.companyType === "business" ? await Team.find({ companyId: req.user.companyId, open: { $ne: true } }).limit(300) : [];
  const seen = new Set();
  const teams = [...company, ...mine].filter((t) => !seen.has(String(t._id)) && seen.add(String(t._id)));
  teams.sort((a, b) => a.nameLower.localeCompare(b.nameLower));
  const creators = await creatorsOf(teams);
  res.json(teams.map((t) => view(req, t, creators)));
});

router.post("/", async (req, res) => {
  const open = req.companyType !== "business";
  const cap = open ? 50 : 300;
  if ((await Team.countDocuments({ companyId: req.user.companyId })) >= cap) throw httpError(400, `You have reached the limit of ${cap} teams.`);
  const name = await cleanName(req, req.body?.name);
  const team = await Team.create({ companyId: req.user.companyId, name, nameLower: name.toLowerCase(), open, createdBy: req.userId, members: [{ userId: req.userId, addedBy: req.userId }] });
  logger.info("team", `Team created: ${name}`, { req, meta: { open } });
  res.status(201).json(view(req, team, new Map([[req.userId, req.user]])));
});

router.get("/:id", async (req, res) => {
  const team = await loadTeam(req, req.params.id);
  const users = new Map((await User.find({ _id: { $in: team.members.map((m) => m.userId).filter((x) => mongoose.isValidObjectId(x)) } }).select("name email")).map((u) => [String(u._id), u]));
  const creators = await creatorsOf([team]);
  res.json({ ...view(req, team, creators), members: team.members.filter((m) => users.has(m.userId)).map((m) => ({ ...brief(users.get(m.userId)), addedAt: m.addedAt })) });
});

router.put("/:id", async (req, res) => {
  const team = await loadTeam(req, req.params.id);
  assertManage(req, team);
  team.name = await cleanName(req, req.body?.name, team._id);
  team.nameLower = team.name.toLowerCase();
  await team.save();
  res.json(view(req, team, await creatorsOf([team])));
});

// Also removes the team from every form it was shared with.
router.delete("/:id", async (req, res) => {
  const team = await loadTeam(req, req.params.id);
  assertManage(req, team);
  const id = String(team._id);
  for (const idx of await FormIndex.find({ "teamShares.teamId": id })) {
    idx.teamShares = idx.teamShares.filter((s) => s.teamId !== id);
    await idx.save();
  }
  await team.deleteOne();
  logger.info("team", `Team deleted: ${team.name}`, { req });
  res.status(204).end();
});

router.get("/:id/eligible", async (req, res) => {
  const team = await loadTeam(req, req.params.id);
  assertManage(req, team);
  if (team.open) return res.json([]); // open teams: type the person's email
  const inTeam = new Set(team.members.map((m) => m.userId));
  const users = await User.find({ companyId: req.user.companyId, active: true }).select("name email").sort({ email: 1 }).limit(500);
  res.json(users.filter((u) => !inTeam.has(String(u._id))).map(brief));
});

router.post("/:id/members", async (req, res) => {
  const team = await loadTeam(req, req.params.id);
  assertManage(req, team);
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) throw httpError(400, team.open ? "Enter the person's email." : "Enter a colleague's email.");
  // Same answer for an unknown email and for (business teams) someone at another company.
  const user = await User.findOne(team.open ? { email, active: true } : { email, companyId: req.user.companyId, active: true });
  if (!user || (team.open && user.role === "superadmin")) {
    throw httpError(404, team.open ? "No GUUT Forms account was found for that email. They need to create a free account first." : "That email isn't on your team. You can only add people from your own company.");
  }
  if (!team.members.some((m) => m.userId === String(user._id))) {
    if (team.members.length >= 500) throw httpError(400, "A team can have up to 500 members.");
    team.members.push({ userId: String(user._id), addedBy: req.userId });
    await team.save();
    notifyTeamAdded({ team, user, addedBy: req.user });
  }
  res.status(201).json({ ok: true, memberCount: team.members.length });
});

router.delete("/:id/members/:userId", async (req, res) => {
  const team = await loadTeam(req, req.params.id);
  if (req.params.userId !== req.userId) assertManage(req, team);
  team.members = team.members.filter((m) => m.userId !== req.params.userId);
  await team.save();
  res.json({ ok: true, memberCount: team.members.length });
});

export default router;
