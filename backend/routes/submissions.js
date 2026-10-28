import { Router } from "express";
import PDFDocument from "pdfkit";
import rateLimit from "express-rate-limit";
import { Parser as CsvParser } from "../utils/csv.js";
import FormIndex from "../models/FormIndex.js";
import { requireAuth, tenantForCompanyId } from "../middleware/auth.js";
import { accessOf, canView } from "../utils/access.js";
import { notifyResponse } from "../utils/notify.js";
import Company from "../models/Company.js";
import { assertCanReceiveResponse } from "../utils/plans.js";
import { assertStorageRoom, bumpStorage, submissionSize } from "../utils/storage.js";
import { httpError } from "../utils/http.js";
import { parseWorkbook, suggestMapping, cleanRows } from "../utils/importer.js";
import { logger } from "../utils/logger.js";
import { cleanSubmission, isFileRef } from "../utils/answers.js";
import { findFile, signedFileUrl } from "../utils/uploads.js";
import { safeTz, localDateTime } from "../utils/time.js";
import { appUrl } from "../utils/mailer.js";

const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many submissions from this connection. Please wait a minute." },
});

async function locate(req, formId, opts) {
  if (!/^[a-f\d]{24}$/i.test(formId)) throw httpError(404, "Form not found");
  const idx = await FormIndex.findById(formId);
  if (!idx) throw httpError(404, "Form not found");
  req.logCompanyId = idx.companyId; // so any problem lands in THIS company's problem list
  return { idx, tenant: await tenantForCompanyId(idx.companyId, opts) };
}

// Responses: anyone with access to the form (owner, company admin, editor or viewer).
function assertOwner(req, idx) {
  if (!canView(accessOf(req, idx))) throw httpError(403, "You don't have access to this form's responses.");
}

/** Validates a live submission with the shared validator. Every problem is returned, the first one as the message. */
function cleanAnswers(form, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw httpError(400, "answers must be an object.");
  const { answers, errors } = cleanSubmission(form, raw);
  if (errors.length) throw httpError(400, errors[0].message, { code: "INVALID_ANSWERS", fields: errors });
  return answers;
}

/** Replaces each file answer with the stored file's real name, size and type, and checks it belongs to this question. */
async function resolveFiles(tenant, form, answers) {
  const ids = [];
  for (const f of form.fields) {
    const v = answers[f.id];
    if (f.type !== "file" || !isFileRef(v)) continue;
    const file = await findFile(tenant, "uploads", v.fileId);
    if (!file || file.metadata?.formId !== String(form._id) || file.metadata?.fieldId !== f.id || file.metadata?.submissionId) {
      throw httpError(400, `"${f.label}": the file wasn't uploaded. Attach it again.`, { code: "INVALID_ANSWERS" });
    }
    answers[f.id] = { fileId: String(file._id), name: file.filename, size: file.length, type: file.contentType || file.metadata?.contentType || "" };
    ids.push(file._id);
  }
  return ids;
}

// Adds a signed, short-lived link to every file answer so the Responses table can show it.
function withFileLinks(form, rows, ttlSec, base = "") {
  const fileFields = form.fields.filter((f) => f.type === "file").map((f) => f.id);
  if (!fileFields.length) return rows;
  return rows.map((r) => {
    const o = r.toObject ? r.toObject() : { ...r };
    for (const id of fileFields) {
      const v = o.answers?.[id];
      if (isFileRef(v)) o.answers[id] = { ...v, url: signedFileUrl(String(form._id), v.fileId, ttlSec, base) };
    }
    return o;
  });
}

