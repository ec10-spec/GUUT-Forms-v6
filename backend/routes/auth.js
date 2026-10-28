import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import Company from "../models/Company.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { encrypt } from "../utils/crypto.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import { mailEnabled } from "../utils/mailer.js";
import { PROVIDERS } from "../utils/aiProviders.js";
import { notifyJoinRequest } from "../utils/notify.js";
import { normalizeJoinCode, uniqueJoinCode } from "../utils/joinCode.js";
import { planById } from "../utils/plans.js";
import FormIndex from "../models/FormIndex.js";
import { verificationRequired, issueVerification, findByToken, discardUnverified } from "../utils/emailVerification.js";
import { mailEnabled as mailOn, sendMail, renderEmail, appUrl } from "../utils/mailer.js";
import crypto from "crypto";

const router = Router();

const isEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const MIN_PW = 8;

// Brute-force protection: only failed attempts count toward the limit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

// What the client gets about the user, plus a safe summary of their own company.
async function sessionUser(user) {
  const company = user.companyId ? await Company.findById(user.companyId) : null;
  const pending = user.membership?.requestedCompanyId ? await Company.findById(user.membership.requestedCompanyId).select("name") : null;
  return {
    ...user.toJSON(),
    company: company ? {
      _id: company._id, name: company.name, type: company.type, dbMode: company.customUriEncrypted ? "custom" : "hosted",
      plan: company.billing?.plan || null, billingStatus: company.billing?.status || null,
    } : null,
    pendingCompanyName: pending?.name || null,
    emailConfigured: mailEnabled(),
  };
}

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: Number(process.env.SIGNUP_RATE_LIMIT || 30), standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many sign-ups from this network. Try again later." },
});
const displayName = (name, email) => String(name || "").trim().slice(0, 80) || email.split("@")[0];

// POST /api/auth/signup  { type: "individual" | "business" | "employee", email, password, name, ... }
//   individual: { } -> a personal workspace hosted by us
//   business:   { companyName, plan } -> a new company; the signer becomes its admin
//   employee:   { joinCode } -> waits for a company admin to approve
// Anyone can sign up for themselves; the platform team does not create accounts.
router.post("/signup", signupLimiter, async (req, res) => {
  if (String(process.env.SIGNUPS_ENABLED ?? "true").toLowerCase() === "false") throw httpError(403, "Sign-ups are closed right now.");
  const { type, password, name, companyName, plan, joinCode } = req.body || {};
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!["individual", "business", "employee"].includes(type)) throw httpError(400, "Choose an account type.");
  if (!isEmail(email)) throw httpError(400, "A valid email is required.");
  if (typeof password !== "string" || password.length < MIN_PW) throw httpError(400, `Password must be at least ${MIN_PW} characters.`);
  const mustVerify = verificationRequired();
  if (mustVerify && !mailOn()) throw httpError(503, "Sign-up is temporarily unavailable: email confirmation isn't set up on this server yet.", { code: "EMAIL_NOT_CONFIGURED" });
  const existingUser = await User.findOne({ email });
  if (existingUser && existingUser.emailVerified !== false) throw httpError(409, "An account with that email already exists. Sign in instead.");
  // An earlier sign-up that was never confirmed doesn't reserve the address (otherwise anyone could
  // lock someone else's email by signing up with it). The newest sign-up replaces it.
  if (existingUser) await discardUnverified(existingUser);
  const passwordHash = await bcrypt.hash(password, 10);
  const nm = displayName(name, email);

  let company = null;
  let user;
  if (type === "employee") {
    const code = normalizeJoinCode(joinCode);
    const target = code ? await Company.findOne({ joinCode: code, type: "business", joinEnabled: true }) : null;
    // Same answer for a wrong code and a closed one.
    if (!target) throw httpError(404, "That company code isn't valid, or the company isn't accepting new members.");
    user = await User.create({ email, name: nm, role: "user", companyId: null, passwordHash, emailVerified: !mustVerify, membership: { status: "pending", requestedCompanyId: target._id, requestedAt: new Date() } });
    // Admins are only told once the address is confirmed (see /verify), so a stranger can't spam them.
    if (!mustVerify) notifyJoinRequest({ company: target, requester: user });
  } else if (type === "business") {
    const cname = String(companyName || "").trim().slice(0, 80);
    if (cname.length < 2) throw httpError(400, "Enter your company name.");
    const planId = plan || "starter";
    if (!planById(planId)) throw httpError(400, "Choose one of the plans.");
    company = await Company.create({ name: cname, type: "business", joinCode: await uniqueJoinCode(), billing: { plan: planId, status: "trialing", updatedAt: new Date() } });
    try {
      user = await User.create({ email, name: nm, role: "admin", companyId: company._id, passwordHash, emailVerified: !mustVerify });
    } catch (err) { await company.deleteOne().catch(() => {}); throw err; }
  } else {
    company = await Company.create({ name: `${nm}'s workspace`, type: "individual" });
    try {
      user = await User.create({ email, name: nm, role: "user", companyId: company._id, passwordHash, emailVerified: !mustVerify });
    } catch (err) { await company.deleteOne().catch(() => {}); throw err; }
  }
  req.userId = String(user._id);
  logger.info("auth", `Sign-up (${type}): ${user.email}`, { req, meta: { companyId: company?._id || null, verified: !mustVerify } });
  if (mustVerify) {
    // No session yet: the account works once the emailed link is opened.
    await issueVerification(user);
    return res.status(201).json({ needsVerification: true, email: user.email });
  }
  res.status(201).json({ token: signToken(user), user: await sessionUser(user) });
});

