import React, { useEffect, useState } from "react";
import { api } from "../api.js";

const when = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

/** Company admins: people asking to join and forms waiting to be listed in the public repository. */
export default function ApprovalsPage({ onCount }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    try { const d = await api.approvals(); setData(d); onCount?.(d.total); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function act(key, fn) {
    setBusy(key); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading...</p>;

  return (
    <div className="admin-page approvals-page">
      <span className="hero-eyebrow"><span className="dot" /> Company admin</span>
      <h1>Approvals</h1>
      <p className="settings-hint">Decisions waiting for you. {data.total === 0 ? "Nothing is waiting right now." : `${data.total} waiting.`}</p>
      {error && <p className="error">{error}</p>}

      <section className="approval-section">
        <h2>People asking to join <span className="count-pill">{data.joins.length}</span></h2>
        {data.joins.length === 0 && <p className="muted">No one is waiting to join.</p>}
        {data.joins.map((r) => (
          <div key={r._id} className="approval-row">
            <div><strong>{r.name || r.email}</strong><span>{r.email}{r.requestedAt ? `, requested ${when(r.requestedAt)}` : ""}</span></div>
            <div className="approval-actions">
              <button className="primary small" disabled={busy === r._id} onClick={() => act(r._id, () => api.companyJoinDecide(r._id, true))}>Approve</button>
              <button className="secondary small" disabled={busy === r._id} onClick={() => act(r._id, () => api.companyJoinDecide(r._id, false))}>Decline</button>
            </div>
          </div>
        ))}
      </section>

      <section className="approval-section">
        <h2>Forms to list publicly <span className="count-pill">{data.listings.length}</span></h2>
        <p className="settings-hint">Public forms appear in Explore for everyone. Review the form before approving.</p>
        {data.listings.length === 0 && <p className="muted">No forms are waiting to be listed.</p>}
        {data.listings.map((l) => (
          <div key={l.formId} className="approval-row">
            <div>
              <strong>{l.title}</strong>
              <span>{l.fieldCount} fields{l.requestedBy ? `, requested by ${l.requestedBy.name || l.requestedBy.email}` : ""}{l.requestedAt ? `, ${when(l.requestedAt)}` : ""}</span>
              {l.description && <span className="approval-desc">{l.description}</span>}
            </div>
            <div className="approval-actions">
              <a className="secondary small btn-link" href={`#/f/${l.formId}`} target="_blank" rel="noreferrer">Preview</a>
              <button className="primary small" disabled={busy === l.formId} onClick={() => act(l.formId, () => api.listingApprove(l.formId))}>Approve</button>
              <button className="secondary small" disabled={busy === l.formId} onClick={() => act(l.formId, () => api.listingDeny(l.formId))}>Decline</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
