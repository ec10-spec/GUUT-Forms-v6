import { Router } from "express";
import { requireAuth, isSuperadmin } from "../middleware/auth.js";
import { tokenLimiter, recordTokenUsage, getBudget } from "../middleware/tokenLimiter.js";
import { getUsageSummary } from "../utils/usageBilling.js";
import { resolveAi, runModel, extractJson, PROVIDERS } from "../utils/aiProviders.js";
import { httpError } from "../utils/http.js";
import { logger } from "../utils/logger.js";

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
      "options": string[]    // required (min 1) for "checkbox" and "select", [] otherwise
    }
  ]
}

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
  draft.fields = (Array.isArray(draft.fields) ? draft.fields : []).map((f, i) => ({
    ...f, order: i, showIf: { fieldId: null, equals: null },
  }));
  res.json({ draft, tokenBudget: await getBudget(req.userId) });
});

// POST /api/ai/test: a tiny call to confirm the saved key + model work.
router.post("/test", requireAuth, async (req, res) => {
  const cfg = await resolveAi(req.user);
  if (!cfg) throw noKey(req.user.ai?.provider || "anthropic");
  const r = await runModel({ ...cfg, system: "Reply with the single word: ok", prompt: "ping", maxTokens: 16 });
  await recordTokenUsage({
    userId: req.userId, provider: cfg.provider, model: cfg.model,
    promptTokens: r.inputTokens, completionTokens: r.outputTokens, endpoint: "ai_test", viaPlatform: cfg.viaPlatform,
  });
  res.json({ ok: true, provider: cfg.provider, model: cfg.model });
});

router.get("/budget", requireAuth, async (req, res) => res.json(await getBudget(req.userId)));

router.get("/usage/:userId", requireAuth, async (req, res) => {
  if (req.params.userId !== req.userId && !isSuperadmin(req)) throw httpError(403, "Not allowed.");
  res.json(await getUsageSummary(req.params.userId, req.query));
});

export default router;
