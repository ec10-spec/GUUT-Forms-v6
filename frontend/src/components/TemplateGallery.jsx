import React, { useState } from "react";
import { TEMPLATES, TEMPLATE_CATEGORIES, draftFromTemplate } from "../lib/templates.js";

/** Pick a starter form. Opens the builder with the fields filled in; nothing is saved until you save. */
export default function TemplateGallery({ onPick, onClose }) {
  const [cat, setCat] = useState("All");
  const shown = TEMPLATES.filter((t) => cat === "All" || t.category === cat);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card wide" role="dialog" aria-label="Templates">
        <div className="modal-head">
          <h2>Start from a template</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="resp-tabs gallery-tabs">
          {TEMPLATE_CATEGORIES.map((c) => <button key={c} className={cat === c ? "active" : ""} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="gallery-grid">
          {shown.map((t) => (
            <button key={t.id} className="gallery-card" onClick={() => onPick(draftFromTemplate(t))}>
              <span className="gallery-cat">{t.category}</span>
              <strong>{t.name}</strong>
              <span>{t.blurb}</span>
              <span className="gallery-meta">{t.fields.length} questions</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