// Public: anyone with the link can respond, but only to a published form.
// The response is written to the form's company database.
router.post("/:formId", submitLimiter, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId, { publicFacing: true });
  if (!idx.publishedAt) throw httpError(403, "This form isn't accepting responses.");
  const form = await tenant.Form.findById(req.params.formId);
  if (!form) throw httpError(404, "Form not found");
  const company = await Company.findById(idx.companyId);
  await assertCanReceiveResponse(company, tenant, FormIndex);
  const answers = cleanAnswers(form, req.body?.answers);
  const fileIds = await resolveFiles(tenant, form, answers);
  const size = submissionSize(answers);
  await assertStorageRoom(company, size, { forVisitor: true }); // a visitor never sees the owner's billing details
  const submission = await tenant.Submission.create({ formId: form._id, answers, sizeBytes: size });
  if (fileIds.length) await tenant.conn.db.collection("uploads.files").updateMany({ _id: { $in: fileIds } }, { $set: { "metadata.submissionId": String(submission._id) } });
  await bumpStorage(idx.companyId, size);
  notifyResponse(idx); // best effort, never blocks or fails the respondent
  res.status(201).json({ _id: submission._id, createdAt: submission.createdAt });
});

// Owner only: list + substring search over answers.
router.get("/:formId", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId);
  assertOwner(req, idx);
  const form = await tenant.Form.findById(idx._id).lean();
  let rows = await tenant.Submission.find({ formId: idx._id }).sort({ createdAt: -1 }).limit(5000).lean();
  const q = String(req.query.q || "").trim().toLowerCase();
  const text = (v) => (isFileRef(v) ? v.name : Array.isArray(v) ? v.join(", ") : String(v ?? ""));
  if (q) rows = rows.filter((s) => Object.values(s.answers || {}).some((v) => text(v).toLowerCase().includes(q)));
  res.json(form ? withFileLinks(form, rows, 24 * 3600) : rows);
});


// ---- Import older responses (owner or company admin). Two steps: a preview that suggests how the file's
// columns line up with the form's fields, then the import itself. Values are converted to the form's own
// formats so imported rows behave exactly like collected ones.
function assertCanImport(req, idx) {
  const access = accessOf(req, idx);
  if (access !== "owner" && access !== "admin" && access !== "editor") throw httpError(403, "Only people who can edit this form can import responses.");
}

router.post("/:formId/import/preview", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId);
  assertCanImport(req, idx);
  const form = await tenant.Form.findById(idx._id).lean();
  if (!form) throw httpError(404, "Form not found");
  const { headers, rows } = parseWorkbook(req.body?.base64, req.body?.filename);
  const fields = [...form.fields].sort((a, b) => a.order - b.order);
  const { mapping, timestampColumn } = suggestMapping(headers, fields);
  res.json({ headers, rowCount: rows.length, sample: rows.slice(0, 5), mapping, timestampColumn, fields: fields.map((f) => ({ id: f.id, label: f.label, type: f.type, required: !!f.required })) });
});

router.post("/:formId/import", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId);
  assertCanImport(req, idx);
  const form = await tenant.Form.findById(idx._id).lean();
  if (!form) throw httpError(404, "Form not found");
  const { headers, rows } = parseWorkbook(req.body?.base64, req.body?.filename);
  const fields = [...form.fields].sort((a, b) => a.order - b.order);
  const cleaned = cleanRows({ fields, headers, rows, mapping: req.body?.mapping || {}, timestampColumn: req.body?.timestampColumn || null });
  const summary = {
    total: rows.length, importable: cleaned.rows.length, skipped: cleaned.skipped, skippedEmpty: cleaned.skippedEmpty,
    skippedMissing: cleaned.skippedMissing, badTimestamps: cleaned.badTimestamps, issueCount: cleaned.issues.length, issues: cleaned.issues.slice(0, 50),
  };
  if (req.body?.dryRun) {
    return res.json({ dryRun: true, ...summary, preview: cleaned.rows.slice(0, 5).map((r) => r.answers) });
  }
  const company = await Company.findById(idx.companyId);
  const docs = cleaned.rows.map((r) => ({ formId: idx._id, answers: r.answers, sizeBytes: submissionSize(r.answers), imported: true, ...(r.createdAt ? { createdAt: r.createdAt } : {}) }));
  const bytes = docs.reduce((n, d) => n + d.sizeBytes, 0);
  await assertStorageRoom(company, bytes);
  for (let i = 0; i < docs.length; i += 500) await tenant.Submission.insertMany(docs.slice(i, i + 500));
  await bumpStorage(idx.companyId, bytes);
  logger.info("form", `Responses imported: ${form.title}`, { req, meta: { formId: idx._id, rows: docs.length, skipped: cleaned.skipped } });
  res.status(201).json({ imported: docs.length, ...summary });
});

