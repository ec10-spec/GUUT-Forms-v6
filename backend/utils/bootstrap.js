import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "../models/User.js";
import Company from "../models/Company.js";
import { isProd } from "../config/env.js";
import { logger } from "./logger.js";

/** Creates the first superadmin from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD if missing. */
export async function ensureSuperadmin() {
  let email = (process.env.SUPERADMIN_EMAIL || "").toLowerCase().trim();
  let password = process.env.SUPERADMIN_PASSWORD || "";

  if (!email || !password) {
    if (await User.exists({ role: "superadmin" })) return;
    if (isProd) {
      console.warn("WARNING: no superadmin exists and SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD are not set. Set them and redeploy.");
      return;
    }
    email = "admin@guut.local";
    password = crypto.randomBytes(9).toString("base64url");
    console.log(`\nDev superadmin created -> ${email} / ${password}\n(set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in backend/.env to choose your own)\n`);
  }

  let user = await User.findOne({ email });
  if (user) {
    if (user.role !== "superadmin") {
      user.role = "superadmin";
      await user.save();
      logger.info("admin", `Existing user promoted to superadmin: ${email}`);
    }
    return;
  }
  const company = await Company.create({ name: "GUUT (platform)" });
  await User.create({
    email, name: process.env.SUPERADMIN_NAME || "Admin", role: "superadmin",
    companyId: company._id, passwordHash: await bcrypt.hash(password, 10),
  });
  logger.info("admin", `Superadmin created: ${email}`);
}

/** One-time upgrade: any user without a company gets one. */
export async function migrateLegacyData() {
  // Employees waiting for a company's approval legitimately have no company yet.
  for (const u of await User.find({ companyId: null, "membership.status": { $nin: ["pending", "declined"] } })) {
    const c = await Company.create({ name: `${u.name || u.email.split("@")[0]}'s workspace`, type: "individual" });
    u.companyId = c._id;
    await u.save();
  }
}
