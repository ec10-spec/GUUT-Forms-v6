import { Router } from "express";
import rateLimit from "express-rate-limit";
import Log from "../models/Log.js";
import { requireSuperadmin } from "../middleware/auth.js";
import { funnel, CLIENT_EVENTS, FUNNEL_EVENTS } from "../utils/funnel.js";

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } });

// POST /api/funnel { event, ref? }: page-level events from the browser. Unknown events are ignored.
router.post("/", limiter, (req, res) => {
  const event = String(req.body?.event || "");
  if (CLIENT_EVENTS.has(event)) {
    const ref = String(req.body?.ref || "").replace(/[^\w-]/g, "").slice(0, 30);
    funnel(event, req, ref ? { ref } : null);
  }
  res.status(204).end();
});

// GET /api/funnel/summary: counts for the last 7 and 30 days (platform team only). Aggregated in JS
// (see CLAUDE.md, portability). People-based steps count distinct accounts.
router.get("/summary", requireSuperadmin, async (_req, res) => {
  const now = Date.now();
  const since30 = new Date(now - 30 * 86400000);
  const since7 = new Date(now - 7 * 86400000);
  const rows = await Log.find({ category: "funnel", createdAt: { $gte: since30 } }).select("message createdAt userId meta").sort({ createdAt: -1 }).limit(50000).lean();
  const out = FUNNEL_EVENTS.map((event) => {
    const mine = rows.filter((r) => r.message === event);
    const personOf = (r) => r.meta?.ownerId || r.userId || null;
    const distinct = (list) => {
      const people = list.map(personOf);
      return people.every(Boolean) ? new Set(people).size : list.length;
    };
    const last7 = mine.filter((r) => new Date(r.createdAt) >= since7);
    return { event, days7: distinct(last7), days30: distinct(mine) };
  });
  res.json({ events: out, from30: since30, from7: since7 });
});

export default router;
