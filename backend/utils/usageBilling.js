import TokenUsage from "../models/TokenUsage.js";
import { costOf } from "./pricing.js";
import { dayKey as tzDayKey, safeTz } from "./time.js";

const RATE_NOTE = "Estimated at each model's list price, with input and output priced separately";
const sumCost = (rows) => Number(rows.reduce((a, r) => a + costOf(r.model, r.promptTokens, r.completionTokens), 0).toFixed(4));

/** Per-user token + estimated cost summary for a date range. */
export async function getUsageSummary(userId, { from, to } = {}) {
  const match = { userId: String(userId) };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }
  const rows = await TokenUsage.find(match).sort({ createdAt: 1 });
  const totalTokens = rows.reduce((sum, r) => sum + r.totalTokens, 0);
  return {
    userId,
    period: { from: from || null, to: to || null },
    callCount: rows.length,
    totalTokens,
    estimatedCostUsd: sumCost(rows),
    rate: RATE_NOTE,
  };
}

const sinceDays = (days) => new Date(Date.now() - Math.max(1, Math.min(Number(days) || 30, 365)) * 86400000);

// Totals are summed in code rather than with a database aggregation pipeline, so
// they work on any MongoDB-compatible host (Atlas, DocumentDB, FerretDB...). One
// row per AI call keeps this small; the cap is a safety net, not an expected limit.
const MAX_ROWS = 200000;


async function rowsSince(match, days) {
  return TokenUsage.find({ ...match, createdAt: { $gte: sinceDays(days) } })
    .select("userId endpoint model promptTokens completionTokens totalTokens createdAt").sort({ createdAt: -1 }).limit(MAX_ROWS).lean();
}

/** Per-user totals over the last N days. userIds omitted = everyone (platform team only). */
export async function usageByUser({ userIds, days = 30, tz = "UTC" } = {}) {
  const zone = safeTz(tz);
  const dayKey = (d) => tzDayKey(d, zone);
  const rows = await rowsSince(userIds ? { userId: { $in: userIds.map(String) } } : {}, days);
  const today = dayKey(new Date());
  const out = new Map();
  for (const r of rows) {
    const u = out.get(r.userId) || { userId: r.userId, calls: 0, tokens: 0, inputTokens: 0, outputTokens: 0, today: 0, lastAt: null, cost: 0 };
    u.calls++; u.tokens += r.totalTokens; u.inputTokens += r.promptTokens; u.outputTokens += r.completionTokens;
    u.cost += costOf(r.model, r.promptTokens, r.completionTokens);
    if (dayKey(r.createdAt) === today) u.today += r.totalTokens;
    if (!u.lastAt || r.createdAt > u.lastAt) u.lastAt = r.createdAt;
    out.set(r.userId, u);
  }
  return [...out.values()].map(({ cost, ...u }) => ({ ...u, estimatedCostUsd: Number(cost.toFixed(4)) }));
}

/** One user's breakdown: totals, by feature, and by day. */
export async function usageDetail(userId, days = 30, tz = "UTC") {
  const zone = safeTz(tz);
  const dayKey = (d) => tzDayKey(d, zone);
  const rows = await rowsSince({ userId: String(userId) }, days);
  const byEndpoint = new Map();
  const byDay = new Map();
  let tokens = 0, inputTokens = 0, outputTokens = 0;
  for (const r of rows) {
    tokens += r.totalTokens; inputTokens += r.promptTokens; outputTokens += r.completionTokens;
    const e = byEndpoint.get(r.endpoint || "unknown") || { endpoint: r.endpoint || "unknown", calls: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    e.calls++; e.tokens += r.totalTokens; e.inputTokens += r.promptTokens; e.outputTokens += r.completionTokens;
    e.cost += costOf(r.model, r.promptTokens, r.completionTokens); byEndpoint.set(e.endpoint, e);
    const d = byDay.get(dayKey(r.createdAt)) || { date: dayKey(r.createdAt), calls: 0, tokens: 0 };
    d.calls++; d.tokens += r.totalTokens; byDay.set(d.date, d);
  }
  return {
    days: Number(days) || 30, timeZone: zone, calls: rows.length, tokens, inputTokens, outputTokens, estimatedCostUsd: sumCost(rows), rate: RATE_NOTE,
    byEndpoint: [...byEndpoint.values()].map(({ cost, ...e }) => ({ ...e, estimatedCostUsd: Number(cost.toFixed(4)) })).sort((a, b) => b.tokens - a.tokens),
    byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}
