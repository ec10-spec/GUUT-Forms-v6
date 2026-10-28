import mongoose from "mongoose";
import crypto from "crypto";
import { decrypt } from "../utils/crypto.js";
import { FormSchema, SubmissionSchema, AnalysisChatSchema } from "../models/tenantSchemas.js";
import { isProd } from "./env.js";
import { httpError } from "../utils/http.js";

const CONN_OPTS = { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 };

// ---------------------------------------------------------------- platform DB
export async function connectPlatformDB() {
  let uri = process.env.MONGO_URI;
  if (!uri) {
    if (isProd) throw new Error("MONGO_URI is required in production.");
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    uri = (await MongoMemoryServer.create()).getUri();
    console.log("No MONGO_URI set: using a throwaway in-memory MongoDB (data resets on restart).");
  }
  const dbName = await choosePlatformDbName(uri);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, ...(dbName ? { dbName } : {}) });
  const name = mongoose.connection.name;
  console.log(`Platform DB connected (${mongoose.connection.host}/${name})`);
  if (name === "test") {
    console.warn("WARNING: the platform database is named \"test\", which is easy to drop by mistake. Copy it with `npm run migrate:platform-db` and set PLATFORM_DB_NAME=guut_platform (see SETUP.md).");
  }
}

const DEFAULT_PLATFORM_DB = "guut_platform";
/**
 * Which database holds accounts, companies and logs. PLATFORM_DB_NAME wins; otherwise the name in
 * MONGO_URI; otherwise "guut_platform". A URI with no name used to fall back to MongoDB's default "test",
 * so if "guut_platform" is still empty while "test" has accounts, keep using "test" until the data has
 * been copied over (scripts/migrate-platform-db.mjs), rather than starting on an empty database.
 */
export async function choosePlatformDbName(uri) {
  if (process.env.PLATFORM_DB_NAME) return process.env.PLATFORM_DB_NAME;
  if (parseMongoUri(uri)) return null; // the URI names its database
  const probe = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await probe.asPromise();
    const hasUsers = async (name) => (await probe.useDb(name, { useCache: false }).db.collection("users").estimatedDocumentCount().catch(() => 0)) > 0;
    if (!(await hasUsers(DEFAULT_PLATFORM_DB)) && (await hasUsers("test"))) {
      console.warn(`WARNING: accounts are still in the "test" database. Using it for now. Run \`npm run migrate:platform-db\` to move them to "${DEFAULT_PLATFORM_DB}".`);
      return "test";
    }
    return DEFAULT_PLATFORM_DB;
  } finally {
    await probe.close().catch(() => {});
  }
}

export function platformStatus() {
  const c = mongoose.connection;
  return { connected: c.readyState === 1, host: c.host || null, name: c.name || null };
}

// ------------------------------------------------------------ tenant (company)
function modelsFor(conn) {
  return {
    Form: conn.models.Form || conn.model("Form", FormSchema),
    Submission: conn.models.Submission || conn.model("Submission", SubmissionSchema),
    AnalysisChat: conn.models.AnalysisChat || conn.model("AnalysisChat", AnalysisChatSchema),
  };
}

export const tenantFromConnection = (conn, mode = "custom") => ({ mode, conn, ...modelsFor(conn) });

// Hosted storage: where individuals (and businesses that haven't linked their own
// database) keep their forms and responses. It is a SEPARATE database from the
// platform database that holds accounts, on the same cluster by default. Set
// HOSTED_DB_URI to put it on its own cluster. All data in it is only ever read
// through ids that were checked against the owning company (see FormIndex).
let hosted = null;
export function hostedTenant() {
  if (!hosted) {
    const conn = process.env.HOSTED_DB_URI
      ? mongoose.createConnection(process.env.HOSTED_DB_URI, CONN_OPTS)
      : mongoose.connection.useDb(process.env.HOSTED_DB_NAME || "guut_hosted", { useCache: true });
    hosted = tenantFromConnection(conn, "hosted");
  }
  return hosted;
}


const cache = new Map(); // companyId -> { fp, promise }

/** Returns the {Form, Submission} models bound to the company's database. */
export async function getTenant(company) {
  if (!company) throw httpError(403, "No workspace for this account.", { code: "NO_WORKSPACE" });
  if (!company.customUriEncrypted) return hostedTenant();
  const id = String(company._id);
  const fp = crypto.createHash("sha1").update(company.customUriEncrypted).digest("hex");
  const hit = cache.get(id);
  if (hit && hit.fp === fp) return hit.promise;
  if (hit) await dropTenant(id);

  const promise = (async () => {
    const conn = mongoose.createConnection(decrypt(company.customUriEncrypted), CONN_OPTS);
    try {
      await conn.asPromise();
    } catch (err) {
      await conn.close().catch(() => {});
      throw err;
    }
    conn.on("error", (e) => console.error(`[tenant ${id}] connection error:`, e.message));
    return tenantFromConnection(conn);
  })();
  cache.set(id, { fp, promise });
  try {
    return await promise;
  } catch (err) {
    cache.delete(id);
    throw httpError(503, "Couldn't reach your company's database. Ask your administrator to check the linked connection.", {
      code: "COMPANY_DB_DOWN",
      cause: err,
    });
  }
}

export async function dropTenant(companyId) {
  const hit = cache.get(String(companyId));
  cache.delete(String(companyId));
  if (hit) {
    try { await (await hit.promise).conn.close(); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------- validating a database URI
export function parseMongoUri(uri) {
  const m = /^mongodb(\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)\/([^?]+)/.exec(uri || "");
  if (!m) return null;
  return { host: m[2], dbName: decodeURIComponent(m[3]) };
}

/** Opens a connection, proves we can read AND write, and returns it (caller closes). */
export async function openVerifiedConnection(uri) {
  if (!/^mongodb(\+srv)?:\/\//.test(uri || "")) {
    throw httpError(400, "That doesn't look like a MongoDB connection string (it should start with mongodb:// or mongodb+srv://).");
  }
  const parsed = parseMongoUri(uri);
  if (!parsed) {
    throw httpError(400, "The connection string needs a database name, e.g. mongodb+srv://user:pass@cluster.mongodb.net/acme_forms");
  }
  const conn = mongoose.createConnection(uri, CONN_OPTS);
  try {
    await conn.asPromise();
    const col = conn.db.collection("_guut_healthcheck");
    const { insertedId } = await col.insertOne({ at: new Date() });
    await col.deleteOne({ _id: insertedId });
  } catch (err) {
    await conn.close().catch(() => {});
    throw httpError(400, `Couldn't connect with read/write access: ${String(err.message).replace(/mongodb(\+srv)?:\/\/\S+/g, "[uri]")}`);
  }
  return { conn, ...parsed };
}
