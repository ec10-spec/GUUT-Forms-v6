import { httpError } from "./http.js";
import { CONDITION_SOURCE_TYPES, CONDITION_OPS } from "./answers.js";
import { FILE_KINDS } from "./uploads.js";
import { HEX } from "../models/tenantSchemas.js";

// Server-side checks on a form's structure, run on create and update (the builder runs the same checks).

const headerPath = (formId) => new RegExp(`^/api/forms/${formId}/header-image/[a-f\\d]{24}$`, "i");

/** Normalises conditional logic and file settings; throws a 400 with the question label on a real mistake. */
export function sanitizeFields(fields) {
  if (fields === undefined) return undefined;
  if (!Array.isArray(fields)) throw httpError(400, "fields must be a list.");
  if (fields.length > 300) throw httpError(400, "A form can have at most 300 questions.");
  const byId = new Map(fields.map((f) => [f?.id, f]));
  return fields.map((f) => {
    const out = { ...f };
    const c = f.showIf;
    if (!c?.fieldId) {
      out.showIf = { fieldId: null, op: "eq", equals: null };
    } else {
      const src = byId.get(c.fieldId);
      if (!src || src.id === f.id) throw httpError(400, `"${f.label}" shows only if another question is answered, but that question no longer exists.`);
      if (!CONDITION_SOURCE_TYPES.has(src.type)) throw httpError(400, `"${f.label}" can't depend on "${src.label}" (only choice, rating, number and date questions can be used).`);
      const op = CONDITION_OPS.includes(c.op) ? c.op : "eq";
      const values = (Array.isArray(c.values) && c.values.length ? c.values : c.equals != null && c.equals !== "" ? [c.equals] : []).map((v) => String(v).slice(0, 200)).slice(0, 50);
      if ((op === "lte" || op === "gte") && !["rating", "number", "date"].includes(src.type)) throw httpError(400, `"${f.label}": "at most" and "at least" only work with rating, number and date questions.`);
      out.showIf = { fieldId: c.fieldId, op, equals: values[0] ?? null, values };
    }
    if (f.type === "file") {
      out.accept = (Array.isArray(f.accept) ? f.accept : []).filter((k) => FILE_KINDS[k]);
      if (!out.accept.length) out.accept = undefined;
      const mb = Number(f.maxSizeMb);
      out.maxSizeMb = Number.isFinite(mb) && mb >= 1 ? Math.min(10, Math.round(mb)) : undefined;
    } else {
      delete out.accept; delete out.maxSizeMb;
    }
    return out;
  });
}

/**
 * Theme: hex colours only; the header image must be an image uploaded for THIS form (or the value the
 * form already had, so older forms with an embedded image can still be saved until it is replaced).
 */
export function sanitizeTheme(theme, { formId = null, previous = null } = {}) {
  if (theme === undefined) return undefined;
  if (!theme || typeof theme !== "object") throw httpError(400, "theme must be an object.");
  const out = {};
  for (const k of ["primaryColor", "backgroundColor"]) {
    if (theme[k] === undefined || theme[k] === null || theme[k] === "") continue;
    const v = String(theme[k]).trim();
    if (!HEX.test(v)) throw httpError(400, `Colours must be hex values like #001549 ("${v.slice(0, 20)}" isn't one).`);
    out[k] = v.toLowerCase();
  }
  const img = theme.headerImage ?? null;
  if (img === null || img === "") out.headerImage = null;
  else if (typeof img === "string" && (img === previous || (formId && headerPath(formId).test(img)))) out.headerImage = img;
  else throw httpError(400, "Upload the header image from the Design tab (save the form first).", { code: "BAD_HEADER_IMAGE" });
  return out;
}

/** What anonymous respondents may see of a form. */
export function publicView(form) {
  const { ownerId, generationPrompt, source, sizeBytes, isPublic, __v, ...rest } = form;
  return rest;
}
