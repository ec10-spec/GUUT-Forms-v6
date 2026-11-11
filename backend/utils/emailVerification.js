import crypto from "crypto";
import User from "../models/User.js";
import Company from "../models/Company.js";
import { sendMail, renderEmail, mailEnabled, appUrl } from "./mailer.js";
import { logger } from "./logger.js";

// Email confirmation at sign-up. REQUIRE_EMAIL_VERIFICATION:
//   "true"  always required (sign-up is refused while email is not configured)
//   "false" never required
//   "auto" or unset: required whenever email is configured, so turning email on
//   also turns confirmation on, and a server without email keeps working.
export const verificationRequired = () => {
  const v = String(process.env.REQUIRE_EMAIL_VERIFICATION ?? "auto").trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return mailEnabled();
};

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
    console.warn("WARNING: REQUIRE_EMAIL_VERIFICATION=true but email is not configured, so sign-ups are refused. Set BREVO_API_KEY (or SMTP_*) and MAIL_FROM, or use REQUIRE_EMAIL_VERIFICATION=auto.");
  }
}
