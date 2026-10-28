// Exports the platform database and the hosted forms database to gzipped Extended JSON files, one per
// collection, in ./backups/<timestamp>/. Works on the Atlas free tier (which has no automated backups)
// and needs no mongodump binary. Restore with scripts/restore.mjs.
//
//   MONGO_URI="mongodb+srv://..." node scripts/backup.mjs [--out ./backups] [--keep 14]
//
// Databases: PLATFORM_DB_NAME (or the one MONGO_URI/startup picks) and HOSTED_DB_NAME (default guut_hosted).
// Companies that linked their own database are responsible for backing that database up themselves.
import "dotenv/config";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import mongoose from "mongoose";
import { choosePlatformDbName } from "../config/db.js";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const outRoot = path.resolve(arg("out", "./backups"));
const keep = Number(arg("keep", 14));
if (!process.env.MONGO_URI) { console.error("Set MONGO_URI first."); process.exit(1); }

const { EJSON } = mongoose.mongo.BSON;
const conn = await mongoose.createConnection(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
const platform = (await choosePlatformDbName(process.env.MONGO_URI)) || conn.name;
const dbs = [...new Set([platform, process.env.HOSTED_DB_NAME || "guut_hosted"])];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(outRoot, stamp);
fs.mkdirSync(dir, { recursive: true });
const manifest = { at: new Date().toISOString(), databases: {} };
for (const name of dbs) {
  const db = conn.useDb(name, { useCache: false }).db;
  manifest.databases[name] = {};
  for (const { name: col } of await db.listCollections().toArray()) {
    const file = path.join(dir, `${name}.${col}.ejson.gz`);
    const gz = zlib.createGzip();
    const ws = fs.createWriteStream(file);
    gz.pipe(ws);
    let n = 0;
    for await (const doc of db.collection(col).find({})) { gz.write(EJSON.stringify(doc, { relaxed: false }) + "\n"); n++; }
    gz.end();
    await new Promise((r) => ws.on("finish", r));
    manifest.databases[name][col] = n;
    console.log(`  ${name}.${col}: ${n}`);
  }
}
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
await conn.close();
// Keep the newest N backups.
const old = fs.readdirSync(outRoot).filter((d) => fs.statSync(path.join(outRoot, d)).isDirectory()).sort().slice(0, -keep);
for (const d of old) fs.rmSync(path.join(outRoot, d), { recursive: true, force: true });
console.log(`Backup written to ${dir}`);
