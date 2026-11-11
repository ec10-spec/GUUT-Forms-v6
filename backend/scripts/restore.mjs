// Restores a backup made by scripts/backup.mjs into a database (default: a NEW database with a
// "_restore" suffix, so nothing live is overwritten; check it, then point the app at it).
//
//   MONGO_URI="..." node scripts/restore.mjs ./backups/<timestamp> [--db guut_platform] [--suffix _restore]
import "dotenv/config";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import readline from "readline";
import mongoose from "mongoose";

const dir = process.argv[2];
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const only = arg("db", null);
const suffix = arg("suffix", "_restore");
if (!dir || !fs.existsSync(path.join(dir, "manifest.json"))) { console.error("Usage: node scripts/restore.mjs <backup folder>"); process.exit(1); }
const { EJSON } = mongoose.mongo.BSON;
const conn = await mongoose.createConnection(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ejson.gz"))) {
  const [db, ...rest] = file.replace(/\.ejson\.gz$/, "").split(".");
  if (only && db !== only) continue;
  const col = rest.join(".");
  const target = conn.useDb(db + suffix, { useCache: false }).db.collection(col);
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, file)).pipe(zlib.createGunzip()) });
  let batch = [], n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(EJSON.parse(line, { relaxed: false }));
    if (batch.length >= 500) { await target.insertMany(batch, { ordered: false }).catch(() => {}); n += batch.length; batch = []; }
  }
  if (batch.length) { await target.insertMany(batch, { ordered: false }).catch(() => {}); n += batch.length; }
  console.log(`  ${db + suffix}.${col}: ${n}`);
}
await conn.close();
