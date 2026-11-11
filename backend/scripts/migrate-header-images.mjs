// One-off: moves header images that older forms embedded as base64 (data: URLs) into the "assets" file
// store and replaces them with a URL. Shrinks each affected form by the size of its image.
//
//   MONGO_URI="..." node scripts/migrate-header-images.mjs [--dry-run]
// Covers the hosted database. For a company with its own database, set HOSTED_DB_URI to that database's link.
import "dotenv/config";
import mongoose from "mongoose";
import { connectPlatformDB, hostedTenant } from "../config/db.js";
import { writeFile } from "../utils/uploads.js";
import { recalculateStorage } from "../utils/storage.js";
import Company from "../models/Company.js";
import FormIndex from "../models/FormIndex.js";

const dryRun = process.argv.includes("--dry-run");
await connectPlatformDB();
const tenant = hostedTenant();
const forms = await tenant.Form.find({ "theme.headerImage": /^data:image\// });
const touched = new Set();
for (const f of forms) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/s.exec(f.theme.headerImage);
  if (!m) { console.log(`  skip ${f._id}: unsupported image`); continue; }
  const buffer = Buffer.from(m[2], "base64");
  console.log(`  ${f._id} "${f.title}": ${Math.round(buffer.length / 1024)} KB`);
  if (dryRun) continue;
  const id = await writeFile(tenant, "assets", { filename: `header-${f._id}`, contentType: m[1], buffer, metadata: { formId: String(f._id), kind: "header", contentType: m[1] } });
  f.theme.headerImage = `/api/forms/${f._id}/header-image/${id}`;
  await f.save();
  const idx = await FormIndex.findById(f._id).select("companyId");
  if (idx) touched.add(String(idx.companyId));
}
for (const id of touched) { const c = await Company.findById(id); if (c && !c.customUriEncrypted) await recalculateStorage(c); }
console.log(`${dryRun ? "Would move" : "Moved"} ${forms.length} image(s).`);
await mongoose.disconnect();
