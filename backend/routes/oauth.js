import { Router } from "express";
import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { createAccount, sessionUser, signupsOpen } from "./auth.js";
import { discardUnverified, verificationRequired, issueVerification } from "../utils/emailVerification.js";
import { mailEnabled } from "../utils/mailer.js";
import { appUrl } from "../utils/mailer.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import { funnel } from "../utils/funnel.js";

// "Continue with Google / Microsoft / Apple". Standard OpenID Connect authorization-code flow, no extra
// packages. Each provider is switched on by its environment variables (see SETUP.md, Sign-in providers):
//   Google:    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   Microsoft: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT (default "common": work, school and personal accounts)
//   Apple:     APPLE_CLIENT_ID (the Services ID), APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 contents)
// Redirect URI to register with each provider: <OAUTH_REDIRECT_BASE or APP_URL>/api/auth/oauth/<provider>/callback
//
// Flow: /start sets a short-lived cookie holding a random nonce and redirects to the provider with a signed
// `state`. The provider sends the person back to /callback, which checks state against the cookie (so nobody
// can sign someone else into an account), swaps the code for an ID token over a direct server-to-server
// call, finds or creates the account, and hands the browser a 2-minute ticket in the URL fragment. The
// app swaps the ticket for a normal session at /exchange. Tokens never appear in a server log or query string.
const router = Router();

const secret = () => process.env.JWT_SECRET || "guut-forms-dev-secret-change-me";
const COOKIE = "guut_oauth";
const MS_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

export const PROVIDERS = {
  google: {
    label: "Google",
    configured: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    extra: { prompt: "select_account" },
  },
  microsoft: {
    label: "Microsoft",
    configured: () => !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    tenant: () => process.env.MICROSOFT_TENANT || "common",
    get authorize() { return `https://login.microsoftonline.com/${this.tenant()}/oauth2/v2.0/authorize`; },
    get token() { return `https://login.microsoftonline.com/${this.tenant()}/oauth2/v2.0/token`; },
    issuers: null, // per tenant: checked by pattern below
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
    extra: { prompt: "select_account" },
  },
  apple: {
    label: "Apple",
    configured: () => !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    issuers: ["https://appleid.apple.com"],
    clientId: () => process.env.APPLE_CLIENT_ID,
    // Apple's client secret is a short-lived ES256 JWT signed with the team's private key.
    clientSecret: () => jwt.sign({}, String(process.env.APPLE_PRIVATE_KEY).replace(/\\n/g, "\n"), {
      algorithm: "ES256", expiresIn: "5m", issuer: process.env.APPLE_TEAM_ID, audience: "https://appleid.apple.com",
      subject: process.env.APPLE_CLIENT_ID, keyid: process.env.APPLE_KEY_ID,
    }),
    // Apple posts the result back (form_post) whenever name or email scope is requested.
    extra: { response_mode: "form_post" },
  },
};

const redirectBase = () => (process.env.OAUTH_REDIRECT_BASE || appUrl()).replace(/\/$/, "");
const callbackUrl = (p) => `${redirectBase()}/api/auth/oauth/${p}/callback`;
const secureCookies = () => redirectBase().startsWith("https://");

function setCookie(res, value, maxAgeSec) {
  // SameSite=None is needed for Apple, which comes back with a cross-site POST. It requires HTTPS;
  // on plain-http local development Lax is used (Google and Microsoft come back with a GET).
  const flags = [`${COOKIE}=${value}`, "Path=/api/auth/oauth", "HttpOnly", `Max-Age=${maxAgeSec}`, secureCookies() ? "SameSite=None; Secure" : "SameSite=Lax"];
  res.append("Set-Cookie", flags.join("; "));
}
function readCookie(req) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

/** Sends the browser back to the app: #/oauth?ticket=... on success, #/oauth?error=... on failure. */
function backToApp(res, params) {
  const q = new URLSearchParams(params).toString();
  res.redirect(303, `${appUrl()}/#/oauth?${q}`);
}

const startLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } });

// GET /api/auth/oauth/providers: which buttons to show.
router.get("/providers", (_req, res) => {
  res.json(Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, enabled: p.configured() })));
});

// GET /api/auth/oauth/:provider/start?type=individual|business|employee&companyName=&plan=&joinCode=
// The extra fields only matter if the person has no account yet; an existing account just signs in.
router.get("/:provider/start", startLimiter, (req, res) => {
  const id = req.params.provider;
  const p = PROVIDERS[id];
  if (!p) return backToApp(res, { error: "Unknown sign-in provider." });
  if (!p.configured()) return backToApp(res, { error: `Sign-in with ${p.label} isn't set up on this server yet.` });
  const nonce = crypto.randomBytes(18).toString("base64url");
  const intent = {
    type: ["individual", "business", "employee"].includes(req.query.type) ? req.query.type : "individual",
    companyName: String(req.query.companyName || "").slice(0, 80),
    plan: String(req.query.plan || "").slice(0, 20),
    joinCode: String(req.query.joinCode || "").slice(0, 24),
  };
  // Signed-in people connect a provider from Settings with a short link ticket (see /link-ticket).
  let link = null;
  if (req.query.link) {
    try { const t = jwt.verify(String(req.query.link), secret()); if (t.purpose === "link") link = t.sub; } catch { /* expired */ }
    if (!link) return backToApp(res, { error: "That connect link expired. Open Settings and try again.", link: "1" });
  }
  const state = jwt.sign({ p: id, n: nonce, i: intent, ...(link ? { l: link } : {}) }, secret(), { expiresIn: "10m" });
  setCookie(res, nonce, 600);
  const params = new URLSearchParams({
    client_id: p.clientId(), redirect_uri: callbackUrl(id), response_type: "code",
    scope: id === "apple" ? "name email" : "openid email profile", state, nonce, ...p.extra,
  });
  res.redirect(302, `${p.authorize}?${params}`);
});

