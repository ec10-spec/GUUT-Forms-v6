import nodemailer from "nodemailer";
import { logger } from "./logger.js";

// Email can go out three ways. Pick one with env vars; with none set, email is off.
//   1. Brevo HTTP API: BREVO_API_KEY. Works on hosts that block SMTP ports (Render's
//      free plan blocks 25, 465 and 587). The sender can be one verified address,
//      such as a Gmail test account, so no domain is needed for testing.
//   2. Resend HTTP API: RESEND_API_KEY. Needs a verified domain for the sender.
//   3. SMTP: SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true for 465), SMTP_USER, SMTP_PASS.
//      Gmail: smtp.gmail.com, 587, the Gmail address, and a 16-character app password.
// MAIL_FROM (or SMTP_FROM) sets the sender, e.g. "GUUT Forms <guutforms.test@gmail.com>".
const mailFrom = () => process.env.MAIL_FROM || process.env.SMTP_FROM || "";
export function mailProvider() {
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST) return "smtp";
  return null;
}
export const mailEnabled = () => !!(mailProvider() && mailFrom());

let transport = null;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
      // Fail in seconds, not minutes, when a host blocks SMTP ports.
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
  }
  return transport;
}

/** "GUUT Forms <a@b.co>" -> { name, email } */
export function parseAddress(v = "") {
  const m = String(v).match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/);
  return m ? { name: m[1].trim(), email: m[2] } : { name: "", email: String(v).trim() };
}

async function postJson(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) {
      const detail = (await r.text().catch(() => "")).slice(0, 200);
      throw new Error(`HTTP ${r.status} ${detail}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function deliver({ to, subject, text, html }) {
  const provider = mailProvider();
  if (provider === "brevo") {
    const from = parseAddress(mailFrom());
    return postJson(process.env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email", { "api-key": process.env.BREVO_API_KEY }, {
      sender: { email: from.email, ...(from.name ? { name: from.name } : {}) },
      to: [{ email: to }], subject, htmlContent: html || undefined, textContent: text || undefined,
    });
  }
  if (provider === "resend") {
    return postJson(process.env.RESEND_API_URL || "https://api.resend.com/emails", { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, {
      from: mailFrom(), to: [to], subject, html: html || undefined, text: text || undefined,
    });
  }
  return getTransport().sendMail({ from: mailFrom(), to, subject, text, html });
}

/** Public base URL used for links inside emails. */
export function appUrl() {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:5173").replace(/\/$/, "");
}

function explain(err) {
  const m = String(err?.message || err);
  if (mailProvider() === "smtp" && /ETIMEDOUT|ECONNREFUSED|ENETUNREACH|ESOCKET|Greeting never received|Connection timeout/i.test(m)) {
    return "Could not reach the SMTP server. Some hosts, including Render's free plan, block SMTP ports. Use BREVO_API_KEY instead.";
  }
  if (/535|Invalid login|Username and Password not accepted/i.test(m)) return "The email server rejected the login. For Gmail, use an app password, not the account password.";
  if (/HTTP 401|HTTP 403/.test(m)) return "The email service rejected the API key or the sender. Check the key and that the sender address is verified.";
  if (/HTTP 400/.test(m)) return "The email service refused the message. Check that MAIL_FROM is a verified sender.";
  return "The email server rejected the message. Check the email settings.";
}

/** Never throws: a failed email must not fail the request that triggered it. */
export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) return { sent: false, reason: "not_configured" };
  try {
    await deliver({ to, subject, text, html });
    return { sent: true };
  } catch (err) {
    logger.warn("system", `Email send failed (${mailProvider()}): ${String(err.message).slice(0, 200)}`);
    return { sent: false, reason: "send_failed", error: explain(err) };
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** One consistent, minimal layout for every notification: heading, short body, one button. */
export function renderEmail({ heading, lines = [], cta, url, footer = "You can change these emails in Settings > Notifications." }) {
  const text = [heading, "", ...lines, ...(cta && url ? ["", `${cta}: ${url}`] : []), "", footer].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2233">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px;border:1px solid #e3e6ee">
<p style="margin:0 0 18px"><img src="${esc(appUrl())}/email-logo.png" alt="GUUT Forms" height="34" style="height:34px;display:block"></p>
<h2 style="margin:0 0 14px;font-size:18px;color:#001549">${esc(heading)}</h2>
${lines.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5">${esc(l)}</p>`).join("")}
${cta && url ? `<p style="margin:20px 0 6px"><a href="${esc(url)}" style="background:#001549;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;display:inline-block">${esc(cta)}</a></p>` : ""}
<p style="margin:22px 0 0;font-size:12px;color:#7a8499">${esc(footer)}</p>
</div></body></html>`;
  return { text, html };
}
