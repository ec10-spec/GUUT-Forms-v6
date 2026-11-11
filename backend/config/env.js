// Fail fast in production if the secrets that protect user data are missing,
// instead of silently running with insecure dev defaults.
export const isProd = process.env.NODE_ENV === "production";

export function assertEnv() {
  if (!isProd) return;
  const problems = [];
  if (!process.env.MONGO_URI) problems.push("MONGO_URI is required (without it every restart wipes all data).");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) problems.push("JWT_SECRET must be set to a long random string (24+ chars).");
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 24) problems.push("ENCRYPTION_KEY must be set to a long random string (24+ chars).");
  if (problems.length) {
    console.error("\nCannot start in production:\n - " + problems.join("\n - ") + "\n");
    process.exit(1);
  }
}

export const flag = (name, def) => {
  const v = process.env[name];
  return v === undefined || v === "" ? def : !["false", "0", "no"].includes(v.toLowerCase());
};
