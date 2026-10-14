import React, { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Home: (1) access requests waiting for me to approve, (2) forms on my team I could ask
 * to see or edit. Titles are only ever shown to people in the same company.
 */
export default function TeamAccess({ user, onChanged, onOpenForm }) {
  const [requests, setRequests] = useState([]);
  const [teamForms, setTeamForms] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const browse = user.role === "user";

  async function load() {
    try {
      setRequests(await api.shareRequests());
      if (browse) setTeamForms(await api.teamForms());
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function act(key, fn) {
    setBusy(key); setError(null);
    try { await fn(); await load(); onChanged?.(); } catch (err) { setError(err.message); } finally { setBusy(null); }
  }

  const others = teamForms.filter((f) => !f.myAccess || f.myAccess === "viewer");
  if (!requests.length && !others.length) return null;

  return (
    <section className="team-access">
      {error && <p className="error">{error}</p>}
      {requests.length > 0 && (
        <div className="team-card">
          <h2>Access requests</h2>
          {requests.map((r) => (
            <div key={`${r.formId}-${r._id}`} className="people-row">
              <div><strong>{r.name || r.email}</strong><span>wants {r.role === "editor" ? "edit" : "view"} access to "{r.formTitle}"{r.message ? `: "${r.message}"` : ""}</span></div>
              <div className="people-actions">
                <button className="primary small" disabled={busy === r._id} onClick={() => act(r._id, () => api.shareApprove(r.formId, r._id, r.role))}>Approve</button>
                <button className="small" disabled={busy === r._id} onClick={() => act(r._id, () => api.shareDeny(r.formId, r._id))}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <details className="team-card">
          <summary>Team forms you can ask to access ({others.length})</summary>
          {others.map((f) => (
            <div key={f._id} className="people-row">
              <div><strong>{f.title}</strong><span>{f.owner ? `Owner: ${f.owner.name || f.owner.email}` : ""}{f.myAccess === "viewer" ? " · you can view" : ""}</span></div>
              <div className="people-actions">
                {f.requestedRole ? <span className="access-badge subtle">Requested {f.requestedRole === "editor" ? "edit" : "view"}</span> : (
                  <>
                    {!f.myAccess && <button className="small" disabled={busy === f._id} onClick={() => act(f._id, () => api.shareRequest(f._id, "viewer"))}>Request view</button>}
                    <button className="small" disabled={busy === f._id} onClick={() => act(f._id, () => api.shareRequest(f._id, "editor"))}>Request edit</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
