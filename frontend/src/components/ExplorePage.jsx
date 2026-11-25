import React, { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Public repository: a browsable gallery of forms their owners have marked
 * public. No login required — anyone can discover a survey and open it to fill.
 * Signed-in visitors can also save a copy of any listed form into their own
 * account as an editable draft ("save this as a template").
 */
export default function ExplorePage({ onOpenPublic, user, onSaveTemplate, onSignup }) {
  const [forms, setForms] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);

  async function load(query = "") {
    setLoading(true);
    try {
      setForms(await api.listPublicForms(query));
    } catch {
      setForms([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function copyAsTemplate(id, e) {
    e.stopPropagation();
    // Signed out: remember the form, create the account, then copy it (see App.jsx afterAuth).
    if (!user) {
      try { sessionStorage.setItem("guut_pending_copy", id); } catch { /* ignore */ }
      onSignup?.();
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      const copy = await api.duplicateForm(id);
      onSaveTemplate(copy);
    } catch (err) {
      setError(err.message);
      setSavingId(null);
    }
  }

  return (
    <div className="explore">
      <section className="explore-hero">
        <span className="hero-eyebrow"><span className="dot" /> Public repository</span>
        <h1>Explore public surveys</h1>
        <p>Forms the community has shared. Fill one in, or use it as the starting point for your own.</p>
        <form className="explore-search-row" onSubmit={(e) => { e.preventDefault(); load(q); }}>
          <input className="explore-search" placeholder="Search public surveys" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search public surveys" />
          <button className="secondary" type="submit">Search</button>
        </form>
      </section>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <div className="forms-grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</div>
      ) : forms.length === 0 ? (
        <div className="empty-state">
          <h3>{q ? "No surveys match that search" : "No public surveys yet"}</h3>
          <p>{q ? "Try a different word." : "Publish a form and list it on Explore to see it here."}</p>
        </div>
      ) : (
        <div className="forms-grid explore-grid">
          {forms.map((f) => (
            <div key={f._id} className="form-card explore-card" onClick={() => onOpenPublic(f._id)} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpenPublic(f._id)}>
              <h3>{f.title}</h3>
              {f.description && <p className="explore-desc">{f.description}</p>}
              {f.preview?.length > 0 && (
                <ol className="explore-preview" aria-label="First questions">
                  {f.preview.map((label, i) => <li key={i}>{label}</li>)}
                </ol>
              )}
              <p className="form-meta">{f.fieldCount} {f.fieldCount === 1 ? "question" : "questions"}</p>
              <div className="explore-card-actions">
                <button className="primary small" onClick={(e) => { e.stopPropagation(); onOpenPublic(f._id); }}>Fill it in</button>
                <button className="secondary small" disabled={savingId === f._id} onClick={(e) => copyAsTemplate(f._id, e)}>
                  {savingId === f._id ? "Copying..." : "Use as template"}
                </button>
              </div>
            </div>
          ))}
          <div className="form-card explore-cta">
            <h3>Make your own</h3>
            <p>Describe a form and GUUT AI drafts it in seconds.</p>
            <button className="primary small" onClick={() => (user ? (window.location.hash = "/") : onSignup?.())}>{user ? "Create a form" : "Start free"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
