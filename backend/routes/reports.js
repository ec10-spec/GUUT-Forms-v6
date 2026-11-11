import { Router } from "express";
import rateLimit from "express-rate-limit";
import { log } from "../utils/logger.js";
import FormIndex from "../models/FormIndex.js";
import { httpError } from "../utils/http.js";

// Public write-only intake. Reading logs is superadmin-only (routes/admin.js).
const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many reports. Please wait a minute." },
});

// ~2.8M base64 chars is roughly a 2MB file.
const MAX_ATTACHMENT_BASE64 = 2_800_000;

// POST /api/reports: the "Report a problem" widget. No account needed.
router.post("/", limiter, async (req, res) => {
  const { name, email, message, attachment, url, topic, formId } = req.body || {};
  if (typeof message !== "string" || !message.trim()) throw httpError(400, "Please describe the problem.");

  let attach = { name: null, mediaType: null, base64: null };
  if (attachment?.base64) {
    if (attachment.base64.length > MAX_ATTACHMENT_BASE64) throw httpError(413, "Attachment is too large (keep it under ~2MB).");
    attach = { name: String(attachment.name || "attachment").slice(0, 200), mediaType: String(attachment.mediaType || "").slice(0, 100), base64: attachment.base64 };
  }

  // Routing: a problem with a FORM goes to that form's company admin (and us);
  // a problem with the APPLICATION goes to the platform team only.
  let companyId = null;
  if (topic === "form") {
    if (typeof formId === "string" && /^[a-f\d]{24}$/i.test(formId)) companyId = (await FormIndex.findById(formId).select("companyId"))?.companyId || null;
    if (!companyId && req.user?.companyId) companyId = req.user.companyId;
  }
  const routedTopic = companyId ? "form" : "app";
  if (companyId) req.logCompanyId = companyId;

  const saved = await log({
    level: "info", category: "user_report", message: message.trim().slice(0, 2000), req,
    meta: { topic: routedTopic, formId: routedTopic === "form" && formId ? String(formId).slice(0, 24) : null },
    extra: {
      name: String(name || "").slice(0, 120), email: String(email || "").slice(0, 254),
      url: String(url || "").slice(0, 500), attachment: attach,
    },
  });
  res.status(201).json({ id: saved?._id || null });
});

// POST /api/reports/client: front-end JavaScript errors, sent automatically.
router.post("/client", limiter, async (req, res) => {
  const { message, stack, url, kind } = req.body || {};
  if (typeof message === "string" && message.trim()) {
    log({
      level: "error", category: "client_error", message: message.trim().slice(0, 1000), req,
      extra: { stack: String(stack || "").slice(0, 6000), url: String(url || "").slice(0, 500) },
      meta: { kind: String(kind || "error").slice(0, 40) },
    });
  }
  res.status(204).end();
});

export default router;
