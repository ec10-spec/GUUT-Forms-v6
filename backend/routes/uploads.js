import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import FormIndex from "../models/FormIndex.js";
import Company from "../models/Company.js";
import { tenantForCompanyId } from "../middleware/auth.js";
import { accessOf, canView } from "../utils/access.js";
import { assertStorageRoom, bumpStorage } from "../utils/storage.js";
import { httpError } from "../utils/http.js";
import { MAX_UPLOAD_MB, assertUploadAllowed, writeFile, findFile, streamFile, deleteFiles, verifySignature } from "../utils/uploads.js";

// Respondents' files for File Upload questions.
//   POST /api/uploads/:formId/:fieldId   raw body, Content-Type = the file's type, X-Filename = encoded name
//   GET  /api/uploads/:formId/:fileId    for people with access to the form, or with a signed link
// A file is "pending" until a submission references it; pending files older than a day are removed.
const router = Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many uploads from this connection. Please wait a minute." },
});
const raw = express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB + 1}mb` });

async function locate(req, formId, opts) {
  if (!/^[a-f\d]{24}$/i.test(formId)) throw httpError(404, "Form not found");
  const idx = await FormIndex.findById(formId);
  if (!idx) throw httpError(404, "Form not found");
  req.logCompanyId = idx.companyId;
  return { idx, tenant: await tenantForCompanyId(idx.companyId, opts) };
}

const PENDING_TTL_MS = 24 * 3600 * 1000;
async function purgePending(tenant, companyId) {
  const { bytes } = await deleteFiles(tenant, "uploads", { "metadata.submissionId": null, uploadDate: { $lt: new Date(Date.now() - PENDING_TTL_MS) } });
  if (bytes) await bumpStorage(companyId, -bytes);
}

router.post("/:formId/:fieldId", uploadLimiter, raw, async (req, res) => {
  const { idx, tenant } = await locate(req, req.params.formId, { publicFacing: true });
  if (!idx.publishedAt) throw httpError(403, "This form isn't accepting responses.");
  const form = await tenant.Form.findById(idx._id).lean();
  const field = form?.fields?.find((f) => f.id === req.params.fieldId && f.type === "file");
  if (!field) throw httpError(404, "That question doesn't take files.");
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const type = assertUploadAllowed(field, { contentType: req.header("content-type"), buffer });
  let name = "file";
  try { name = decodeURIComponent(req.header("x-filename") || "file"); } catch { /* keep default */ }
  name = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "file";
  const company = await Company.findById(idx.companyId);
  await assertStorageRoom(company, buffer.length, { forVisitor: true });
  purgePending(tenant, idx.companyId).catch(() => {});
  const id = await writeFile(tenant, "uploads", {
    filename: name, contentType: type, buffer,
    metadata: { formId: String(idx._id), fieldId: field.id, submissionId: null, contentType: type },
  });
  await bumpStorage(idx.companyId, buffer.length);
  res.status(201).json({ fileId: String(id), name, size: buffer.length, type });
});

router.get("/:formId/:fileId", async (req, res) => {
  const signed = verifySignature(req.params.formId, req.params.fileId, req.query.exp, req.query.sig);
  const { idx, tenant } = await locate(req, req.params.formId);
  if (!signed && !canView(accessOf(req, idx))) throw httpError(req.user ? 403 : 401, "Sign in to open this file.");
  const file = await findFile(tenant, "uploads", req.params.fileId);
  if (!file || file.metadata?.formId !== String(idx._id) || !file.metadata?.submissionId) throw httpError(404, "File not found");
  res.setHeader("Cache-Control", "private, max-age=300");
  await streamFile(tenant, "uploads", file, res, { download: req.query.download === "1" });
});

export default router;
