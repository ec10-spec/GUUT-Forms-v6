import React from "react";
import { FIELD_TYPES, needsOptions, LOGIC_OPS, FILE_KINDS, DEFAULT_FILE_KINDS, MAX_FILE_MB } from "./fields.js";

/** "Show this field only if": the source question, an operator for its type, and the value(s). */
function LogicEditor({ field, allFields, update }) {
  const order = allFields.findIndex((f) => f.id === field.id);
  // Only earlier questions can drive logic, so the form always reads top to bottom.
  const sources = allFields.filter((f, i) => i < order && LOGIC_OPS[f.type]);
  const c = field.showIf || {};
  const src = allFields.find((f) => f.id === c.fieldId);
  const ops = src ? LOGIC_OPS[src.type] || [] : [];
  const op = ops.some(([k]) => k === c.op) ? c.op : ops[0]?.[0] || "eq";
  const values = c.values?.length ? c.values : c.equals != null && c.equals !== "" ? [c.equals] : [];
  const set = (patch) => {
    const next = { fieldId: c.fieldId || null, op, values, ...patch };
    update({ showIf: { ...next, equals: next.values[0] ?? null } });
  };
  const choiceValues = src && (src.type === "select" || src.type === "checkbox") ? src.options : src?.type === "rating" ? ["1", "2", "3", "4", "5"] : null;

  return (
    <div className="logic-editor">
      <span>Show this field only if</span>
      <select value={c.fieldId || ""} aria-label="Question this depends on" onChange={(e) => {
        const s = allFields.find((f) => f.id === e.target.value);
        update({ showIf: { fieldId: e.target.value || null, op: s ? LOGIC_OPS[s.type][0][0] : "eq", values: [], equals: null } });
      }}>
        <option value="">Always show</option>
        {sources.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        {src && !sources.includes(src) && <option value={src.id}>{src.label} (move it above this question)</option>}
      </select>
      {sources.length === 0 && !src && <span className="field-help">Add a choice, rating, number or date question above this one to use logic.</span>}
      {src && (
        <>
          <select value={op} aria-label="Condition" onChange={(e) => set({ op: e.target.value, values: e.target.value === "in" ? values : values.slice(0, 1) })}>
            {ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {op === "in" && choiceValues ? (
            <div className="checkbox-group logic-values">
              {choiceValues.map((o) => (
                <label key={o} className="checkbox-option">
                  <input type="checkbox" checked={values.includes(o)} onChange={() => set({ values: values.includes(o) ? values.filter((v) => v !== o) : [...values, o] })} />
                  <span>{src.type === "rating" ? `${o} of 5` : o}</span>
                </label>
              ))}
            </div>
          ) : choiceValues ? (
            <select value={values[0] || ""} aria-label="Value" onChange={(e) => set({ values: e.target.value ? [e.target.value] : [] })}>
              <option value="">Choose...</option>
              {choiceValues.map((o) => <option key={o} value={o}>{src.type === "rating" ? `${o} of 5` : o}</option>)}
            </select>
          ) : (
            <input type={src.type === "date" ? "date" : "number"} value={values[0] || ""} aria-label="Value" onChange={(e) => set({ values: e.target.value !== "" ? [e.target.value] : [] })} />
          )}
        </>
      )}
    </div>
  );
}

/** Inline editor for whichever field is currently selected. */
export default function FieldEditor({ field, allFields, onChange, onDelete, onDuplicate }) {
  if (!field) return <div className="field-editor empty">Click a field to edit it.</div>;

  function update(patch) {
    onChange({ ...field, ...patch });
  }

  // Switch an existing question to a different type without deleting it.
  function changeType(nextType) {
    if (nextType === field.type) return;
    const patch = { type: nextType };
    if (needsOptions(nextType) && (!field.options || field.options.filter((o) => o.trim()).length === 0)) {
      patch.options = ["Option 1", "Option 2"];
    }
    if (nextType === "file" && !field.accept?.length) { patch.accept = [...DEFAULT_FILE_KINDS]; patch.maxSizeMb = MAX_FILE_MB; }
    update(patch);
  }

  function updateOption(i, value) {
    const options = [...field.options];
    options[i] = value;
    update({ options });
  }

  const showOptions = needsOptions(field.type);
  const accept = field.accept?.length ? field.accept : DEFAULT_FILE_KINDS;

  return (
    <div className="field-editor">
      <label>
        Question label
        <input value={field.label} onChange={(e) => update({ label: e.target.value })} />
      </label>

      <label>
        Question type
        <select value={field.type} onChange={(e) => changeType(e.target.value)}>
          {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
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
              <input value={opt} onChange={(e) => updateOption(i, e.target.value)} aria-label={`Option ${i + 1}`} />
              <button className="icon-btn" onClick={() => update({ options: field.options.filter((_, idx) => idx !== i) })} aria-label={`Remove option ${i + 1}`}>×</button>
            </div>
          ))}
          <button className="add-option-btn" onClick={() => update({ options: [...field.options, `Option ${field.options.length + 1}`] })}>+ Add option</button>
        </div>
      )}

      {field.type === "file" && (
        <div className="options-editor">
          <span>Accepted files</span>
          <div className="checkbox-group">
            {Object.entries(FILE_KINDS).map(([k, v]) => (
              <label key={k} className="checkbox-option">
                <input type="checkbox" checked={accept.includes(k)} onChange={() => {
                  const next = accept.includes(k) ? accept.filter((x) => x !== k) : [...accept, k];
                  if (next.length) update({ accept: next });
                }} />
                <span>{v.label}</span>
              </label>
            ))}
          </div>
          <label className="inline-num">Largest file
            <select value={field.maxSizeMb || MAX_FILE_MB} onChange={(e) => update({ maxSizeMb: Number(e.target.value) })}>
              {[1, 2, 5, 10].map((n) => <option key={n} value={n}>{n} MB</option>)}
            </select>
          </label>
        </div>
      )}

      <label className="checkbox-row">
        <input type="checkbox" checked={field.required} onChange={(e) => update({ required: e.target.checked })} />
        <span>Required</span>
      </label>

      <LogicEditor field={field} allFields={allFields} update={update} />

      <div className="field-actions">
        <button onClick={onDuplicate}>Duplicate</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
