import crypto from "crypto";
import User from "../models/User.js";
import Company from "../models/Company.js";
import { sendMail, renderEmail, mailEnabled, appUrl } from "./mailer.js";
import { logger } from "./logger.js";

// Email confirmation at sign-up is built but OFF by default until testing and deployment are done.
// Turn it on with REQUIRE_EMAIL_VERIFICATION=true (it then needs working SMTP). Needs working SMTP: with verification required
// and email not configured, sign-up is refused rather than silently skipping the check.
// 
export const verificationRequired = () => String(process.env.REQUIRE_EMAIL_VERIFICATION ?? "false").toLowerCase() === "true";

const TTL_MS = 24 * 3600 * 1000;
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");

/** Creates a fresh single-use link (replacing any earlier one) and emails it. */
export async function issueVerification(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  user.emailVerification = { tokenHash: hash(token), expiresAt: new Date(Date.now() + TTL_MS) };
  await user.save();
  const { text, html } = renderEmail({
    heading: "Confirm your email",
    lines: ["Confirm your email address to finish creating your GUUT Forms account. The link works for 24 hours."],
    cta: "Confirm email", url: `${appUrl()}/#/verify?token=${token}`,
    footer: "If you didn't create this account, you can ignore this email.",
  });
  const r = await sendMail({ to: user.email, subject: "Confirm your email for GUUT Forms", text, html });
  if (!r.sent) logger.warn("auth", "Verification email could not be sent");
  return r.sent;
}

/** Returns the user for a valid, unexpired token (without consuming it). */
export async function findByToken(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  return User.findOne({ "emailVerification.tokenHash": hash(token), "emailVerification.expiresAt": { $gt: new Date() } });
}

/** Removes an unverified self-signup and the workspace it created (if nobody else is in it). */
export async function discardUnverified(user) {
  const companyId = user.companyId;
  await user.deleteOne();
  if (companyId && !(await User.exists({ companyId }))) {
    await Company.deleteOne({ _id: companyId, type: { $in: ["individual", "business"] } });
  }
}

/** Unconfirmed sign-ups older than a week are cleaned up so nobody's email stays reserved forever. */
export async function purgeStaleUnverified() {
  const stale = await User.find({ emailVerified: false, createdAt: { $lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }).limit(200);
  for (const u of stale) await discardUnverified(u).catch(() => {});
  if (stale.length) logger.info("system", `Removed ${stale.length} unconfirmed sign-up(s)`);
}

export function warnIfMisconfigured() {
  if (verificationRequired() && !mailEnabled()) {
    console.warn("WARNING: email verification is required but SMTP isn't configured, so sign-ups are refused. Set SMTP_* or leave REQUIRE_EMAIL_VERIFICATION off.");
  }
}
