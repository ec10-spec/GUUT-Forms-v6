import React, { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Public repository: a browsable gallery of forms their owners have marked
 * public. No login required — anyone can discover a survey and open it to fill.
 * Signed-in visitors can also save a copy of any listed form into their own
 * account as an editable draft ("save this as a template").
 */
export default function ExplorePage({ onOpenPublic, user, onSaveTemplate }) {
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

  async function handleSaveTemplate(id, e) {
    e.stopPropagation();
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
        <p>Browse forms the community has shared. Open any one to fill it out, or save a copy as your own.</p>
        <input
          className="explore-search"
          placeholder="Search public surveys..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(q)}
        />
      </section>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="empty-hint">Loading...</p>
      ) : forms.length === 0 ? (
        <p className="empty-hint">No public surveys yet. Publish one and mark it public to see it here.</p>
      ) : (
        <div className="forms-grid">
          {forms.map((f) => (
            <div key={f._id} className="form-card" onClick={() => onOpenPublic(f._id)}>
              <h3>{f.title}</h3>
              {f.description && <p className="explore-desc">{f.description}</p>}
              <p className="form-meta">
                {f.fieldCount} field{f.fieldCount === 1 ? "" : "s"} · public
              </p>
              <div className="explore-card-actions">
                <button className="secondary small" onClick={(e) => { e.stopPropagation(); onOpenPublic(f._id); }}>
                  Open survey
                </button>
                {user && (
                  <button
                    className="small"
                    disabled={savingId === f._id}
                    onClick={(e) => handleSaveTemplate(f._id, e)}
                  >
                    {savingId === f._id ? "Saving..." : "Save as template"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
