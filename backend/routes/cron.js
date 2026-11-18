import { Router } from "express";
import crypto from "crypto";
import { flushDue } from "../utils/notify.js";
import { purgeStaleUnverified } from "../utils/emailVerification.js";
import { logger } from "../utils/logger.js";

// Scheduled jobs for hosts without a long-running process (Vercel). A long-running server
// does the same work on timers (server.js), so this route is only needed on serverless.
//   GET /api/cron/tick   sends notification digests that are due, removes stale unconfirmed sign-ups
// Called by Vercel Cron (vercel.json), which sends "Authorization: Bearer <CRON_SECRET>",
// and optionally by any external scheduler with the same header or ?key=<CRON_SECRET>.
const router = Router();

function authorized(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const given = String(req.header("authorization") || "").replace(/^Bearer\s+/i, "") || String(req.query.key || "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get("/tick", async (req, res) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: "Set CRON_SECRET to enable scheduled jobs." });
  if (!authorized(req)) return res.status(401).json({ error: "Not authorized" });
  const started = Date.now();
  const results = {};
  try { await flushDue(); results.digests = "ok"; } catch (err) { results.digests = "failed"; logger.warn("system", `Cron digests failed: ${String(err.message).slice(0, 200)}`); }
  try { await purgeStaleUnverified(); results.cleanup = "ok"; } catch (err) { results.cleanup = "failed"; logger.warn("system", `Cron cleanup failed: ${String(err.message).slice(0, 200)}`); }
  res.json({ ok: true, ...results, ms: Date.now() - started });
});

export default router;