/** Swaps the code for tokens. The ID token comes straight from the provider over TLS, so per OpenID
 *  Connect its signature need not be re-checked; issuer, audience, expiry and nonce still are. */
async function exchangeCode(id, p, code) {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(id), client_id: p.clientId(), client_secret: p.clientSecret() });
  let r;
  try {
    r = await fetch(p.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw httpError(502, `Couldn't reach ${p.label}. Try again in a moment.`);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.id_token) throw httpError(400, `${p.label} didn't accept the sign-in. Try again.`, { cause: new Error(String(data.error_description || data.error || r.status)) });
  const claims = jwt.decode(data.id_token);
  if (!claims || typeof claims !== "object") throw httpError(400, `${p.label} returned an unreadable sign-in.`);
  return claims;
}

function checkClaims(id, p, claims, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(p.clientId()) : claims.aud === p.clientId();
  const issOk = id === "microsoft"
    ? /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/i.test(String(claims.iss || ""))
    : p.issuers.includes(claims.iss);
  if (!audOk || !issOk || !claims.sub || (claims.exp && claims.exp < now - 60)) throw httpError(400, `The ${p.label} sign-in couldn't be verified. Try again.`);
  if (claims.nonce && claims.nonce !== nonce) throw httpError(400, "This sign-in link has already been used. Try again.");
}

/** Email and whether the provider vouches for it. Microsoft's `email` is only trusted for personal
 *  accounts or when the tenant marks it verified (xms_edov), which avoids the known account-takeover trap. */
function emailOf(id, claims) {
  const email = String(claims.email || (id === "microsoft" ? claims.preferred_username : "") || "").trim().toLowerCase();
  let verified = false;
  if (id === "google") verified = claims.email_verified === true || claims.email_verified === "true";
  if (id === "apple") verified = claims.email_verified === true || claims.email_verified === "true";
  if (id === "microsoft") verified = !!claims.email && (claims.tid === MS_CONSUMER_TENANT || claims.xms_edov === true || claims.xms_edov === "1" || claims.xms_edov === 1);
  return { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "", verified };
}

