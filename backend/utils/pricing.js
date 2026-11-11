// Estimated AI cost. Providers charge more for output than input (about 5x on Claude Sonnet), so the two
// are priced separately per model. Prices are USD per million tokens, list prices at the time of writing;
// the provider's own dashboard is the source of truth. Override with AI_PRICES_JSON, e.g.
//   AI_PRICES_JSON='{"claude-sonnet":[3,15],"gpt-4o":[2.5,10]}'   (keys match the start of the model name)
const DEFAULT_PRICES = [
  ["claude-opus-4-5", 5, 25], ["claude-opus-4-6", 5, 25], ["claude-opus-4-7", 5, 25], ["claude-opus", 15, 75],
  ["claude-sonnet", 3, 15], ["claude-3-7-sonnet", 3, 15], ["claude-3-5-sonnet", 3, 15],
  ["claude-haiku-4", 1, 5], ["claude-3-5-haiku", 0.8, 4], ["claude-haiku", 1, 5],
  ["gpt-4o-mini", 0.15, 0.6], ["gpt-4o", 2.5, 10], ["gpt-4.1-nano", 0.1, 0.4], ["gpt-4.1-mini", 0.4, 1.6], ["gpt-4.1", 2, 8],
  ["gpt-5-nano", 0.05, 0.4], ["gpt-5-mini", 0.25, 2], ["gpt-5", 1.25, 10], ["o4-mini", 1.1, 4.4], ["o3", 2, 8],
];
const FALLBACK = [3, 15]; // unknown model: price like a mid-tier model rather than under-estimate

function table() {
  let extra = [];
  try {
    const o = JSON.parse(process.env.AI_PRICES_JSON || "{}");
    extra = Object.entries(o).filter(([, v]) => Array.isArray(v) && v.length === 2).map(([k, [i, out]]) => [k, Number(i), Number(out)]);
  } catch { /* ignore a malformed override */ }
  // Longest prefix wins, so "gpt-4o-mini" beats "gpt-4o".
  return [...extra, ...DEFAULT_PRICES].sort((a, b) => b[0].length - a[0].length);
}

export function priceOf(model) {
  const m = String(model || "").toLowerCase();
  const hit = table().find(([prefix]) => m.startsWith(prefix.toLowerCase()));
  return hit ? { input: hit[1], output: hit[2], matched: hit[0] } : { input: FALLBACK[0], output: FALLBACK[1], matched: null };
}

/** USD cost of one call. */
export function costOf(model, inputTokens = 0, outputTokens = 0) {
  const p = priceOf(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1e6;
}