// POST /api/auth/verify  { token }: confirms the email and signs the person in.
router.post("/verify", authLimiter, async (req, res) => {
  const user = await findByToken(req.body?.token);
  if (!user) throw httpError(400, "This confirmation link is invalid or has expired. Request a new one.", { code: "BAD_VERIFY_TOKEN" });
  user.emailVerified = true;
  user.emailVerification = { tokenHash: null, expiresAt: null };
  await user.save();
  req.userId = String(user._id);
  logger.info("auth", `Email confirmed: ${user.email}`, { req });
  if (user.membership?.status === "pending" && user.membership.requestedCompanyId) {
    const target = await Company.findById(user.membership.requestedCompanyId);
    if (target) notifyJoinRequest({ company: target, requester: user });
  }
  res.json({ token: signToken(user), user: await sessionUser(user) });
});

// POST /api/auth/resend-verification  { email }: always answers the same, so it can't be used to find accounts.
const resendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Try again later." } });
router.post("/resend-verification", resendLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const user = isEmail(email) ? await User.findOne({ email, emailVerified: false }) : null;
  if (user && mailOn()) await issueVerification(user);
  res.json({ ok: true });
});


// GET /api/auth/join-info?code=ABCD-EFGH: lets a company's share link show "Join Northwind" before
// anyone signs in. Same answer for a wrong code and a closed one, so it can't be used to browse companies.
const joinInfoLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } });
router.get("/join-info", joinInfoLimiter, async (req, res) => {
  const code = normalizeJoinCode(req.query.code);
  const target = code ? await Company.findOne({ joinCode: code, type: "business", joinEnabled: true }).select("name") : null;
  if (!target) throw httpError(404, "That company link isn't valid, or the company isn't accepting new members.");
  res.json({ companyName: target.name });
});

// POST /api/auth/request-join { joinCode }
// A signed-in person asks to join a company (from its share link). A company admin approves.
// Someone with an empty personal workspace moves over on approval; if they already have forms they
// are asked to use another email, so personal data never silently moves into a company.
router.post("/request-join", requireAuth, async (req, res) => {
  const user = req.user;
  if (user.role === "superadmin") throw httpError(403, "Platform accounts can't join a company.");
  const code = normalizeJoinCode(req.body?.joinCode);
  const target = code ? await Company.findOne({ joinCode: code, type: "business", joinEnabled: true }) : null;
  if (!target) throw httpError(404, "That company link isn't valid, or the company isn't accepting new members.");
  if (user.companyId && String(user.companyId) === String(target._id)) throw httpError(400, "You are already a member of this company.");
  if (user.companyId) {
    const mine = await Company.findById(user.companyId).select("type");
    if (mine?.type === "business") throw httpError(400, "You already belong to a company. Ask its admin to move you.");
    if (await FormIndex.exists({ ownerId: String(user._id) })) {
      throw httpError(400, "Your personal account already has forms. To join a company, create a separate work account with a different email, or delete your forms first.");
    }
  }
  user.membership = { status: "pending", requestedCompanyId: target._id, requestedAt: new Date() };
  await user.save();
  logger.info("auth", `Join request: ${user.email}`, { req, meta: { companyId: target._id } });
  if (user.emailVerified !== false) notifyJoinRequest({ company: target, requester: user });
  res.json({ user: await sessionUser(user) });
});

