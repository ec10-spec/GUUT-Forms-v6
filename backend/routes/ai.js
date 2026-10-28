import { Router } from "express";
import { requireAuth, isSuperadmin } from "../middleware/auth.js";
import { tokenLimiter, recordTokenUsage, getBudget } from "../middleware/tokenLimiter.js";
import { getUsageSummary } from "../utils/usageBilling.js";
import { resolveAi, runModel, extractJson, PROVIDERS } from "../utils/aiProviders.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import { CONDITION_SOURCE_TYPES, CONDITION_OPS } from "../utils/answers.js";

const router = Router();

const SYSTEM_PROMPT = `You are a form-structure generator for GUUT Forms.
Given a plain-language description of a form (and optionally an attached
image, PDF, spreadsheet, or text file for extra context, e.g. a reference
document, a photo of a paper form, or a spreadsheet of the data you want
collected), respond with ONLY a JSON object of this exact shape, no prose,
no markdown fences:

{
  "title": string,
  "description": string,
  "fields": [
    {
      "id": string,          // short unique slug, e.g. "full_name"
      "type": "text" | "textarea" | "number" | "email" | "date" | "checkbox" | "select" | "file" | "rating",
      "label": string,
      "placeholder": string, // "" if not applicable
      "required": boolean,
      "options": string[],   // required (min 1) for "checkbox" and "select", [] otherwise
      "showIf": null | { "fieldId": string, "op": "eq" | "in" | "lte" | "gte", "values": string[] }
    }
  ]
}

Conditional questions: when a question only makes sense after an earlier answer (for example "If you
gave a low rating, what went wrong?"), set "showIf" to point at that EARLIER question's id:
- rating, number or date source: use "lte" or "gte" with one value, e.g. { "fieldId": "overall_rating", "op": "lte", "values": ["2"] }
- select or checkbox source: use "eq" with one option, or "in" with several options, copied exactly.
Otherwise set "showIf" to null. Only choice, rating, number and date questions can be sources.

"checkbox" is a multi-select group (use it for "choose all that apply").
"select" is a single choice. "rating" is a fixed 1-5 scale, options can stay
empty. Suggest 4-8 fields unless the prompt clearly asks for more or fewer.`;

const noKey = (provider) =>
  httpError(400, `No ${PROVIDERS[provider]?.label || "AI"} API key saved. Add one in Settings → AI to use AI form generation.`, { code: "NO_API_KEY" });

// POST /api/ai/generate-form
// body: { prompt, maxTokens?, attachment?: { mediaType, base64, kind, filename? } }
// Draft-only: never writes a form. Uses the CALLER's own provider/key/model.
router.post("/generate-form", requireAuth, tokenLimiter, async (req, res) => {
  const { prompt, attachment } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim()) throw httpError(400, "prompt is required");
  if (prompt.length > 8000) throw httpError(400, "Prompt is too long (max 8000 characters).");

  const cfg = await resolveAi(req.user);
  if (!cfg) throw noKey(req.user.ai?.provider || "anthropic");

  const started = Date.now();
  let result;
  try {
    result = await runModel({
      ...cfg, system: SYSTEM_PROMPT, prompt, attachment, maxTokens: req.effectiveMaxTokens,
    });
    // Cut off mid-answer: try once more with more room before giving up.
    if (result.truncated) {
      await recordTokenUsage({ userId: req.userId, provider: cfg.provider, model: cfg.model, promptTokens: result.inputTokens, completionTokens: result.outputTokens, endpoint: "ai_generate_form", viaPlatform: cfg.viaPlatform });
      result = await runModel({ ...cfg, system: SYSTEM_PROMPT, prompt, attachment, maxTokens: Math.max(req.effectiveMaxTokens * 2, 4000) });
    }
  } catch (err) {
    logger.warn("ai", `Generation failed (${cfg.provider}): ${err.message}`, { req, statusCode: err.status, meta: { model: cfg.model, code: err.code } });
    throw err;
  }

  await recordTokenUsage({
    userId: req.userId, provider: cfg.provider, model: cfg.model,
    promptTokens: result.inputTokens, completionTokens: result.outputTokens, endpoint: "ai_generate_form", viaPlatform: cfg.viaPlatform,
  });
  logger.info("ai", `Form generated (${cfg.provider})`, {
    req, durationMs: Date.now() - started,
    meta: { model: cfg.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, hasAttachment: !!attachment?.base64 },
  });

  let draft;
  try {
    draft = extractJson(result.text);
  } catch {
    throw httpError(result.truncated ? 422 : 502, result.truncated
      ? "That form was too large for the AI to finish in one go. Try a shorter description or ask for fewer fields."
      : "The AI returned something that wasn't valid form JSON. Try again.");
  }
  draft.fields = cleanDraftFields(draft.fields);
  res.json({ draft, tokenBudget: await getBudget(req.user) });
});

