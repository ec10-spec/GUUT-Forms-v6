import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth.js";
import { sendMail, renderEmail, mailEnabled, appUrl } from "../utils/mailer.js";
import { httpError } from "../utils/http.js";

const router = Router();
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many test emails. Wait a minute." } });

// POST /api/notifications/test: sends a sample email to the signed-in user.
router.post("/test", requireAuth, limiter, async (req, res) => {
  if (!mailEnabled()) throw httpError(400, "Email isn't set up on this server yet. The platform team needs to configure SMTP.", { code: "MAIL_NOT_CONFIGURED" });
  const { text, html } = renderEmail({ heading: "Test email from GUUT Forms", lines: ["If you can read this, notifications will reach you at this address."], cta: "Open GUUT Forms", url: appUrl() });
  const r = await sendMail({ to: req.user.email, subject: "GUUT Forms test email", text, html });
  if (!r.sent) throw httpError(502, r.error || "Couldn't send the test email.");
  res.json({ ok: true, to: req.user.email });
});

export default router;
