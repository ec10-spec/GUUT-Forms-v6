import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

/**
 * Ctrl/Cmd+K quick switcher: jump to any page or any of your forms by typing.
 * It is the fastest way around the app once someone has more than a few forms.
 */
export default function CommandPalette({ open, onClose, pages, onGo }) {
  const [q, setQ] = useState("");
  const [forms, setForms] = useState([]);
  const [i, setI] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setI(0);
    setTimeout(() => inputRef.current?.focus(), 10);
    api.listForms("").then(setForms).catch(() => setForms([]));
  }, [open]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const p = pages.map((x) => ({ key: "p:" + x.hash, label: x.label, hint: "Page", icon: x.icon, hash: x.hash }));
    const f = forms.map((x) => ({ key: "f:" + x._id, label: x.title, hint: x.publishedAt ? "Form, published" : "Form, draft", icon: "forms", hash: `/edit/${x._id}` }));
    const all = [...p, ...f];
    return (needle ? all.filter((x) => x.label.toLowerCase().includes(needle)) : all).slice(0, 12);
  }, [q, forms, pages]);

  if (!open) return null;
  const pick = (it) => { if (it) { onGo(it.hash); onClose(); } };

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk" role="dialog" aria-label="Quick switcher" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <Icon name="search" />
          <input
            ref={inputRef} value={q} placeholder="Go to a page or form"
            onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setI((n) => Math.min(n + 1, items.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((n) => Math.max(n - 1, 0)); }
              else if (e.key === "Enter") pick(items[i]);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list">
          {items.length === 0 && <p className="cmdk-empty">Nothing matches "{q}".</p>}
          {items.map((it, n) => (
            <button key={it.key} className={`cmdk-item ${n === i ? "active" : ""}`} onMouseEnter={() => setI(n)} onClick={() => pick(it)}>
              <Icon name={it.icon} /><span>{it.label}</span><em>{it.hint}</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