/**
 * Keeps the model's draft safe to load in the builder: known types, unique ids, options where needed, and
 * conditions that point at an EARLIER question of a type that can drive logic (anything else is dropped).
 */
export function cleanDraftFields(input) {
  const TYPES = new Set(["text", "textarea", "number", "email", "date", "checkbox", "select", "file", "rating"]);
  const seen = new Set();
  const out = [];
  for (const [i, f] of (Array.isArray(input) ? input : []).slice(0, 60).entries()) {
    if (!f || typeof f !== "object") continue;
    const type = TYPES.has(f.type) ? f.type : "text";
    let id = String(f.id || `q${i + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40) || `q${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    let options = Array.isArray(f.options) ? f.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 50) : [];
    if (["select", "checkbox"].includes(type) && !options.length) options = ["Option 1", "Option 2"];
    if (!["select", "checkbox"].includes(type)) options = [];
    const field = { id, type, label: String(f.label || `Question ${i + 1}`).slice(0, 300), placeholder: String(f.placeholder || "").slice(0, 200), required: !!f.required, options, order: out.length, showIf: { fieldId: null, op: "eq", equals: null } };
    const c = f.showIf;
    const src = c && out.find((p) => p.id === String(c.fieldId || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_"));
    if (src && CONDITION_SOURCE_TYPES.has(src.type)) {
      let op = CONDITION_OPS.includes(c.op) ? c.op : "eq";
      let values = (Array.isArray(c.values) ? c.values : c.equals != null ? [c.equals] : c.value != null ? [c.value] : []).map(String).filter(Boolean);
      if (["select", "checkbox"].includes(src.type)) {
        if (op === "lte" || op === "gte") op = "in";
        values = values.filter((v) => src.options.includes(v));
      } else if (op === "in" && src.type === "date") op = "eq";
      if (values.length) field.showIf = { fieldId: src.id, op, equals: values[0], values: op === "in" ? values : [values[0]] };
    }
    out.push(field);
  }
  return out;
}

const KEY_FORMAT = { anthropic: /^sk-ant-[\w-]{10,}$/, openai: /^sk-[\w-]{10,}$/ };

// POST /api/ai/test: a tiny call to confirm a key + model work.
// With { provider, apiKey, model } in the body it tests that key WITHOUT saving it; otherwise the saved one.
router.post("/test", requireAuth, async (req, res) => {
  const { provider: p, apiKey, model } = req.body || {};
  if (typeof apiKey === "string" && apiKey.trim()) {
    const provider = PROVIDERS[p] ? p : "anthropic";
    const key = apiKey.trim();
    if (!KEY_FORMAT[provider].test(key) || (provider === "openai" && key.startsWith("sk-ant-"))) {
      throw httpError(400, provider === "anthropic" ? "Claude keys start with sk-ant-. Check that you copied the whole key." : "OpenAI keys start with sk-. Check that you copied the whole key.", { code: "BAD_KEY_FORMAT" });
    }
    const m = typeof model === "string" && /^[\w.:/-]{1,80}$/.test(model.trim()) ? model.trim() : PROVIDERS[provider].defaultModel();
    const r = await runModel({ provider, apiKey: key, model: m, system: "Reply with the single word: ok", prompt: "ping", maxTokens: 16 });
    await recordTokenUsage({ userId: req.userId, provider, model: m, promptTokens: r.inputTokens, completionTokens: r.outputTokens, endpoint: "ai_test", viaPlatform: false });
    return res.json({ ok: true, provider, model: m, saved: false });
  }
  const cfg = await resolveAi(req.user);
  if (!cfg) throw noKey(req.user.ai?.provider || "anthropic");
  const r = await runModel({ ...cfg, system: "Reply with the single word: ok", prompt: "ping", maxTokens: 16 });
  await recordTokenUsage({
    userId: req.userId, provider: cfg.provider, model: cfg.model,
    promptTokens: r.inputTokens, completionTokens: r.outputTokens, endpoint: "ai_test", viaPlatform: cfg.viaPlatform,
  });
  res.json({ ok: true, provider: cfg.provider, model: cfg.model });
});

router.get("/budget", requireAuth, async (req, res) => res.json(await getBudget(req.user)));

router.get("/usage/:userId", requireAuth, async (req, res) => {
  if (req.params.userId !== req.userId && !isSuperadmin(req)) throw httpError(403, "Not allowed.");
  res.json(await getUsageSummary(req.params.userId, req.query));
});

export default router;
