import React from "react";
import { FIELD_TYPES, needsOptions } from "./fields.js";

/** Inline editor for whichever field is currently selected. */
export default function FieldEditor({ field, allFields, onChange, onDelete, onDuplicate }) {
  if (!field) return <div className="field-editor empty">Click a field to edit it.</div>;

  function update(patch) {
    onChange({ ...field, ...patch });
  }

  // Switch an existing question to a different type without deleting it.
  // When moving into an option-based type (checkboxes / single select) with no
  // options yet, seed a couple so the field stays valid. Options are harmless
  // and simply ignored for types that don't use them.
  function changeType(nextType) {
    if (nextType === field.type) return;
    const patch = { type: nextType };
    if (needsOptions(nextType) && (!field.options || field.options.filter((o) => o.trim()).length === 0)) {
      patch.options = ["Option 1", "Option 2"];
    }
    update(patch);
  }

  function updateOption(i, value) {
    const options = [...field.options];
    options[i] = value;
    update({ options });
  }

  function addOption() {
    update({ options: [...field.options, `Option ${field.options.length + 1}`] });
  }

  function removeOption(i) {
    update({ options: field.options.filter((_, idx) => idx !== i) });
  }

  const otherFields = allFields.filter((f) => f.id !== field.id);
  const showOptions = needsOptions(field.type); // covers both checkbox groups and single-select

  return (
    <div className="field-editor">
      <label>
        Question label
        <input value={field.label} onChange={(e) => update({ label: e.target.value })} />
      </label>

      <label>
        Question type
        <select value={field.type} onChange={(e) => changeType(e.target.value)}>
          {FIELD_TYPES.map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>
      </label>

      {(field.type === "text" || field.type === "textarea" || field.type === "number" || field.type === "email") && (
        <label>
          Placeholder
          <input value={field.placeholder} onChange={(e) => update({ placeholder: e.target.value })} />
        </label>
      )}

      {showOptions && (
        <div className="options-editor">
          <span>Options</span>
          {field.options.map((opt, i) => (
            <div key={i} className="option-row">
              <input value={opt} onChange={(e) => updateOption(i, e.target.value)} />
              <button className="icon-btn" onClick={() => removeOption(i)} aria-label="Remove option">×</button>
            </div>
          ))}
          <button className="add-option-btn" onClick={addOption}>+ Add option</button>
        </div>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => update({ required: e.target.checked })}
        />
        Required
      </label>

      <div className="logic-editor">
        <span>Show this field only if</span>
        <select
          value={field.showIf?.fieldId || ""}
          onChange={(e) => update({ showIf: { fieldId: e.target.value || null, equals: null } })}
        >
          <option value="">Always show</option>
          {otherFields
            .filter((f) => f.type === "select" || f.type === "checkbox")
            .map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
        </select>
        {field.showIf?.fieldId && (
          <select
            value={field.showIf.equals || ""}
            onChange={(e) => update({ showIf: { ...field.showIf, equals: e.target.value } })}
          >
            <option value="">equals...</option>
            {(otherFields.find((f) => f.id === field.showIf.fieldId)?.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )}
      </div>

      <div className="field-actions">
        <button onClick={onDuplicate}>Duplicate</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
