import React, { useRef, useState } from "react";
import { TEMPLATES, TEMPLATE_CATEGORIES, draftFromTemplate } from "../lib/templates.js";
import Icon from "./Icon.jsx";

/** Always-visible starter forms under the AI bar: scroll sideways, filter by type, click to open in the builder. */
export default function TemplateCarousel({ onPick, onBlank, onSeeAll }) {
  const row = useRef(null);
  const [cat, setCat] = useState("All");
  const shown = TEMPLATES.filter((t) => cat === "All" || t.category === cat);
  const scroll = (dir) => row.current?.scrollBy({ left: dir * Math.max(280, row.current.clientWidth * 0.8), behavior: "smooth" });
  return (
    <section className="tcar" aria-label="Form templates">
      <div className="tcar-head">
        <h2>Start from a template</h2>
        <div className="tcar-tools">
          <button className="link-btn" onClick={onBlank}>Blank form</button>
          <button className="link-btn" onClick={onSeeAll}>See all</button>
          <button className="icon-btn" onClick={() => scroll(-1)} aria-label="Scroll left"><Icon name="chevronLeft" size={18} /></button>
          <button className="icon-btn" onClick={() => scroll(1)} aria-label="Scroll right"><Icon name="chevronRight" size={18} /></button>
        </div>
      </div>
      <div className="tcar-cats">
        {TEMPLATE_CATEGORIES.map((c) => <button key={c} className={`template-chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="tcar-track" ref={row}>
        {shown.map((t) => (
          <button key={t.id} className="tcar-card" onClick={() => onPick(draftFromTemplate(t))}>
            <span className="gallery-cat">{t.category}</span>
            <strong>{t.name}</strong>
            <span className="tcar-blurb">{t.blurb}</span>
            <span className="tcar-fields">{t.fields.slice(0, 3).map((f) => f[1]).join(", ")}{t.fields.length > 3 ? "..." : ""}</span>
            <span className="gallery-meta">{t.fields.length} questions</span>
          </button>
        ))}
      </div>
    </section>
  );
}
