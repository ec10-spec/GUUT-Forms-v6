import React, { useState } from "react";

/**
 * Shows the AI's suggested fields as a reorderable, toggleable list. Nothing
 * is forced onto the form: each suggestion has an include/exclude checkbox,
 * and the list can be drag-reordered before handing off to the builder.
 */
export default function AiSuggestions({ title, description, fields, onConfirm, onDiscard }) {
  const [items, setItems] = useState(fields.map((f) => ({ ...f, include: true })));
  const [dragId, setDragId] = useState(null);

  function toggle(id) {
    setItems(items.map((it) => (it.id === id ? { ...it, include: !it.include } : it)));
  }

  function handleDrop(targetId) {
    if (dragId === targetId) return;
    const from = items.findIndex((f) => f.id === dragId);
    const to = items.findIndex((f) => f.id === targetId);
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    setDragId(null);
  }

  function move(id, delta) {
    const from = items.findIndex((f) => f.id === id);
    const to = from + delta;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    setItems(next);
  }

  const includedCount = items.filter((i) => i.include).length;
  const labelOf = (id) => items.find((x) => x.id === id)?.label;
  // A question that depends on an excluded (or later) question goes back to "always show".
  function finalFields() {
    const kept = items.filter((i) => i.include);
    return kept.map((i, idx) => {
      const { include, ...f } = i;
      const srcAt = kept.findIndex((k) => k.id === f.showIf?.fieldId);
      return { ...f, order: idx, showIf: srcAt >= 0 && srcAt < idx ? f.showIf : { fieldId: null, op: "eq", equals: null, values: [] } };
    });
  }

  return (
    <div className="ai-suggestions">
      <h2>AI suggested: "{title}"</h2>
      {description && <p className="ai-suggestions-desc">{description}</p>}
      <p className="hint">Drag or use the arrows to reorder. Uncheck anything you don't want in the form.</p>

      <div className="suggestion-list">
        {items.map((f, i) => (
          <div
            key={f.id}
            draggable
            onDragStart={() => setDragId(f.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(f.id)}
            className={`suggestion-card ${f.include ? "" : "excluded"}`}
          >
            <span className="drag-handle" aria-hidden="true">⠿</span>
            <input type="checkbox" checked={f.include} onChange={() => toggle(f.id)} aria-label={`Include "${f.label}"`} />
            <div className="suggestion-body">
              <strong>{f.label}</strong>
              <span className="suggestion-type">{f.type}{f.required ? " · required" : ""}{f.showIf?.fieldId ? ` · shown only if "${labelOf(f.showIf.fieldId) || "another question"}" ${({ lte: "is at most", gte: "is at least", in: "is one of", eq: "is" })[f.showIf.op || "eq"]} ${(f.showIf.values || [f.showIf.equals]).join(", ")}` : ""}</span>
            </div>
            <span className="move-btns">
              <button type="button" className="icon-btn" onClick={() => move(f.id, -1)} disabled={i === 0} aria-label={`Move "${f.label}" up`}>↑</button>
              <button type="button" className="icon-btn" onClick={() => move(f.id, 1)} disabled={i === items.length - 1} aria-label={`Move "${f.label}" down`}>↓</button>
            </span>
          </div>
        ))}
      </div>

      <div className="suggestion-actions">
        <button onClick={onDiscard}>Start over</button>
        <button
          className="primary"
          disabled={includedCount === 0}
          onClick={() =>
            onConfirm({
              title,
              description,
              fields: finalFields(),
            })
          }
        >
          Add {includedCount} field{includedCount === 1 ? "" : "s"} to form
        </button>
      </div>
    </div>
  );
}
