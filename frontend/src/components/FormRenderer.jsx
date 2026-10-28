import React, { useMemo, useRef, useState } from "react";
import { api, assetUrl } from "../api.js";
import { cleanSubmission, visibleFieldIds, LIMITS } from "../lib/answers.js";
import { FILE_KINDS, fileKindsOf, MAX_FILE_MB } from "./fields.js";
import Logo from "./Logo.jsx";

/** Black or white text, whichever reads better on the given background colour. */
export function contrastText(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#111827" : "#ffffff";
}

const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Rating as a radio group: click, or use the arrow keys. */
function Rating({ field, value, onChange, color, describedBy }) {
  const refs = useRef([]);
  const current = Number(value) || 0;
  const move = (n) => { const v = Math.min(5, Math.max(1, n)); onChange(v); refs.current[v - 1]?.focus(); };
  return (
    <div className="rating-group" role="radiogroup" aria-labelledby={`q_${field.id}_label`} aria-describedby={describedBy}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = current >= n;
        return (
          <button
            type="button" key={n} ref={(el) => (refs.current[n - 1] = el)}
            role="radio" aria-checked={current === n} aria-label={`${n} of 5 stars`}
            tabIndex={current ? (current === n ? 0 : -1) : n === 1 ? 0 : -1}
            className={`rating-star ${filled ? "filled" : ""}`}
            style={filled && color ? { color } : undefined}
            onClick={() => onChange(n)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); move((current || 0) + 1); }
              else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); move((current || 2) - 1); }
            }}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

