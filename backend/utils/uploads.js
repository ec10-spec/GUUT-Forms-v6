import crypto from "crypto";
import mongoose from "mongoose";
import { httpError } from "./http.js";

// Files that respondents attach to File Upload questions, and header images for forms. Both are stored
// in the form's own tenant database (GridFS), never inside the form or response documents, so a form
// loads quickly and the data stays where the company keeps the rest of its responses.
//   bucket "uploads": respondents' files. metadata { formId, fieldId, submissionId|null }
//   bucket "assets":  header images.      metadata { formId, kind: "header" }

export const MAX_UPLOAD_MB = 10;
export const MAX_HEADER_BYTES = 2 * 1024 * 1024;

// Kinds a form owner can allow per question. Each lists MIME types and, where possible, a byte signature.
export const FILE_KINDS = {
  image: { label: "Images", types: ["image/png", "image/jpeg", "image/gif", "image/webp"] },
  pdf: { label: "PDF", types: ["application/pdf"] },
  document: { label: "Word documents", types: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  spreadsheet: { label: "Spreadsheets", types: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"] },
  text: { label: "Plain text", types: ["text/plain"] },
};
export const DEFAULT_KINDS = ["image", "pdf"];

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
/** Checks the first bytes so a renamed file can't pretend to be an image or a PDF. */
export function sniffOk(type, buf) {
  if (!buf?.length) return false;
  switch (type) {
    case "image/png": return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
    case "image/jpeg": return startsWith(buf, [0xff, 0xd8, 0xff]);
    case "image/gif": return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp": return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.slice(8, 12).toString() === "WEBP";
    case "application/pdf": return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
    case "application/msword":
    case "application/vnd.ms-excel": return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0]);
    case "text/plain":
    case "text/csv": return !buf.slice(0, 4096).includes(0);
    default: return false;
  }
}

export const allowedTypesFor = (field) => {
  const kinds = (field.accept?.length ? field.accept : DEFAULT_KINDS).filter((k) => FILE_KINDS[k]);
  return new Set(kinds.flatMap((k) => FILE_KINDS[k].types));
};
export const maxBytesFor = (field) => Math.min(MAX_UPLOAD_MB, Math.max(1, Number(field.maxSizeMb) || MAX_UPLOAD_MB)) * 1024 * 1024;

export const bucket = (tenant, name) => new mongoose.mongo.GridFSBucket(tenant.conn.db, { bucketName: name });
const filesCol = (tenant, name) => tenant.conn.db.collection(`${name}.files`);
export const oid = (id) => (mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(String(id)) : null);

export function writeFile(tenant, name, { filename, contentType, buffer, metadata }) {
  return new Promise((resolve, reject) => {
    const up = bucket(tenant, name).openUploadStream(filename, { contentType, metadata });
    up.on("error", reject);
    up.on("finish", () => resolve(up.id));
    up.end(buffer);
  });
}

export const findFile = (tenant, name, id) => (oid(id) ? filesCol(tenant, name).findOne({ _id: oid(id) }) : null);

export async function streamFile(tenant, name, file, res, { download = false } = {}) {
  res.setHeader("Content-Type", file.contentType || file.metadata?.contentType || "application/octet-stream");
  res.setHeader("Content-Length", file.length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  const safe = String(file.filename || "file").replace(/[^\w.\- ]+/g, "_");
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${safe}"`);
  await new Promise((resolve, reject) => {
    bucket(tenant, name).openDownloadStream(file._id).on("error", reject).on("end", resolve).pipe(res);
  });
}

export async function deleteFiles(tenant, name, filter) {
  const b = bucket(tenant, name);
  const rows = await filesCol(tenant, name).find(filter).project({ _id: 1, length: 1 }).toArray();
  let bytes = 0;
  for (const r of rows) { await b.delete(r._id).catch(() => {}); bytes += r.length || 0; }
  return { count: rows.length, bytes };
}

/** Total bytes of uploaded files and header images per form id. */
export async function fileBytesByForm(tenant, formIds) {
  const out = new Map();
  if (!formIds.length) return out;
  for (const name of ["uploads", "assets"]) {
    try {
      const rows = await filesCol(tenant, name).find({ "metadata.formId": { $in: formIds.map(String) } }).project({ length: 1, "metadata.formId": 1 }).toArray();
      for (const r of rows) out.set(r.metadata.formId, (out.get(r.metadata.formId) || 0) + (r.length || 0));
    } catch { /* bucket not created yet */ }
  }
  return out;
}

// ---- signed links (used in CSV exports and the Responses table, where an Authorization header can't be sent)
const secret = () => process.env.JWT_SECRET || "guut-forms-dev-secret-change-me";
const sign = (s) => crypto.createHmac("sha256", secret()).update(s).digest("base64url").slice(0, 32);
export function signedFileUrl(formId, fileId, ttlSec = 24 * 3600, base = "") {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${base}/api/uploads/${formId}/${fileId}?exp=${exp}&sig=${sign(`${formId}.${fileId}.${exp}`)}`;
}
export function verifySignature(formId, fileId, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = sign(`${formId}.${fileId}.${exp}`);
  return want.length === String(sig).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig)));
}

/** Validates a raw upload against a File Upload question. Throws a 400 with a clear message. */
export function assertUploadAllowed(field, { contentType, buffer }) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const allowed = allowedTypesFor(field);
  if (!allowed.has(type)) {
    const kinds = (field.accept?.length ? field.accept : DEFAULT_KINDS).map((k) => FILE_KINDS[k]?.label).filter(Boolean).join(", ");
    throw httpError(400, `That type of file isn't accepted here. Allowed: ${kinds}.`, { code: "FILE_TYPE" });
  }
  if (!buffer?.length) throw httpError(400, "That file is empty.");
  const max = maxBytesFor(field);
  if (buffer.length > max) throw httpError(413, `That file is larger than ${Math.round(max / 1048576)} MB.`, { code: "FILE_TOO_LARGE" });
  if (!sniffOk(type, buffer)) throw httpError(400, "That file's contents don't match its type.", { code: "FILE_TYPE" });
  return type;
}
