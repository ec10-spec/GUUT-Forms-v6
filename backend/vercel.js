import mongoose from "mongoose";
import { attachDatabasePool } from "@vercel/functions";
import app, { init } from "./app.js";
import { flushDue } from "./utils/notify.js";
import { mailEnabled } from "./utils/mailer.js";
import { warnIfMisconfigured } from "./utils/emailVerification.js";
import { background } from "./utils/background.js";

// Request handler for Vercel (wired up in api/index.js). Each warm instance connects to the
// database once and reuses the connection. There is no long-running timer, so the
// notification digest check also runs here, at most once every DIGEST_CHECK_MS per instance,
// in the background after the reply. Vercel Cron (/api/cron/tick) covers quiet periods.

const DIGEST_CHECK_MS = 2 * 60 * 1000;
let lastDigestCheck = 0;
let pooled = false;

function afterReady() {
  if (!pooled) {
    pooled = true;
    // Lets Vercel close idle database connections cleanly before an instance is suspended.
    try { attachDatabasePool(mongoose.connection.getClient()); } catch { /* optional */ }
    warnIfMisconfigured();
  }
  const now = Date.now();
  if (mailEnabled() && now - lastDigestCheck > DIGEST_CHECK_MS) {
    lastDigestCheck = now;
    background(flushDue());
  }
}

/**
 * vercel.json rewrites /api/<anything> to this one function and passes <anything> as a "path"
 * query parameter. Vercel normally keeps the original URL in req.url; this makes sure Express
 * always sees /api/<anything> and never the extra parameter, whichever form arrives.
 */
export function restoreUrl(req) {
  const q = req.url.indexOf("?");
  if (q < 0) return;
  const pathname = req.url.slice(0, q);
  const params = new URLSearchParams(req.url.slice(q + 1));
  const p = params.get("path");
  if (p == null) return;
  const rest = p.replace(/^\/+/, "");
  if (pathname === "/api" || pathname === "/api/") {
    params.delete("path");
  } else if (pathname === `/api/${rest}`) {
    params.delete("path");
  } else {
    return; // a genuine "path" query parameter on a normal URL: leave it alone
  }
  const qs = params.toString();
  req.url = `/api/${rest}${qs ? `?${qs}` : ""}`;
}

/** Reads the copy of the body that Vercel's helpers replay through req.on("data"/"end"). */
function replay(req, ms = 3000) {
  return new Promise((resolve) => {
    const chunks = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(chunks.length ? Buffer.concat(chunks) : null);
    };
    const timer = setTimeout(finish, ms);
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", finish);
    req.on("error", finish);
  });
}

/**
 * Vercel's Node.js helpers can read the request body before the app runs, which leaves the
 * stream unreadable and makes express.json/express.raw fail ("stream is not readable").
 * When that has happened, hand Express the body directly (req._body tells body-parser it is
 * already done): JSON as an object, anything else (file uploads, header images) as a Buffer.
 * When the stream is untouched (helpers off, NODEJS_HELPERS=0), this does nothing.
 * Returns false if the body was invalid JSON and a 400 was sent.
 */
export async function adoptConsumedBody(req, res) {
  if (req.readable !== false || req._body) return true;
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const isJson = type === "application/json" || type.endsWith("+json");
  // The helpers replay the body by replacing req.read/req.on on the request itself.
  const replayable = Object.prototype.hasOwnProperty.call(req, "read");
  let raw = replayable ? await replay(req) : null;
  if (raw == null) {
    // Not replayed: fall back to what the helpers parsed.
    let parsed;
    try { parsed = req.body; } catch { parsed = undefined; if (isJson) return badJson(res); }
    if (Buffer.isBuffer(parsed)) raw = parsed;
    else if (typeof parsed === "string") raw = Buffer.from(parsed);
    else if (parsed && typeof parsed === "object") { req.body = parsed; req._body = true; return true; }
    else raw = Buffer.alloc(0);
  }
  if (isJson) {
    try { req.body = raw.length ? JSON.parse(raw.toString("utf8")) : {}; } catch { return badJson(res); }
  } else {
    req.body = raw;
  }
  req._body = true;
  return true;
}

function badJson(res) {
  res.statusCode = 400;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "The request body isn't valid JSON." }));
  return false;
}

export default async function handler(req, res) {
  restoreUrl(req);
  // The helpers' req.query was parsed from the URL before restoreUrl; let Express parse it again.
  if (Object.prototype.hasOwnProperty.call(req, "query")) delete req.query;
  if (!(await adoptConsumedBody(req, res))) return;
  // The helpers also put their own send/json/status/redirect on the response; remove them so
  // Express's versions (headers, ETags, HEAD handling) apply exactly as on a normal server.
  for (const k of ["send", "json", "status", "redirect"]) if (Object.prototype.hasOwnProperty.call(res, k)) delete res[k];
  try {
    await init();
  } catch (err) {
    console.error("Start-up failed:", err.message);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({ error: "The service is starting up or can't reach its database. Please try again in a moment." }));
  }
  afterReady();
  return app(req, res);
}
