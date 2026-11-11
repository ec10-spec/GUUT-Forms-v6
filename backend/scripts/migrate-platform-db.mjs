// One-off: copy the platform collections from the database MongoDB defaulted to ("test") into a properly
// named one ("guut_platform"). Nothing is deleted; run it, check the app, then drop "test" yourself.
//
//   MONGO_URI="mongodb+srv://..." node scripts/migrate-platform-db.mjs [--from test] [--to guut_platform] [--dry-run]
//
// Then set PLATFORM_DB_NAME=guut_platform on Render and redeploy.
import "dotenv/config";
import mongoose from "mongoose";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const from = arg("from", "test");
const to = arg("to", process.env.PLATFORM_DB_NAME || "guut_platform");
const dryRun = process.argv.includes("--dry-run");
const COLLECTIONS = ["users", "companies", "formindexes", "logs", "teams", "tokenusages", "notifystates"];

if (!process.env.MONGO_URI) { console.error("Set MONGO_URI first."); process.exit(1); }
if (from === to) { console.error("--from and --to must differ."); process.exit(1); }

const conn = await mongoose.createConnection(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
const src = conn.useDb(from, { useCache: false }).db;
const dst = conn.useDb(to, { useCache: false }).db;
console.log(`Copying ${from} -> ${to}${dryRun ? " (dry run)" : ""}`);
let problems = 0;
for (const name of COLLECTIONS) {
  const docs = await src.collection(name).find({}).toArray();
  const existing = await dst.collection(name).countDocuments();
  if (dryRun) { console.log(`  ${name}: ${docs.length} to copy, ${existing} already in ${to}`); continue; }
  if (docs.length) {
    try { await dst.collection(name).insertMany(docs, { ordered: false }); }
    catch (e) { if (e.code !== 11000 && e.writeErrors?.[0]?.code !== 11000) throw e; }
  }
  // Recreate indexes (unique email, TTL on logs, and so on).
  for (const ix of await src.collection(name).indexes().catch(() => [])) {
    if (ix.name === "_id_") continue;
    const { key, name: ixName, v, ns, ...opts } = ix;
    await dst.collection(name).createIndex(key, { name: ixName, ...opts }).catch((e) => console.warn(`  index ${name}.${ixName}: ${e.message}`));
  }
  const n = await dst.collection(name).countDocuments();
  const ok = n >= docs.length;
  if (!ok) problems++;
  console.log(`  ${name}: ${docs.length} in ${from}, ${n} in ${to} ${ok ? "ok" : "MISMATCH"}`);
}
await conn.close();
if (dryRun) process.exit(0);
console.log(problems ? `\n${problems} collection(s) did not match. Do not switch yet.` : `\nDone. Set PLATFORM_DB_NAME=${to} on Render, redeploy, sign in to check, then drop "${from}" in Atlas.`);
process.exit(problems ? 1 : 0);
