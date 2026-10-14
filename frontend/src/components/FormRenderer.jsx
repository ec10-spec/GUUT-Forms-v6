import React, { useState } from "react";
import { api } from "../api.js";

function isVisible(field, answers) {
  if (!field.showIf?.fieldId) return true;
  const val = answers[field.showIf.fieldId];
  if (Array.isArray(val)) return val.includes(field.showIf.equals);
  return String(val) === String(field.showIf.equals);
}

/** Renders a published form for someone to fill out and submit, with theming. */
export default function FormRenderer({ form, onSubmitted, previewOnly = false }) {
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const theme = form.theme || {};
  const primaryStyle = theme.primaryColor
    ? { background: theme.primaryColor, borderColor: theme.primaryColor }
    : undefined;

  const fields = [...form.fields].sort((a, b) => a.order - b.order);

  function setAnswer(id, value) {
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  function toggleCheckboxOption(id, option) {
    const current = answers[id] || [];
    const next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
    setAnswer(id, next);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (previewOnly) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submit(form._id, answers);
      setDone(true);
      onSubmitted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="form-theme-bg" style={{ background: theme.backgroundColor || undefined }}>
        <div className="submitted-message">Thanks, your response was recorded.</div>
      </div>
    );
  }

  return (
    <div className="form-theme-bg" style={{ background: theme.backgroundColor || undefined }}>
      <form className="form-renderer" onSubmit={handleSubmit}>
        {theme.headerImage && <img className="form-header-image" src={theme.headerImage} alt="" />}
        <h1>{form.title}</h1>
        {form.description && <p className="form-desc">{form.description}</p>}

        {fields.filter((f) => isVisible(f, answers)).map((f) => (
          <div key={f.id} className="render-field">
            <label>
              {f.label}
              {f.required && <span className="required-mark">*</span>}
            </label>

            {f.type === "text" && (
              <input placeholder={f.placeholder} required={f.required} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />
            )}
            {f.type === "textarea" && (
              <textarea rows={4} placeholder={f.placeholder} required={f.required} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />
            )}
            {f.type === "number" && (
              <input type="number" placeholder={f.placeholder} required={f.required} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />
            )}
            {f.type === "email" && (
              <input type="email" placeholder={f.placeholder} required={f.required} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />
            )}
            {f.type === "date" && (
              <input type="date" required={f.required} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)} />
            )}
            {f.type === "checkbox" && (
              <div className="checkbox-group">
                {f.options.map((o) => (
                  <label key={o} className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={(answers[f.id] || []).includes(o)}
                      onChange={() => toggleCheckboxOption(f.id, o)}
                    />
                    {o}
                  </label>
                ))}
              </div>
            )}
            {f.type === "select" && (
              <select required={f.required} value={answers[f.id] || ""} onChange={(e) => setAnswer(f.id, e.target.value)}>
                <option value="">Select...</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.type === "rating" && (
              <div className="rating-group">
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = Number(answers[f.id]) >= n;
                  return (
                    <button
                      type="button"
                      key={n}
                      className={`rating-star ${filled ? "filled" : ""}`}
                      style={filled && theme.primaryColor ? { color: theme.primaryColor } : undefined}
                      onClick={() => setAnswer(f.id, n)}
                    >
                      ★
                    </button>
                  );
                })}
              </div>
            )}
            {f.type === "file" && (
              <input type="file" required={f.required} onChange={(e) => setAnswer(f.id, e.target.files?.[0]?.name || "")} />
            )}
          </div>
        ))}

        <button className="primary" type="submit" style={primaryStyle} disabled={submitting || previewOnly} title={previewOnly ? "Save the form to enable real submissions" : ""}>
          {previewOnly ? "Preview only" : submitting ? "Submitting..." : "Submit"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
