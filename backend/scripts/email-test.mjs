// Checks the email settings by sending one test message.
// Run from backend/: npm run email:test -- you@example.com
// Reads the same env vars as the server (BREVO_API_KEY or SMTP_*, MAIL_FROM).
import "dotenv/config";
import { sendMail, renderEmail, mailEnabled, mailProvider, appUrl } from "../utils/mailer.js";
import { verificationRequired } from "../utils/emailVerification.js";

const to = process.argv[2];
console.log(`Provider: ${mailProvider() || "none"}`);
console.log(`Sender (MAIL_FROM): ${process.env.MAIL_FROM || process.env.SMTP_FROM || "not set"}`);
console.log(`Links point to (APP_URL): ${appUrl()}`);
console.log(`Sign-up confirmation required: ${verificationRequired() ? "yes" : "no"}`);
if (!mailEnabled()) {
  console.error("Email is not set up. Set BREVO_API_KEY (or SMTP_HOST, SMTP_USER, SMTP_PASS) and MAIL_FROM.");
  process.exit(1);
}
if (!to) {
  console.error("Add the address to send to: npm run email:test -- you@example.com");
  process.exit(1);
}
const { text, html } = renderEmail({ heading: "GUUT Forms email test", lines: ["Email is working. Sign-up confirmation and password reset emails will arrive like this one."], cta: "Open GUUT Forms", url: appUrl(), footer: "Sent by npm run email:test." });
const r = await sendMail({ to, subject: "GUUT Forms email test", text, html });
if (r.sent) { console.log(`Sent to ${to}. Check the inbox and the spam folder.`); process.exit(0); }
console.error(`Not sent: ${r.error || r.reason}`);
process.exit(1);
