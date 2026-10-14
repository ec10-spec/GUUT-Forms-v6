import Log from "../models/Log.js";

// Backend logging. Everything lands in the platform database's "logs"
// collection (and the console). Writing a log must NEVER break a request, so
// log() swallows its own errors and callers don't need to await it.

const SECRET_KEY = /pass|token|secret|key|authorization|uri|cookie/i;

function redact(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (value instanceof Date) return value;
  if (typeof value.toHexString === "function") return value.toHexString(); // ObjectId -> plain string
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return typeof value === "string" && value.length > 500 ? value.slice(0, 500) + "…" : value;
}

export function log({ level = "info", category = "system", message = "", req, err, statusCode, durationMs, meta, extra = {} }) {
  const entry = {
    level,
    category,
    message: String(err?.message || message).slice(0, 2000),
    stack: err?.stack ? String(err.stack).slice(0, 8000) : "",
    statusCode: statusCode ?? null,
    durationMs: durationMs ?? null,
    meta: meta ? redact(meta) : null,
    ...extra,
  };
  if (req) {
    entry.route = `${req.method} ${(req.originalUrl || "").split("?")[0]}`;
    entry.ip = req.ip || "";
    entry.userAgent = req.header?.("user-agent") || "";
    entry.userId = req.userId || null;
    entry.companyId = req.logCompanyId ? String(req.logCompanyId) : req.user?.companyId ? String(req.user.companyId) : null;
  }
  const line = `[${level}] [${category}] ${entry.message}${entry.route ? ` (${entry.route})` : ""}`;
  (level === "error" ? console.error : console.log)(line);
  return Log.create(entry).catch((e) => console.error("Failed to write log:", e.message));
}

export const logger = {
  info: (category, message, opts = {}) => log({ level: "info", category, message, ...opts }),
  warn: (category, message, opts = {}) => log({ level: "warn", category, message, ...opts }),
  error: (category, message, opts = {}) => log({ level: "error", category, message, ...opts }),
};

/** Logs 403 / 429 responses and slow non-AI requests. Errors are logged by the error handler. */
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    if (status === 403 || status === 429) {
      log({ level: "warn", category: "http", message: status === 429 ? "Rate limit hit" : "Forbidden", req, statusCode: status, durationMs: ms });
    } else if (ms > 4000 && status < 500 && !/^\/api\/(ai|analysis)\b/.test(req.originalUrl)) {
      log({ level: "warn", category: "http", message: "Slow request", req, statusCode: status, durationMs: ms });
    }
  });
  next();
}
