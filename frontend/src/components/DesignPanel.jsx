import React from "react";
import FormRenderer from "./FormRenderer.jsx";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Design studio: controls on the left, a live preview of the real form on the right.
 * Sets the accent color, page background, and an optional header image.
 */
export default function DesignPanel({ theme, onChange, form }) {
  const t = theme || {};

  function set(patch) {
    onChange({ ...t, ...patch });
  }

  async function onHeaderFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const dataUrl = await fileToDataUrl(file);
    set({ headerImage: dataUrl });
  }

  return (
    <div className="design-panel">
      <div className="design-controls">
        <h2>Design</h2>
        <p className="hint">Style how this form looks to respondents.</p>

        <label className="color-field">
          Primary / accent color
          <span className="color-input-row">
            <input type="color" value={t.primaryColor || "#001549"} onChange={(e) => set({ primaryColor: e.target.value })} />
            <input className="color-hex" value={t.primaryColor || "#001549"} onChange={(e) => set({ primaryColor: e.target.value })} />
          </span>
        </label>

        <label className="color-field">
          Page background
          <span className="color-input-row">
            <input type="color" value={t.backgroundColor || "#f6f7fb"} onChange={(e) => set({ backgroundColor: e.target.value })} />
            <input className="color-hex" value={t.backgroundColor || "#f6f7fb"} onChange={(e) => set({ backgroundColor: e.target.value })} />
          </span>
        </label>

        <label className="header-image-field">
          Header image (optional)
          <input type="file" accept="image/*" onChange={onHeaderFile} hidden />
        </label>
        {t.headerImage && (
          <div className="header-image-preview">
            <img src={t.headerImage} alt="Header preview" />
            <button className="danger small" onClick={() => set({ headerImage: null })}>Remove</button>
          </div>
        )}
      </div>

      <div className="design-live-preview" style={{ background: t.backgroundColor || "#f6f7fb" }}>
        <div className="form-live">
          {form ? <FormRenderer form={{ ...form, theme: t }} previewOnly /> : null}
        </div>
      </div>
    </div>
  );
}
