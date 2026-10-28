import React, { useEffect, useState } from "react";
import FormRenderer from "./FormRenderer.jsx";
import { api, assetUrl } from "../api.js";
import { HEX } from "./fields.js";

const MAX_WIDTH = 1600;
const MAX_BYTES = 2 * 1024 * 1024;

/** Resizes to at most 1600px wide and compresses to WebP (JPEG where WebP isn't supported). */
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("That file isn't an image we can read.")); i.src = url; });
    const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background when saved as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
    for (const q of [0.85, 0.75, 0.6, 0.45]) {
      let blob = await toBlob("image/webp", q);
      if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg", q);
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error("That image is still larger than 2 MB after compressing. Try a smaller image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A colour picker plus a hex box that only accepts valid hex values. */
function ColorField({ label, value, fallback, onChange }) {
  const [text, setText] = useState(value || fallback);
  useEffect(() => { setText(value || fallback); }, [value, fallback]);
  const bad = text && !HEX.test(text.trim());
  return (
    <label className="color-field">
      {label}
      <span className="color-input-row">
        <input type="color" value={HEX.test(value || "") && value.length === 7 ? value : fallback} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} />
        <input
          className={`color-hex ${bad ? "invalid" : ""}`} value={text} maxLength={7} spellCheck={false} aria-invalid={bad || undefined}
          onChange={(e) => { const v = e.target.value.trim(); setText(v); if (HEX.test(v)) onChange(v.toLowerCase()); }}
          onBlur={() => { if (!HEX.test(text.trim())) setText(value || fallback); }}
        />
      </span>
      {bad && <span className="field-error">Use a hex colour like {fallback}.</span>}
    </label>
  );
}

/**
 * Design studio: controls on the left, a live preview of the real form on the right.
 * Sets the accent color, page background, and an optional header image (uploaded and stored as a file).
 */
export default function DesignPanel({ theme, onChange, form, formId, onHeaderSaved }) {
  const t = theme || {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => onChange({ ...t, ...patch });

  async function onHeaderFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setError("Choose a PNG, JPEG, WebP or GIF image."); return; }
    setBusy(true);
    try {
      const blob = await prepareImage(file);
      onHeaderSaved(await api.uploadHeaderImage(formId, blob));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function removeHeader() {
    setBusy(true); setError(null);
    try { onHeaderSaved(await api.removeHeaderImage(formId)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="design-panel">
      <div className="design-controls">
        <div>
          <h2>Design</h2>
          <p className="hint">Style how this form looks to respondents.</p>
        </div>

        <ColorField label="Primary / accent color" value={t.primaryColor} fallback="#001549" onChange={(v) => set({ primaryColor: v })} />
        <ColorField label="Page background" value={t.backgroundColor} fallback="#f6f7fb" onChange={(v) => set({ backgroundColor: v })} />

        <div className="header-image-block">
          <span className="field-label">Header image</span>
          {!formId ? (
            <p className="field-help">Save the form first, then add a header image.</p>
          ) : (
            <>
              <label className={`header-image-field ${busy ? "busy" : ""}`}>
                {busy ? "Uploading..." : t.headerImage ? "Replace image" : "Add a header image (optional)"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onHeaderFile} hidden disabled={busy} />
              </label>
              <span className="field-help">Best at 1600 x 400 pixels. Larger images are resized and compressed to under 2 MB.</span>
            </>
          )}
          {error && <span className="field-error" role="alert">{error}</span>}
          {t.headerImage && (
            <div className="header-image-preview">
              <img src={assetUrl(t.headerImage)} alt="Header preview" />
              <button className="danger small" disabled={busy || !formId} onClick={removeHeader}>Remove image</button>
            </div>
          )}
        </div>
      </div>

      <div className="design-live-preview" style={{ background: HEX.test(t.backgroundColor || "") ? t.backgroundColor : "#f6f7fb" }}>
        <div className="form-live">
          {form ? <FormRenderer form={{ ...form, theme: t }} previewOnly fullPage /> : null}
        </div>
      </div>
    </div>
  );
}
