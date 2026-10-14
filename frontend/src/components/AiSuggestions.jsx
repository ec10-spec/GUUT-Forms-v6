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

  const includedCount = items.filter((i) => i.include).length;

  return (
    <div className="ai-suggestions">
      <h2>AI suggested: "{title}"</h2>
      {description && <p className="ai-suggestions-desc">{description}</p>}
      <p className="hint">Drag to reorder. Uncheck anything you don't want in the form.</p>

      <div className="suggestion-list">
        {items.map((f) => (
          <div
            key={f.id}
            draggable
            onDragStart={() => setDragId(f.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(f.id)}
            className={`suggestion-card ${f.include ? "" : "excluded"}`}
          >
            <span className="drag-handle">⠿</span>
            <input type="checkbox" checked={f.include} onChange={() => toggle(f.id)} />
            <div className="suggestion-body">
              <strong>{f.label}</strong>
              <span className="suggestion-type">{f.type}{f.required ? " · required" : ""}</span>
            </div>
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
              fields: items.filter((i) => i.include).map((i, idx) => ({ ...i, order: idx })),
            })
          }
        >
          Add {includedCount} field{includedCount === 1 ? "" : "s"} to form
        </button>
      </div>
    </div>
  );
}
