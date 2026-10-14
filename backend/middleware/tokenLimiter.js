import TokenUsage from "../models/TokenUsage.js";

const DAILY_LIMIT = () => Number(process.env.DAILY_TOKEN_LIMIT || 100000);
// Hard ceiling on any single call's max_tokens, whatever the UI slider asks for.
const CEILING = () => Number(process.env.MAX_TOKENS_PER_CALL || 3000);
// The analysis chat writes longer answers, so it has its own (higher) per-reply ceiling.
const ANALYSIS_CEILING = () => Number(process.env.MAX_TOKENS_PER_ANALYSIS || 4000);

async function usedToday(userId) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const rows = await TokenUsage.aggregate([
    { $match: { userId: String(userId), createdAt: { $gte: since } } },
    { $group: { _id: null, total: { $sum: "$totalTokens" } } },
  ]);
  return rows[0]?.total || 0;
}

/**
 * Builds a limiter. Requires requireAuth first. Superadmins are exempt from the
 * daily cap. The caller picks maxTokens per request; it is clamped to this
 * route's ceiling and to what's left of today's budget.
 */
function createTokenLimiter({ ceiling, fallback }) {
  return async function limiter(req, res, next) {
    const used = await usedToday(req.userId);
    const limit = DAILY_LIMIT();
    const exempt = req.user.role === "superadmin";
    const remaining = exempt ? ceiling() : limit - used;
    if (remaining <= 0) {
      return res.status(429).json({ error: "Daily AI token limit reached for this user.", limit, used });
    }
    const requested = Number(req.body?.maxTokens) || fallback;
    req.effectiveMaxTokens = Math.max(200, Math.min(requested, ceiling(), remaining));
    next();
  };
}

export const tokenLimiter = createTokenLimiter({ ceiling: CEILING, fallback: 2500 });
export const analysisTokenLimiter = createTokenLimiter({ ceiling: ANALYSIS_CEILING, fallback: 1500 });

// Free AI credit: new accounts can use the platform's AI key until this much (estimated) spend is used.
// A person's own key always takes priority and never uses the credit.
export const freeCreditUsd = () => Number(process.env.FREE_AI_CREDIT_USD ?? 5);
export const costPer1k = () => Number(process.env.COST_PER_1K_TOKENS_USD ?? 0.006);
export const platformKeyConfigured = () => !!process.env.PLATFORM_AI_KEY;

export async function creditUsed(userId) {
  const rows = await TokenUsage.find({ userId: String(userId), viaPlatform: true }).select("costUsd").lean();
  return rows.reduce((a, r) => a + (r.costUsd || 0), 0);
}
export async function creditOf(userId) {
  const total = freeCreditUsd();
  const used = platformKeyConfigured() ? await creditUsed(userId) : 0;
  return { available: platformKeyConfigured() && total > 0, totalUsd: total, usedUsd: Math.round(used * 100) / 100, remainingUsd: Math.max(0, Math.round((total - used) * 100) / 100) };
}

export async function recordTokenUsage({ userId, provider, model, promptTokens, completionTokens, endpoint, viaPlatform = false }) {
  await TokenUsage.create({
    userId: String(userId), provider, model, endpoint, viaPlatform,
    costUsd: viaPlatform ? ((promptTokens + completionTokens) / 1000) * costPer1k() : 0,
    promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
  });
}

export async function getBudget(userId) {
  const used = await usedToday(userId);
  return { credit: await creditOf(userId), used, limit: DAILY_LIMIT(), remaining: Math.max(0, DAILY_LIMIT() - used), maxPerCallCeiling: CEILING(), maxPerAnalysisCeiling: ANALYSIS_CEILING() };
}
