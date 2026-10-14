import React, { useEffect, useState } from "react";
import { api, getUser } from "../api.js";

/**
 * Teams: named groups of people. In a business, anyone can add colleagues. For individuals, a team can be friends,
 * a class or a club: add anyone who has a GUUT Forms account.
 * Share a form with a team from the form's Share menu, and everyone in it gets access.
 */
export default function TeamsPage({ user }) {
  const business = user?.company?.type === "business";
  const [teams, setTeams] = useState(null);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() { try { setTeams(await api.teams()); setError(null); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { const t = await api.teamCreate(name); setName(""); await load(); setOpen(t._id); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="teams-page">
      <h1>Teams</h1>
      <p className="settings-hint">
        {business
          ? "A team is a named group in your company, like Marketing. Anyone can create one and add colleagues. "
          : "A team is a group of people, like a study group, a club or friends. Add anyone who has a GUUT Forms account. "}
        Share a form with a team from the form's Share menu and everyone in it gets access, now and as people join or leave.
      </p>
      {error && <p className="error">{error}</p>}
      <form className="inline-form wrap" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={business ? "New team name (for example Marketing)" : "New team name (for example Study group)"} maxLength={60} required />
        <button className="primary" disabled={busy} type="submit">Create team</button>
      </form>
      {!teams ? <p className="empty-hint">Loading...</p> : teams.length === 0 ? (
        <p className="empty-hint">No teams yet. Create the first one above.</p>
      ) : (
        <div className="admin-cards">
          {teams.map((t) => (
            <TeamCard key={t._id} t={t} open={open === t._id} onToggle={() => setOpen(open === t._id ? null : t._id)} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCard({ t, open, onToggle, onChanged }) {
  const [d, setD] = useState(null);
  const [eligible, setEligible] = useState([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState(t.name);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const me = getUser()?._id;

  async function load() {
    try {
      const det = await api.team(t._id);
      setD(det);
      if (det.canManage) setEligible(await api.teamEligible(t._id));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); await load(); onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head" onClick={onToggle} style={{ cursor: "pointer" }}>
        <div>
          <strong>{t.name}</strong>
          <span className="admin-meta">{t.memberCount} member{t.memberCount === 1 ? "" : "s"}{t.createdBy ? ` · created by ${t.createdBy.name || t.createdBy.email}` : ""}{t.isMember ? " · you're in this team" : ""}</span>
        </div>
        <span className="share-row-action">{open ? "Hide" : "Open"}</span>
      </div>
      {open && (
        <div className="team-body">
          {error && <p className="error">{error}</p>}
          {!d ? <p className="empty-hint">Loading...</p> : (
            <>
              {d.canManage && (
                <>
                  <form className="inline-form wrap" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.teamAddMember(t._id, email); setEmail(""); }); }}>
                    <input list={`elig-${t._id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.open ? "Their account email" : "Colleague's email"} required />
                    <datalist id={`elig-${t._id}`}>{eligible.map((u) => <option key={u._id} value={u.email}>{u.name}</option>)}</datalist>
                    <button className="primary" disabled={busy} type="submit">Add</button>
                  </form>
                  <form className="inline-form wrap" onSubmit={(e) => { e.preventDefault(); run(() => api.teamRename(t._id, name)); }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Team name" />
                    <button className="secondary" disabled={busy || name.trim() === t.name} type="submit">Rename</button>
                    <button type="button" className="danger" disabled={busy} onClick={() => { if (confirm(`Delete the team "${t.name}"? Forms shared with it stop being shared with its members.`)) run(() => api.teamDelete(t._id)); }}>Delete team</button>
                  </form>
                </>
              )}
              {d.members.map((m) => (
                <div key={m._id} className="people-row">
                  <div><strong>{m.name || m.email}</strong><span>{m.email}</span></div>
                  {(d.canManage || m._id === me) && (
                    <button className="small" disabled={busy} onClick={() => run(() => api.teamRemoveMember(t._id, m._id))}>
                      {m._id === me && !d.canManage ? "Leave" : "Remove"}
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