// POST /api/auth/cancel-join: withdraw a pending request.
router.post("/cancel-join", requireAuth, async (req, res) => {
  req.user.membership = { status: req.user.companyId ? "active" : "declined", requestedCompanyId: null, requestedAt: null };
  await req.user.save();
  res.json({ user: await sessionUser(req.user) });
});

// POST /api/auth/continue-individual
// A waiting (or declined) employee can drop the company request and use a personal workspace instead.
router.post("/continue-individual", requireAuth, async (req, res) => {
  const user = req.user;
  if (user.companyId) throw httpError(400, "Your account already has a workspace.");
  const company = await Company.create({ name: `${displayName(user.name, user.email)}'s workspace`, type: "individual" });
  user.companyId = company._id;
  user.membership = { status: "active", requestedCompanyId: null, requestedAt: null };
  await user.save();
  logger.info("auth", `Continued as individual: ${user.email}`, { req });
  res.json({ user: await sessionUser(user) });
});

// POST /api/auth/login   { email, password }
// One login for everyone: platform team, company admins and users. The server decides
// what each person sees from their role; the client never picks a "door".
router.post("/login", authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || typeof password !== "string" || !password) throw httpError(400, "Email and password are required.");
  const user = await User.findOne({ email: email.toLowerCase() });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    logger.warn("auth", `Failed login: ${email.toLowerCase()}`, { req, statusCode: 401, meta: { reason: !user ? "unknown email" : !user.active ? "disabled" : "bad password" } });
    throw httpError(401, "Incorrect email or password.");
  }
  if (user.emailVerified === false) {
    throw httpError(403, "Please confirm your email first. We sent you a link when you signed up.", { code: "EMAIL_NOT_VERIFIED" });
  }
  user.lastLoginAt = new Date();
  await user.save();
  req.userId = String(user._id);
  logger.info("auth", `Login: ${user.email}`, { req });
  res.json({ token: signToken(user), user: await sessionUser(user) });
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: await sessionUser(req.user) });
});

// PUT /api/auth/settings
// { theme?, notifications?, ai?: { provider?, anthropicKey?, openaiKey?, anthropicModel?, openaiModel? } }
// Keys are encrypted before storage and never returned. Send "" to remove a key.
router.put("/settings", requireAuth, async (req, res) => {
  const { theme, ai, notifications } = req.body || {};
  const user = req.user;

  if (theme !== undefined) {
    if (!["light", "dark", "system"].includes(theme)) throw httpError(400, "theme must be light, dark, or system.");
    user.settings.theme = theme;
  }

  if (ai && typeof ai === "object") {
    if (ai.provider !== undefined) {
      if (!PROVIDERS[ai.provider]) throw httpError(400, "provider must be anthropic or openai.");
      user.ai.provider = ai.provider;
    }
    for (const [field, path] of [["anthropicKey", "anthropicKeyEncrypted"], ["openaiKey", "openaiKeyEncrypted"]]) {
      if (typeof ai[field] !== "string") continue;
      const key = ai[field].trim();
      if (key && (key.length > 400 || /\s/.test(key))) throw httpError(400, "That doesn't look like a valid API key.");
      if (key && field === "anthropicKey" && !key.startsWith("sk-ant-")) throw httpError(400, "Claude keys start with sk-ant-. Check that you copied the whole key.", { code: "BAD_KEY_FORMAT" });
      if (key && field === "openaiKey" && (!key.startsWith("sk-") || key.startsWith("sk-ant-"))) throw httpError(400, "OpenAI keys start with sk-. Check that you copied the whole key.", { code: "BAD_KEY_FORMAT" });
      user.ai[path] = key ? encrypt(key) : null;
      if (field === "anthropicKey" && !key) user.settings.aiApiKeyEncrypted = null; // clear legacy copy too
      logger.info("auth", `AI key ${key ? "saved" : "removed"} (${field.replace("Key", "")})`, { req });
    }
    for (const field of ["anthropicModel", "openaiModel"]) {
      if (typeof ai[field] !== "string") continue;
      const model = ai[field].trim();
      if (model && !/^[\w.:/-]{1,80}$/.test(model)) throw httpError(400, "Model names can only contain letters, numbers and . : / _ -");
      user.ai[field] = model;
    }
  }

  if (notifications && typeof notifications === "object") {
    const n = user.notifications;
    if (notifications.formCreated !== undefined) n.formCreated = !!notifications.formCreated;
    if (notifications.accessRequests !== undefined) n.accessRequests = !!notifications.accessRequests;
    if (notifications.sharedResponses !== undefined) n.sharedResponses = !!notifications.sharedResponses;
    const r = notifications.responses;
    if (r && typeof r === "object") {
      if (r.enabled !== undefined) n.responses.enabled = !!r.enabled;
      if (r.mode !== undefined) {
        if (!["every", "hours", "count"].includes(r.mode)) throw httpError(400, "Choose every response, every N hours, or every N responses.");
        n.responses.mode = r.mode;
      }
      if (r.hours !== undefined) {
        const h = Number(r.hours);
        if (!Number.isFinite(h) || h < 1 || h > 168) throw httpError(400, "Hours must be between 1 and 168.");
        n.responses.hours = Math.round(h);
      }
      if (r.count !== undefined) {
        const c = Number(r.count);
        if (!Number.isFinite(c) || c < 2 || c > 1000) throw httpError(400, "Responses must be between 2 and 1000.");
        n.responses.count = Math.round(c);
      }
    }
  }

  await user.save();
  res.json({ user: await sessionUser(user) });
});

