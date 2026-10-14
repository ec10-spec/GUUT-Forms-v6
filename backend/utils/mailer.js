import nodemailer from "nodemailer";
import { logger } from "./logger.js";

// Email goes out over plain SMTP, so any provider works (Gmail app password,
// Resend, SendGrid, Mailgun, Amazon SES, a company relay). Configure with env
// vars; with none set, notifications are simply switched off.
//   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true for port 465), SMTP_USER,
//   SMTP_PASS, SMTP_FROM ("GUUT Forms <no-reply@yourdomain.com>")
export const mailEnabled = () => !!(process.env.SMTP_HOST && process.env.SMTP_FROM);

let transport = null;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
    });
  }
  return transport;
}

/** Public base URL used for links inside emails. */
export function appUrl() {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:5173").replace(/\/$/, "");
}

/** Never throws: a failed email must not fail the request that triggered it. */
export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) return { sent: false, reason: "not_configured" };
  try {
    await getTransport().sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    logger.warn("system", `Email send failed: ${String(err.message).slice(0, 200)}`);
    return { sent: false, reason: "send_failed", error: "The email server rejected the message. Check the SMTP settings." };
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