// Owner only: CSV (fetched with the auth header by the UI, not a bare link).
router.get("/:formId/export.csv", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId);
  assertOwner(req, idx);
  const form = await tenant.Form.findById(idx._id);
  if (!form) throw httpError(404, "Form not found");
  const tz = safeTz(req.query.tz);
  const rows = withFileLinks(form, await tenant.Submission.find({ formId: idx._id }).sort({ createdAt: 1 }).lean(), 7 * 24 * 3600, appUrl());
  const fields = [...form.fields].sort((a, b) => a.order - b.order);
  const csv = new CsvParser(fields.map((f) => ({ id: f.id, label: f.label, type: f.type })), { tz }).toCsv(rows);
  logger.info("form", `CSV export: ${form.title}`, { req, meta: { formId: idx._id, rows: rows.length } });
  res.header("Content-Type", "text/csv");
  res.attachment(`${form.title.replace(/[^\w-]+/g, "_")}_submissions.csv`);
  res.send(csv);
});

// Owner only: a printable PDF of the responses, one block per response.
router.get("/:formId/export.pdf", requireAuth, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId);
  assertOwner(req, idx);
  const form = await tenant.Form.findById(idx._id);
  if (!form) throw httpError(404, "Form not found");
  const rows = await tenant.Submission.find({ formId: idx._id }).sort({ createdAt: 1 }).limit(2000);
  const fields = [...form.fields].sort((a, b) => a.order - b.order);
  const tz = safeTz(req.query.tz);
  logger.info("form", `PDF export: ${form.title}`, { req, meta: { formId: idx._id, rows: rows.length } });
  res.header("Content-Type", "application/pdf");
  res.attachment(`${form.title.replace(/[^\w-]+/g, "_")}_responses.pdf`);
  const doc = new PDFDocument({ margin: 48, size: "A4", info: { Title: `${form.title} responses`, Producer: "GUUT Forms" } });
  doc.pipe(res);
  const navy = "#001549", muted = "#6b7280";
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(20).text(form.title);
  doc.moveDown(0.2).fillColor(muted).font("Helvetica").fontSize(10)
    .text(`${rows.length} response${rows.length === 1 ? "" : "s"}  |  Exported ${localDateTime(new Date(), tz)} (${tz})  |  GUUT Forms`);
  doc.moveDown(1);
  if (!rows.length) doc.fillColor(muted).fontSize(12).text("No responses yet.");
  rows.forEach((r, i) => {
    if (doc.y > 700) doc.addPage();
    doc.fillColor("#F3BA28").circle(doc.page.margins.left + 4, doc.y + 6, 3.5).fill();
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(11).text(`Response ${i + 1}`, doc.page.margins.left + 14, doc.y, { continued: true })
      .fillColor(muted).font("Helvetica").fontSize(9).text(`   ${localDateTime(r.createdAt, tz)} (${tz})${r.imported ? ", imported" : ""}`);
    doc.moveDown(0.3);
    for (const f of fields) {
      const v = r.answers?.[f.id];
      const text = isFileRef(v) ? `File: ${v.name}` : Array.isArray(v) ? (v.length ? v.join(", ") : "-") : v === undefined || v === null || v === "" ? "-" : String(v);
      if (doc.y > 760) doc.addPage();
      doc.fillColor(muted).font("Helvetica").fontSize(9).text(f.label, doc.page.margins.left + 14);
      doc.fillColor("#1a1d29").font("Helvetica").fontSize(11).text(text.length > 1500 ? text.slice(0, 1500) + "..." : text, { width: 480 });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.8);
  });
  doc.end();
});

export default router;