// PUT /api/auth/password { currentPassword, newPassword }
router.put("/password", requireAuth, authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== "string" || newPassword.length < MIN_PW) throw httpError(400, `New password must be at least ${MIN_PW} characters.`);
  if (!(await bcrypt.compare(String(currentPassword || ""), req.user.passwordHash))) throw httpError(400, "Current password is incorrect.");
  req.user.setPasswordHash(await bcrypt.hash(newPassword, 10));
  await req.user.save();
  logger.info("auth", "Password changed", { req });
  // Other devices are signed out; this one gets a fresh token so it stays signed in.
  res.json({ ok: true, token: signToken(req.user) });
});

// ---- Forgot password. The reset email needs SMTP (see the go-live checklist); the routes work today.
// POST /api/auth/forgot { email }: always answers the same, so it can't be used to find accounts.
const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Try again later." } });
const RESET_TTL_MS = 60 * 60 * 1000;
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
router.post("/forgot", forgotLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const user = isEmail(email) ? await User.findOne({ email, active: true }) : null;
  if (user) {
    const token = crypto.randomBytes(32).toString("base64url");
    user.passwordReset = { tokenHash: sha(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) };
    await user.save();
    const { text, html } = renderEmail({
      heading: "Reset your password",
      lines: ["Someone asked to reset the password for your GUUT Forms account. Use the button to choose a new one. The link works for 1 hour and only once."],
      cta: "Choose a new password", url: `${appUrl()}/#/reset?token=${token}`,
      footer: "If you didn't ask for this, you can ignore this email. Your password stays the same.",
    });
    const r = await sendMail({ to: user.email, subject: "Reset your GUUT Forms password", text, html });
    req.userId = String(user._id);
    logger.info("auth", `Password reset requested: ${user.email}`, { req, meta: { emailSent: r.sent } });
    if (!r.sent) logger.warn("auth", "Password reset email could not be sent (SMTP not configured or failed)", { req });
  }
  res.json({ ok: true, emailConfigured: mailOn() });
});

// POST /api/auth/reset { token, password }: sets the new password, signs out every other session and signs in.
router.post("/reset", authLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof password !== "string" || password.length < MIN_PW) throw httpError(400, `Password must be at least ${MIN_PW} characters.`);
  const user = typeof token === "string" && token.length >= 20 && token.length <= 200
    ? await User.findOne({ "passwordReset.tokenHash": sha(token), "passwordReset.expiresAt": { $gt: new Date() } })
    : null;
  if (!user || !user.active) throw httpError(400, "This reset link is invalid or has expired. Ask for a new one.", { code: "BAD_RESET_TOKEN" });
  user.setPasswordHash(await bcrypt.hash(password, 10));
  user.emailVerified = true; // they proved they own the address
  await user.save();
  req.userId = String(user._id);
  logger.info("auth", `Password reset: ${user.email}`, { req });
  res.json({ token: signToken(user), user: await sessionUser(user) });
});

export default router;