/** A styled file picker that uploads straight away, so the response only carries a reference to the file. */
function FilePicker({ form, field, value, onChange, previewOnly, describedBy }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const kinds = fileKindsOf(field);
  const maxMb = Math.min(MAX_FILE_MB, Number(field.maxSizeMb) || MAX_FILE_MB);
  const accept = kinds.map((k) => FILE_KINDS[k].ext).join(",");
  const types = new Set(kinds.flatMap((k) => FILE_KINDS[k].types));

  async function pick(file) {
    setError(null);
    if (!file) return;
    if (!types.has(file.type)) { setError(`That type of file isn't accepted. Allowed: ${kinds.map((k) => FILE_KINDS[k].label).join(", ")}.`); return; }
    if (file.size > maxMb * 1048576) { setError(`That file is larger than ${maxMb} MB.`); return; }
    if (previewOnly) { onChange({ fileId: "preview", name: file.name, size: file.size, type: file.type }); return; }
    setBusy(true);
    try { onChange(await api.uploadFile(form._id, field.id, file)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  return (
    <div className="file-picker" aria-describedby={describedBy}>
      <input ref={input} id={`q_${field.id}`} type="file" accept={accept} className="visually-hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={field.label} />
      {value?.name ? (
        <div className="file-chosen">
          <span className="file-name">{value.name}</span>
          <span className="file-size">{value.size ? fmtSize(value.size) : ""}</span>
          <button type="button" className="link-btn" onClick={() => input.current?.click()} disabled={busy}>Replace</button>
          <button type="button" className="link-btn" onClick={() => onChange("")} disabled={busy}>Remove</button>
        </div>
      ) : (
        <button type="button" className="file-button" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Uploading..." : "Choose a file"}
        </button>
      )}
      <span className="file-hint">{kinds.map((k) => FILE_KINDS[k].label).join(", ")}, up to {maxMb} MB</span>
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

/**
 * Renders a form for someone to fill out and submit, in the owner's design. The form always uses its own
 * light palette (not the viewer's dark mode), so the owner's colours look the way they were chosen.
 * fullPage: the page background is painted by the caller (public page), so no coloured band here.
 */
export default function FormRenderer({ form, onSubmitted, previewOnly = false, fullPage = false, hideBranding = true }) {
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [done, setDone] = useState(false);

  const theme = form.theme || {};
  const accent = theme.primaryColor || "#001549";
  const primaryStyle = { background: accent, borderColor: accent, color: contrastText(accent) };
  const bgStyle = fullPage ? undefined : { background: theme.backgroundColor || "#f6f7fb" };
  const fields = useMemo(() => [...form.fields].sort((a, b) => a.order - b.order), [form.fields]);
  const visible = visibleFieldIds(fields, answers);
  const header = theme.headerImage ? assetUrl(theme.headerImage) : null;

  function setAnswer(id, value) {
    setAnswers((a) => ({ ...a, [id]: value }));
    setError(null); // the summary describes the last attempt; field messages below stay until fixed
    if (fieldErrors[id]) setFieldErrors((e) => { const n = { ...e }; delete n[id]; return n; });
  }

  function toggleCheckboxOption(id, option) {
    const current = answers[id] || [];
    setAnswer(id, current.includes(option) ? current.filter((o) => o !== option) : [...current, option]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (previewOnly) return;
    setError(null);
    const { answers: clean, errors } = cleanSubmission(form, answers);
    if (errors.length) {
      setFieldErrors(Object.fromEntries(errors.map((x) => [x.fieldId, x.message])));
      setError(errors.length === 1 ? errors[0].message : `Please fix ${errors.length} answers above.`);
      document.getElementById(`q_${errors[0].fieldId}`)?.focus?.();
      return;
    }
    setSubmitting(true);
    try {
      await api.submit(form._id, clean);
      setDone(true);
      onSubmitted?.();
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message);
      if (err.fields?.length) setFieldErrors(Object.fromEntries(err.fields.map((x) => [x.fieldId, x.message])));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={`form-theme-bg form-light ${fullPage ? "full" : ""}`} style={bgStyle}>
        <div className="form-renderer thank-you">
          {header && <img className="form-header-image" src={header} alt="" />}
          <h1>{form.title}</h1>
          <p className="submitted-message" style={{ color: accent }}>Thanks, your response was recorded.</p>
          <button type="button" className="secondary" onClick={() => { setAnswers({}); setFieldErrors({}); setDone(false); }}>Submit another response</button>
          {!hideBranding && <a className="thanks-brand" href="/"><Logo variant="mark" height={16} /> Made with GUUT Forms</a>}
        </div>
      </div>
    );
  }

  const inputProps = (f) => ({
    id: `q_${f.id}`,
    "aria-invalid": !!fieldErrors[f.id] || undefined,
    "aria-describedby": fieldErrors[f.id] ? `q_${f.id}_err` : undefined,
    "aria-required": f.required || undefined,
  });

  return (
    <div className={`form-theme-bg form-light ${fullPage ? "full" : ""}`} style={bgStyle}>
      <form className="form-renderer" onSubmit={handleSubmit} noValidate>
        {header && <img className="form-header-image" src={header} alt="" />}
        <h1>{form.title}</h1>
        {form.description && <p className="form-desc">{form.description}</p>}

        {fields.filter((f) => visible.has(f.id)).map((f) => {
          const groupLabel = f.type === "checkbox" || f.type === "rating";
          return (
            <div key={f.id} className={`render-field ${fieldErrors[f.id] ? "has-error" : ""}`} role={groupLabel ? "group" : undefined} aria-labelledby={groupLabel ? `q_${f.id}_label` : undefined}>
              <label id={`q_${f.id}_label`} htmlFor={groupLabel ? undefined : `q_${f.id}`}>
                {f.label}
                {f.required && <span className="required-mark" aria-hidden="true">*</span>}
              </label>

              {f.type === "text" && <input {...inputProps(f)} placeholder={f.placeholder} maxLength={LIMITS.text} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />}
              {f.type === "textarea" && <textarea {...inputProps(f)} rows={4} placeholder={f.placeholder} maxLength={LIMITS.textarea} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />}
              {f.type === "number" && <input {...inputProps(f)} type="number" inputMode="decimal" placeholder={f.placeholder} value={answers[f.id] ?? ""} onChange={(e) => setAnswer(f.id, e.target.value)} />}
              {f.type === "email" && <input {...inputProps(f)} type="email" autoComplete="email" placeholder={f.placeholder} maxLength={LIMITS.email} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />}
              {f.type === "date" && <input {...inputProps(f)} type="date" value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />}
              {f.type === "checkbox" && (
                <div className="checkbox-group">
                  {f.options.map((o, i) => (
                    <label key={o} className="checkbox-option">
                      <input type="checkbox" id={i === 0 ? `q_${f.id}` : undefined} checked={(answers[f.id] || []).includes(o)} onChange={() => toggleCheckboxOption(f.id, o)} />
                      <span>{o}</span>
                    </label>
                  ))}
                </div>
              )}
              {f.type === "select" && (
                <select {...inputProps(f)} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)}>
                  <option value="">Select...</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {f.type === "rating" && <Rating field={f} value={answers[f.id]} onChange={(v) => setAnswer(f.id, v)} color={accent} describedBy={fieldErrors[f.id] ? `q_${f.id}_err` : undefined} />}
              {f.type === "file" && <FilePicker form={form} field={f} value={answers[f.id]} onChange={(v) => setAnswer(f.id, v)} previewOnly={previewOnly} describedBy={fieldErrors[f.id] ? `q_${f.id}_err` : undefined} />}
              {fieldErrors[f.id] && <span className="field-error" id={`q_${f.id}_err`} role="alert">{fieldErrors[f.id]}</span>}
            </div>
          );
        })}

        <button className="primary submit-btn" type="submit" style={primaryStyle} disabled={submitting || previewOnly} title={previewOnly ? "Save the form to enable real submissions" : ""}>
          {previewOnly ? "Preview only" : submitting ? "Submitting..." : "Submit"}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </div>
  );
}