async function finish(req, res, id) {
  const p = PROVIDERS[id];
  if (!p || !p.configured()) return backToApp(res, { error: "This sign-in provider isn't set up." });
  const src = req.method === "POST" ? req.body || {} : req.query;
  const cookieNonce = readCookie(req);
  setCookie(res, "", 0); // one use
  if (src.error) return backToApp(res, { error: src.error === "access_denied" || src.error === "user_cancelled_authorize" ? "Sign-in was cancelled." : `${p.label} sign-in failed. Try again.` });
  let state;
  try { state = jwt.verify(String(src.state || ""), secret()); } catch { state = null; }
  if (!state || state.p !== id || !cookieNonce || state.n !== cookieNonce) {
    return backToApp(res, { error: "The sign-in took too long or was started in another browser. Please try again." });
  }
  try {
    const claims = await exchangeCode(id, p, String(src.code || ""));
    checkClaims(id, p, claims, state.n);
    const { email, verified } = emailOf(id, claims);
    const sub = String(claims.sub);

    // 0) Connecting a provider to the signed-in account (from Settings).
    if (state.l) {
      const me = await User.findById(state.l);
      if (!me || !me.active) return backToApp(res, { error: "Your session ended. Sign in and try again.", link: "1" });
      const other = await User.findOne({ [`oauth.${id}`]: sub, _id: { $ne: me._id } });
      if (other) return backToApp(res, { error: `That ${p.label} account is already connected to another GUUT Forms account.`, link: "1" });
      me.set(`oauth.${id}`, sub);
      await me.save();
      req.userId = String(me._id);
      logger.info("auth", `${p.label} sign-in connected: ${me.email}`, { req, meta: { provider: id } });
      return backToApp(res, { linked: id });
    }
    // 1) Already linked to this provider.
    let user = await User.findOne({ [`oauth.${id}`]: sub });
    // 2) Same email as an existing account: link it, but only when the provider has verified the address.
    if (!user && email) {
      const existing = await User.findOne({ email });
      if (existing && existing.emailVerified === false) {
        await discardUnverified(existing); // an unconfirmed sign-up doesn't reserve the address
      } else if (existing) {
        if (!verified) return backToApp(res, { error: `An account with ${email} already exists. Sign in with your password once, then ${p.label} sign-in will work.` });
        existing.set(`oauth.${id}`, sub);
        user = existing;
      }
    }
    let created = false;
    if (!user) {
      if (!email) return backToApp(res, { error: `${p.label} didn't share an email address, so an account can't be created. Allow email access and try again.` });
      if (!signupsOpen()) return backToApp(res, { error: "Sign-ups are closed right now." });
      // Apple sends the person's name once, as a JSON field on the first sign-in only.
      let name = claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ");
      if (!name && id === "apple" && src.user) { try { const u = JSON.parse(String(src.user)); name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(" "); } catch { /* ignore */ } }
      const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10);
      const intent = state.i || {};
      // An address the provider doesn't vouch for (some work accounts) is confirmed by email, like a normal sign-up.
      const mustVerify = !verified && verificationRequired();
      if (mustVerify && !mailEnabled()) return backToApp(res, { error: "Sign-up is temporarily unavailable: email confirmation isn't set up on this server yet." });
      ({ user } = await createAccount({
        type: intent.type || "individual", email, name, passwordHash, emailVerified: !mustVerify,
        companyName: intent.companyName, plan: intent.plan || undefined, joinCode: intent.joinCode,
        oauth: { [id]: sub },
      }));
      user.passwordSet = false;
      created = true;
      funnel("signup_done", req, { ownerId: String(user._id), type: intent.type || "individual", via: id });
      if (mustVerify) {
        await user.save();
        await issueVerification(user);
        logger.info("auth", `Sign-up with ${p.label} (email to confirm): ${user.email}`, { req, meta: { provider: id } });
        return backToApp(res, { verify: user.email });
      }
    }
    if (!user.active) return backToApp(res, { error: "This account is disabled. Contact your company admin." });
    if (verified) user.emailVerified = true;
    if (user.emailVerified === false) return backToApp(res, { error: "Please confirm your email first. We sent you a link when you signed up." });
    user.lastLoginAt = new Date();
    await user.save();
    req.userId = String(user._id);
    logger.info("auth", `${created ? "Sign-up" : "Login"} with ${p.label}: ${user.email}`, { req, meta: { provider: id, created } });
    const ticket = jwt.sign({ sub: String(user._id), v: user.tokenVersion || 0, purpose: "oauth" }, secret(), { expiresIn: "2m" });
    return backToApp(res, { ticket, ...(created ? { created: "1" } : {}) });
  } catch (err) {
    logger.warn("auth", `${p.label} sign-in failed: ${String(err.message).slice(0, 200)}`, { req, statusCode: err.status || 500, meta: { provider: id, cause: String(err.cause?.message || "").slice(0, 200) } });
    return backToApp(res, { error: err.status && err.status < 500 ? err.message : `${p.label} sign-in failed. Try again.` });
  }
}

router.get("/:provider/callback", (req, res) => finish(req, res, req.params.provider));
router.post("/:provider/callback", express.urlencoded({ extended: false, limit: "64kb" }), (req, res) => finish(req, res, req.params.provider));

// POST /api/auth/oauth/exchange { ticket }: the app swaps the short-lived ticket for a session.
const exchangeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } });
router.post("/exchange", exchangeLimiter, async (req, res) => {
  let payload;
  try { payload = jwt.verify(String(req.body?.ticket || ""), secret()); } catch { payload = null; }
  if (!payload || payload.purpose !== "oauth") throw httpError(400, "This sign-in has expired. Please try again.", { code: "BAD_OAUTH_TICKET" });
  const user = await User.findById(payload.sub);
  if (!user || !user.active || (payload.v || 0) !== (user.tokenVersion || 0)) throw httpError(400, "This sign-in has expired. Please try again.", { code: "BAD_OAUTH_TICKET" });
  res.json({ token: signToken(user), user: await sessionUser(user) });
});

// POST /api/auth/oauth/link-ticket: a 5-minute ticket that lets the browser start "connect a provider"
// for the signed-in account (the start page is a plain navigation, so it can't carry the session header).
router.post("/link-ticket", requireAuth, (req, res) => {
  res.json({ ticket: jwt.sign({ sub: req.userId, purpose: "link" }, secret(), { expiresIn: "5m" }) });
});

// DELETE /api/auth/oauth/:provider: disconnect. Kept only while another way to sign in remains.
router.delete("/:provider", requireAuth, async (req, res) => {
  const id = req.params.provider;
  if (!PROVIDERS[id]) throw httpError(404, "Unknown sign-in provider.");
  const u = req.user;
  const others = Object.keys(PROVIDERS).filter((k) => k !== id && u.oauth?.[k]);
  if (u.passwordSet === false && !others.length) throw httpError(400, "Set a password first (Settings, Account), so you can still sign in.", { code: "LAST_SIGN_IN_METHOD" });
  u.set(`oauth.${id}`, null);
  await u.save();
  res.json({ user: await sessionUser(u) });
});

export default router;
