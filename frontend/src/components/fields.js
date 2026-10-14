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
    showIf: { fieldId: null, equals: null },
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
    if (f.showIf?.fieldId && !fields.some((other) => other.id === f.showIf.fieldId)) {
      errors.push(`"${f.label}" has show-if logic pointing to a field that no longer exists.`);
    }
  });
  return errors;
}
