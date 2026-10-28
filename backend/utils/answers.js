// One validator for answers, used by live submissions, the importer and analytics, so the three never
// disagree about what a valid answer is.

export const LIMITS = { text: 500, textarea: 5000, email: 254, option: 1000, number: 1e15 };
export const RATING_MIN = 1;
export const RATING_MAX = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isEmpty = (v) =>
  v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** Parses YYYY-MM-DD (or anything Date can read) to a YYYY-MM-DD string, or null. */
export function toIsoDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (DATE.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const toNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** A stored file answer: { fileId, name, size, type }. */
export const isFileRef = (v) =>
  !!v && typeof v === "object" && !Array.isArray(v) && /^[a-f\d]{24}$/i.test(String(v.fileId || "")) && typeof v.name === "string";

/**
 * Checks one answer against its field. Returns { value, error }: value is the cleaned value to store
 * ("" or [] when empty), error is a short reason or null. Strings are trimmed.
 */
export function validateValue(field, raw) {
  const opts = (field.options || []).filter((o) => String(o).trim());
  switch (field.type) {
    case "text":
    case "textarea": {
      if (isEmpty(raw)) return { value: "", error: null };
      if (typeof raw === "object") return { value: "", error: "must be text" };
      const s = String(raw).trim();
      const cap = LIMITS[field.type];
      return s.length > cap ? { value: "", error: `is longer than ${cap.toLocaleString("en-US")} characters` } : { value: s, error: null };
    }
    case "email": {
      if (isEmpty(raw)) return { value: "", error: null };
      const s = String(raw).trim().toLowerCase();
      return s.length <= LIMITS.email && EMAIL.test(s) ? { value: s, error: null } : { value: "", error: "is not a valid email address" };
    }
    case "number": {
      if (isEmpty(raw)) return { value: "", error: null };
      const n = toNumber(raw);
      return n == null || Math.abs(n) > LIMITS.number ? { value: "", error: "is not a number" } : { value: n, error: null };
    }
    case "rating": {
      if (isEmpty(raw)) return { value: "", error: null };
      const n = toNumber(raw);
      return n != null && Number.isInteger(n) && n >= RATING_MIN && n <= RATING_MAX
        ? { value: n, error: null }
        : { value: "", error: `must be a whole number from ${RATING_MIN} to ${RATING_MAX}` };
    }
    case "date": {
      if (isEmpty(raw)) return { value: "", error: null };
      const d = toIsoDate(raw);
      return d ? { value: d, error: null } : { value: "", error: "is not a valid date" };
    }
    case "select": {
      if (isEmpty(raw)) return { value: "", error: null };
      const s = String(raw).trim();
      return opts.includes(s) ? { value: s, error: null } : { value: "", error: "is not one of the options" };
    }
    case "checkbox": {
      if (isEmpty(raw)) return { value: [], error: null };
      const list = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x).trim()).filter(Boolean);
      if (list.length > 100) return { value: [], error: "has too many choices" };
      const bad = list.find((x) => !opts.includes(x));
      return bad ? { value: [], error: "includes a choice that is not one of the options" } : { value: [...new Set(list)], error: null };
    }
    case "file": {
      if (isEmpty(raw)) return { value: "", error: null };
      if (!isFileRef(raw)) return { value: "", error: "must be an uploaded file" };
      return { value: { fileId: String(raw.fileId), name: String(raw.name).slice(0, 200), size: Number(raw.size) || 0, type: String(raw.type || "").slice(0, 100) }, error: null };
    }
    default:
      return { value: "", error: "has an unknown question type" };
  }
}

// ------------------------------------------------------------ conditional logic
export const CONDITION_SOURCE_TYPES = new Set(["select", "checkbox", "rating", "number", "date"]);
export const CONDITION_OPS = ["eq", "in", "lte", "gte"];

/** The condition in a normalised shape, or null when the field is always shown. */
export function conditionOf(field) {
  const c = field?.showIf;
  if (!c?.fieldId) return null;
  const op = CONDITION_OPS.includes(c.op) ? c.op : "eq";
  const values = Array.isArray(c.values) && c.values.length ? c.values.map(String) : c.equals != null ? [String(c.equals)] : [];
  return { fieldId: c.fieldId, op, values };
}

function compare(a, b, type) {
  if (type === "date") { const x = toIsoDate(a), y = toIsoDate(b); return x && y ? (x < y ? -1 : x > y ? 1 : 0) : null; }
  const x = toNumber(a), y = toNumber(b);
  return x == null || y == null ? null : x - y;
}

/** Does the source answer meet the condition? */
export function conditionMet(cond, source, answer) {
  if (!cond.values.length || isEmpty(answer)) return false;
  const list = Array.isArray(answer) ? answer.map(String) : [String(answer)];
  if (cond.op === "eq") {
    if (source && ["rating", "number", "date"].includes(source.type)) return compare(list[0], cond.values[0], source.type) === 0;
    return list.includes(cond.values[0]);
  }
  if (cond.op === "in") {
    if (source && ["rating", "number"].includes(source.type)) return cond.values.some((v) => compare(list[0], v, source.type) === 0);
    return list.some((x) => cond.values.includes(x));
  }
  const d = compare(list[0], cond.values[0], source?.type);
  if (d == null) return false;
  return cond.op === "lte" ? d <= 0 : d >= 0;
}

/**
 * Which fields were shown, given a set of answers. A field is hidden when its condition fails or when the
 * question it depends on was itself hidden. Returns a Set of visible field ids.
 */
export function visibleFieldIds(fields, answers) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const memo = new Map();
  const visit = (f, depth = 0) => {
    if (memo.has(f.id)) return memo.get(f.id);
    const cond = conditionOf(f);
    let vis = true;
    if (cond) {
      const src = byId.get(cond.fieldId);
      vis = !!src && depth < 20 && visit(src, depth + 1) && conditionMet(cond, src, answers?.[cond.fieldId]);
    }
    memo.set(f.id, vis);
    return vis;
  };
  return new Set(fields.filter((f) => visit(f)).map((f) => f.id));
}

/**
 * Cleans a live submission. Unknown fields and answers to hidden questions are dropped, strings are
 * trimmed before the required check, and every value is checked by type. Returns
 * { answers, errors:[{fieldId,label,message}] } (answers only holds valid values).
 */
export function cleanSubmission(form, raw) {
  const fields = [...(form.fields || [])].sort((a, b) => a.order - b.order);
  const draft = {};
  const errors = [];
  for (const f of fields) {
    const { value, error } = validateValue(f, raw?.[f.id]);
    draft[f.id] = value;
    if (error) errors.push({ fieldId: f.id, label: f.label, message: `"${f.label}" ${error}.` });
  }
  const visible = visibleFieldIds(fields, draft);
  const answers = {};
  const out = [];
  for (const f of fields) {
    if (!visible.has(f.id)) { answers[f.id] = f.type === "checkbox" ? [] : ""; continue; }
    answers[f.id] = draft[f.id];
    const e = errors.find((x) => x.fieldId === f.id);
    if (e) out.push(e);
    else if (f.required && isEmpty(draft[f.id])) out.push({ fieldId: f.id, label: f.label, message: `"${f.label}" is required.` });
  }
  return { answers, errors: out };
}

/** Labels that usually hold names or contact details. Their words are never summarised or sent to the AI. */
export const NAME_LIKE = /\b(name|first|last|surname|full name|phone|mobile|address|street|zip|postcode|contact|email|e-mail|linkedin|website|url)\b/i;
export const isNameLike = (f) => f.type === "email" || ((f.type === "text") && NAME_LIKE.test(String(f.label || "")));
