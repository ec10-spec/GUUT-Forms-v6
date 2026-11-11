import mongoose from "mongoose";
import Company from "../models/Company.js";
import FormIndex from "../models/FormIndex.js";
import { getTenant } from "../config/db.js";
import { httpError } from "./http.js";
import { INDIVIDUAL, planById, billingEnforced } from "./plans.js";
import { fileBytesByForm } from "./uploads.js";

// ---------------------------------------------------------------------------
// STORAGE TRACKING. Each form and response stores its own approximate size
// (sizeBytes); the company keeps a running total that is updated on every write
// and can be recalculated from scratch. Businesses that linked their OWN
// database are never capped (it's their storage); hosted accounts can be.
// ---------------------------------------------------------------------------
const BSON = mongoose.mongo.BSON;
const plain = (d) => (d?.toObject ? d.toObject() : d) || {};

export const formSize = (f) => {
  const o = plain(f);
  return BSON.calculateObjectSize({ title: o.title || "", description: o.description || "", fields: o.fields || [], theme: o.theme || {} }) + 100;
};
export const submissionSize = (answers) => BSON.calculateObjectSize({ answers: answers || {} }) + 64;

export const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
};

/** null = no cap. */
export function storageLimitBytes(company) {
  if (!company || company.customUriEncrypted) return null; // their own database
  const toBytes = (mb) => (mb == null || Number.isNaN(mb) ? null : Math.round(mb * 1048576));
  if (company.type === "individual") return toBytes(INDIVIDUAL.limits().maxStorageMb);
  if (billingEnforced()) return toBytes(planById(company.billing?.plan)?.maxStorageMb ?? null);
  return null;
}

export const bumpStorage = async (companyId, delta) => {
  if (delta) await Company.updateOne({ _id: companyId }, { $inc: { "storage.bytes": Math.round(delta) }, $set: { "storage.updatedAt": new Date() } });
};

const chunks = (arr, n = 50) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Re-measures every form and response of a company and stores the exact total. Also fills in sizes for older data. */
export async function recalculateStorage(company) {
  const tenant = await getTenant(company);
  const ids = (await FormIndex.find({ companyId: company._id }).select("_id")).map((i) => i._id);
  let total = 0;
  for (const chunk of chunks(ids)) {
    const ops = [];
    for (const f of await tenant.Form.find({ _id: { $in: chunk } }).lean()) {
      const size = formSize(f);
      total += size;
      if (f.sizeBytes !== size) ops.push({ updateOne: { filter: { _id: f._id }, update: { $set: { sizeBytes: size } } } });
    }
    if (ops.length) await tenant.Form.bulkWrite(ops);
    let batch = [];
    for await (const s of tenant.Submission.find({ formId: { $in: chunk } }).select("answers sizeBytes").lean().cursor()) {
      const size = submissionSize(s.answers);
      total += size;
      if (s.sizeBytes !== size) batch.push({ updateOne: { filter: { _id: s._id }, update: { $set: { sizeBytes: size } } } });
      if (batch.length >= 500) { await tenant.Submission.bulkWrite(batch); batch = []; }
    }
    if (batch.length) await tenant.Submission.bulkWrite(batch);
    for (const b of (await fileBytesByForm(tenant, chunk)).values()) total += b; // uploaded files and header images
  }
  const verifiedAt = new Date();
  await Company.updateOne({ _id: company._id }, { $set: { "storage.bytes": total, "storage.verifiedAt": verifiedAt, "storage.updatedAt": verifiedAt } });
  company.storage = { bytes: total, verifiedAt, updatedAt: verifiedAt };
  return total;
}

export async function ensureStorageKnown(company) {
  if (!company.storage?.verifiedAt) await recalculateStorage(company);
}

/** Throws if adding addBytes would push a capped company over its limit. Shrinking is always allowed. */
export async function assertStorageRoom(company, addBytes, { forVisitor = false } = {}) {
  const limit = storageLimitBytes(company);
  if (limit == null || addBytes <= 0) return;
  await ensureStorageKnown(company);
  const used = company.storage?.bytes || 0;
  if (used + addBytes <= limit) return;
  if (forVisitor) throw httpError(503, "This form can't accept responses right now.", { code: "STORAGE_LIMIT" });
  throw httpError(402, `Storage is full (${fmtBytes(used)} of ${fmtBytes(limit)}). Delete forms or responses${company.type === "individual" ? ", or upgrade" : ", or ask your admin to upgrade the plan"}.`, { code: "STORAGE_LIMIT" });
}

/** { formId -> { bytes, responses } } including each form's own size. */
export async function formStats(tenant, formIds) {
  const out = new Map();
  for (const chunk of chunks(formIds)) {
    for (const f of await tenant.Form.find({ _id: { $in: chunk } }).select("title ownerId sizeBytes").lean()) {
      out.set(String(f._id), { title: f.title, ownerId: f.ownerId, bytes: f.sizeBytes || 0, responses: 0 });
    }
    // Sizes come from one grouped sum; response counts use plain counts, which behave the same on every
    // MongoDB-compatible host (a grouped $sum of 1 doesn't).
    const agg = await tenant.Submission.aggregate([
      { $match: { formId: { $in: chunk } } },
      { $group: { _id: "$formId", bytes: { $sum: "$sizeBytes" } } },
    ]);
    for (const r of agg) {
      const row = out.get(String(r._id));
      if (row) row.bytes += r.bytes || 0;
    }
    for (const [id, b] of await fileBytesByForm(tenant, chunk)) {
      const row = out.get(String(id));
      if (row) row.bytes += b;
    }
    await Promise.all(chunk.map(async (id) => {
      const row = out.get(String(id));
      if (row) row.responses = await tenant.Submission.countDocuments({ formId: id });
    }));
  }
  return out;
}

/** Writes a new/changed form's measured size and adjusts the company total by the difference. */
export async function recordFormSize(tenant, companyId, formDoc, previous = 0) {
  const size = formSize(formDoc);
  await tenant.Form.updateOne({ _id: formDoc._id }, { $set: { sizeBytes: size } });
  await bumpStorage(companyId, size - previous);
  return size;
}
