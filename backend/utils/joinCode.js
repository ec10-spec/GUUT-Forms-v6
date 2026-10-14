import crypto from "crypto";
import Company from "../models/Company.js";

// Employees join a business with its code (no company directory is ever exposed).
// 8 characters from an unambiguous alphabet = about 40 bits, and sign-ups are rate limited.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const normalizeJoinCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatJoinCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : null);

export async function uniqueJoinCode() {
  for (let i = 0; i < 10; i++) {
    const bytes = crypto.randomBytes(8);
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    if (!(await Company.exists({ joinCode: code }))) return code;
  }
  throw new Error("Couldn't generate a unique company code.");
}
