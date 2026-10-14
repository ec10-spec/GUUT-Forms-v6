import FormIndex from "../models/FormIndex.js";
import { getTenant, dropTenant, openVerifiedConnection, tenantFromConnection } from "../config/db.js";
import { encrypt } from "./crypto.js";
import { httpError } from "./http.js";
import { logger } from "./logger.js";

const DEFAULT_DB_NAME = "guut_forms";

/**
 * Makes pasting a connection link forgiving: trims quotes/spaces, explains the
 * classic "<password>" mistake, and adds a database name when the link has none
 * (Atlas's default link doesn't include one).
 */
export function normalizeUri(raw) {
  const uri = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!uri) throw httpError(400, "Paste your database link first.");
  if (/<\s*(db_)?password\s*>/i.test(uri)) {
    throw httpError(400, "Your link still contains <password>. Replace it (brackets included) with your database user's real password.");
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw httpError(400, "That doesn't look like a MongoDB link. It should start with mongodb:// or mongodb+srv://");
  }
  const m = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!m) throw httpError(400, "Couldn't read that link. Copy it again from your database provider.");
  const [, head, path, query] = m;
  return head + (!path || path === "/" ? `/${DEFAULT_DB_NAME}` : path) + (query || "");
}

/** Copies a company's forms + responses between databases. Never deletes the source; existing _ids are skipped. */
export async function copyCompanyData(companyId, from, to) {
  const ids = await FormIndex.find({ companyId }).distinct("_id");
  const stats = { forms: 0, submissions: 0 };
  const insert = async (model, docs, key) => {
    if (!docs.length) return;
    try {
      stats[key] += (await model.collection.insertMany(docs, { ordered: false })).insertedCount;
    } catch (e) {
      if (e.code !== 11000 && e.writeErrors?.[0]?.code !== 11000) throw e; // duplicates are fine
      stats[key] += e.insertedCount || 0;
    }
  };
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await insert(to.Form, await from.Form.find({ _id: { $in: chunk } }).lean(), "forms");
    let batch = [];
    for await (const s of from.Submission.find({ formId: { $in: chunk } }).lean().cursor()) {
      batch.push(s);
      if (batch.length >= 500) { await insert(to.Submission, batch, "submissions"); batch = []; }
    }
    await insert(to.Submission, batch, "submissions");
  }
  // Prove the copy is complete before anyone deletes the source.
  let srcSubs = 0;
  for (let i = 0; i < ids.length; i += 100) srcSubs += await from.Submission.countDocuments({ formId: { $in: ids.slice(i, i + 100) } });
  let dstForms = 0, dstSubs = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    dstForms += await to.Form.countDocuments({ _id: { $in: chunk } });
    dstSubs += await to.Submission.countDocuments({ formId: { $in: chunk } });
  }
  stats.verified = dstForms === ids.length && dstSubs === srcSubs;
  stats.sourceIds = ids;
  return stats;
}

/** Validates the link, optionally copies existing data across, then saves it (encrypted) on the company. */
export async function linkDatabase({ company, rawUri, migrate, req }) {
  const uri = normalizeUri(rawUri);
  const { conn, host, dbName } = await openVerifiedConnection(uri);
  let migrated = null;
  try {
    if (migrate) {
      const source = await getTenant(company);
      migrated = await copyCompanyData(company._id, source, tenantFromConnection(conn));
      // Moving off our hosted storage: once the copy is verified, remove it from the shared
      // hosted database so the company's data lives only in its own database.
      if (source.mode === "hosted" && migrated.verified) {
        for (let i = 0; i < migrated.sourceIds.length; i += 100) {
          const chunk = migrated.sourceIds.slice(i, i + 100);
          await source.Submission.deleteMany({ formId: { $in: chunk } });
          await source.Form.deleteMany({ _id: { $in: chunk } });
        }
        migrated.removedFromHosted = true;
      }
      delete migrated.sourceIds;
    }
  } finally {
    await conn.close();
  }
  company.customUriEncrypted = encrypt(uri);
  company.dbHost = host;
  company.dbName = dbName;
  company.dbCheckedAt = new Date();
  company.dbLinkedBy = req.userId;
  await company.save();
  await dropTenant(company._id);
  logger.info("admin", `Database linked for ${company.name}: ${host}/${dbName}`, { req, meta: { companyId: company._id, migrated } });
  return { company, migrated };
}

export async function checkDatabase(company, req) {
  try {
    await getTenant(company);
    company.dbCheckedAt = new Date();
    await company.save();
    return { ok: true };
  } catch (err) {
    logger.error("db", `Company database unreachable: ${company.name}`, { req: { ...req, logCompanyId: company._id, method: req.method, originalUrl: req.originalUrl, userId: req.userId }, err: err.cause || err });
    return { ok: false, error: "Couldn't connect. Check the link, the database user's password, and that the database allows outside connections." };
  }
}
