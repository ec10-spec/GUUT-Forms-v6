import crypto from "crypto";

// Encrypts secrets at rest: users' AI API keys and companies' database URIs.
// ENCRYPTION_KEY is required in production (see config/env.js). The fallbacks
// exist only so local development works with zero setup.
// Read lazily so values from .env are always honoured.
function key() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "guut-forms-dev-secret-change-me";
  return crypto.createHash("sha256").update(secret).digest(); // 32 bytes for AES-256
}

/** Encrypts a UTF-8 string into one base64 blob (iv + authTag + ciphertext). */
export function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/** Reverses encrypt(). Throws if malformed or the ENCRYPTION_KEY changed. */
export function decrypt(blob) {
  const buf = Buffer.from(blob, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
