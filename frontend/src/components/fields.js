// Field type registry. "checkbox" is a multi-select group (choose all that
// apply); "select" is single choice; "rating" is a fixed 1-5 scale.
export const FIELD_TYPES = [
  { type: "text", label: "Text" },
  { type: "textarea", label: "Long Text" },
  { type: "number", label: "Number" },
  { type: "email", label: "Email" },
  { type: "date", label: "Date" },
  { type: "checkbox", label: "Checkboxes" },
  { type: "select", label: "Single Select" },
  { type: "rating", label: "Rating (1-5)" },
  { type: "file", label: "File Upload" },
];

// Kinds of file a File Upload question can accept (mirrors backend/utils/uploads.js).
export const FILE_KINDS = {
  image: { label: "Images", types: ["image/png", "image/jpeg", "image/gif", "image/webp"], ext: ".png,.jpg,.jpeg,.gif,.webp" },
  pdf: { label: "PDF", types: ["application/pdf"], ext: ".pdf" },
  document: { label: "Word documents", types: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ext: ".doc,.docx" },
  spreadsheet: { label: "Spreadsheets", types: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"], ext: ".xls,.xlsx,.csv" },
  text: { label: "Plain text", types: ["text/plain"], ext: ".txt" },
};
export const DEFAULT_FILE_KINDS = ["image", "pdf"];
export const MAX_FILE_MB = 10;
export const fileKindsOf = (f) => (f.accept?.length ? f.accept : DEFAULT_FILE_KINDS).filter((k) => FILE_KINDS[k]);

// Question types that can drive "Show this field only if", and the operators each one offers.
export const LOGIC_OPS = {
  select: [["eq", "is"], ["in", "is one of"]],
  checkbox: [["eq", "includes"], ["in", "includes any of"]],
  rating: [["eq", "is"], ["lte", "is at most"], ["gte", "is at least"], ["in", "is one of"]],
  number: [["eq", "is"], ["lte", "is at most"], ["gte", "is at least"]],
  date: [["eq", "is"], ["lte", "is on or before"], ["gte", "is on or after"]],
};
export const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const OPTION_TYPES = new Set(["checkbox", "select"]);
export function needsOptions(type) {
  return OPTION_TYPES.has(type);
}

export function newField(type, order) {
  const id = `${type}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  return {
    id,
    type,
    label: "Untitled question",
    placeholder: "",
    required: false,
    options: needsOptions(type) ? ["Option 1", "Option 2"] : [],
    order,
    showIf: { fieldId: null, op: "eq", equals: null, values: [] },
    ...(type === "file" ? { accept: [...DEFAULT_FILE_KINDS], maxSizeMb: MAX_FILE_MB } : {}),
  };
}

/** Client-side mirror of the backend's validation, so errors surface before save. */
export function validateForm(title, fields) {
  const errors = [];
  if (!title.trim()) errors.push("Form title is required.");
  fields.forEach((f, i) => {
    if (!f.label.trim()) errors.push(`Question ${i + 1} needs a label.`);
    if (needsOptions(f.type) && f.options.filter((o) => o.trim()).length < 1) {
      errors.push(`"${f.label || "Question " + (i + 1)}" needs at least one option.`);
    }
    if (f.showIf?.fieldId) {
      const src = fields.find((other) => other.id === f.showIf.fieldId);
      if (!src) errors.push(`"${f.label}" has show-if logic pointing to a question that no longer exists.`);
      else if (!LOGIC_OPS[src.type]) errors.push(`"${f.label}" depends on "${src.label}", which can't drive logic. Pick a choice, rating, number or date question.`);
      else if (!(f.showIf.values?.length || f.showIf.equals)) errors.push(`"${f.label}": choose a value for its show-if condition.`);
    }
  });
  return errors;
}

/** Validation for the Design tab. */
export function validateTheme(theme) {
  const errors = [];
  if (theme?.primaryColor && !HEX.test(theme.primaryColor)) errors.push("The accent colour must be a hex value like #001549.");
  if (theme?.backgroundColor && !HEX.test(theme.backgroundColor)) errors.push("The page background must be a hex value like #f6f7fb.");
  return errors;
}
