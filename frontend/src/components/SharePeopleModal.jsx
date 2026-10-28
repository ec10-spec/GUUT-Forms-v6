import React, { useEffect, useState } from "react";
import { api, getUser } from "../api.js";

const ROLE_HELP = { viewer: "Viewer: can open the form, see responses and charts", editor: "Editor: can also edit and publish" };

/**
 * Per-form sharing. Owner or company admin: give access by team email, change roles,
 * remove people, and answer access requests. Only people already on the same team
 * can be added; the server enforces that.
 */
export default function SharePeopleModal({ form, onClose }) {
  const [info, setInfo] = useState(null);
  const [eligible, setEligible] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [invite, setInvite] = useState(null); // { email, link } when offering to invite a non-member
  const [copied, setCopied] = useState(false);
  const me = getUser();
  const individual = me?.company?.type === "individual";
  const isCompanyAdmin = me?.company?.type === "business" && me?.role === "admin";

  async function load() {
    try {
      const i = await api.shareInfo(form._id);
      setInfo(i);
      if (i.canManage) setEligible(await api.shareEligible(form._id));
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [form._id]);

  async function run(fn) {
    setBusy(true); setError(null); setErrorCode(null); setInvite(null);
    try { await fn(); await load(); } catch (err) { setError(err.message); setErrorCode(err.code || null); } finally { setBusy(false); }
  }

  // Someone outside the company: admins can send them the company's join link; members ask an admin.
  async function offerInvite() {
    try {
      const j = await api.companyJoin();
      setInvite({ email, link: `${window.location.origin}${window.location.pathname}#/join/${j.code}`, enabled: j.enabled });
    } catch (err) { setError(err.message); }
  }

  const [teamId, setTeamId] = useState("");
  const [teamRole, setTeamRole] = useState("viewer");
  const addTeam = (e) => { e.preventDefault(); if (teamId) run(async () => { await api.shareTeamAdd(form._id, teamId, teamRole); setTeamId(""); }); };
  const add = (e) => { e.preventDefault(); run(async () => { await api.shareAdd(form._id, email, role); setEmail(""); }); };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" role="dialog" aria-label="Share with people">
        <div className="modal-head">
          <h2>Share "{form.title}"</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && (
          <div className="error-inline">
            <p className="error">{error}</p>
            {errorCode === "NOT_A_MEMBER" && (isCompanyAdmin
              ? <button className="secondary small" onClick={offerInvite}>Invite them to join your company</button>
              : <span className="settings-hint small">Ask your company admin to invite them to the company first.</span>)}
          </div>
        )}
        {invite && (
          <div className="invite-box">
            <p className="settings-hint">Send {invite.email || "them"} this link. Once they join and you approve them under Approvals, you can share the form.{invite.enabled ? "" : " Your company isn't accepting new requests right now: turn that on in Admin, Team."}</p>
            <div className="code-row">
              <code className="join-code link">{invite.link}</code>
              <button className="primary small" onClick={() => { navigator.clipboard?.writeText(invite.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy link"}</button>
              <a className="secondary small btn-link" href={`mailto:${encodeURIComponent(invite.email || "")}?subject=${encodeURIComponent(`Join ${me?.company?.name || "our company"} on GUUT Forms`)}&body=${encodeURIComponent(`Join our workspace on GUUT Forms: ${invite.link}`)}`}>Email it</a>
            </div>
          </div>
        )}
        {!info ? <p className="empty-hint">Loading...</p> : !info.canManage ? (
          <p className="settings-hint">You have {info.myAccess} access to this form. Only the owner or a company admin can change who has access.</p>
        ) : (
          <>
            <p className="settings-hint">
              {individual
                ? "Share with anyone who has a GUUT Forms account, by email. They need a free account first, and they only get access to this form."
                : "You can only share with people on your team. Company admins already have full access."}
            </p>
            <form className="inline-form wrap" onSubmit={add}>
              <input list="team-emails" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={individual ? "Their account email" : "Teammate's email"} required />
              <datalist id="team-emails">{eligible.map((u) => <option key={u._id} value={u.email}>{u.name}</option>)}</datalist>
              <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access level">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button className="primary" disabled={busy} type="submit">Give access</button>
            </form>
            <p className="settings-hint small">{ROLE_HELP[role]}</p>

            {info.requests?.length > 0 && (
              <>
                <h3 className="usage-subhead">Access requests</h3>
                {info.requests.map((r) => (
                  <div key={r._id} className="people-row">
                    <div><strong>{r.name || r.email}</strong><span>{r.email} asked for {r.role === "editor" ? "edit" : "view"} access{r.message ? `: "${r.message}"` : ""}</span></div>
                    <div className="people-actions">
                      <button className="primary small" disabled={busy} onClick={() => run(() => api.shareApprove(form._id, r._id, r.role))}>Approve</button>
                      <button className="small" disabled={busy} onClick={() => run(() => api.shareDeny(form._id, r._id))}>Decline</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {(info.availableTeams?.length > 0 || info.teams?.length > 0) && (
              <>
                <h3 className="usage-subhead">Share with a team</h3>
                <p className="settings-hint small">Everyone in the team gets this access, and it follows the team: people added later get it, people removed lose it.</p>
                {info.availableTeams?.length > 0 && (
                  <form className="inline-form wrap" onSubmit={addTeam}>
                    <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team" required>
                      <option value="">Choose a team</option>
                      {info.availableTeams.map((t) => <option key={t._id} value={t._id}>{t.name} ({t.memberCount})</option>)}
                    </select>
                    <select value={teamRole} onChange={(e) => setTeamRole(e.target.value)} aria-label="Team access level">
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button className="primary" disabled={busy || !teamId} type="submit">Share with team</button>
                  </form>
                )}
                {info.teams.map((t) => (
                  <div key={t._id} className="people-row">
                    <div><strong>{t.name}</strong><span>{t.memberCount} member{t.memberCount === 1 ? "" : "s"}</span></div>
                    <div className="people-actions">
                      <select value={t.role} disabled={busy} onChange={(e) => run(() => api.shareTeamRole(form._id, t._id, e.target.value))}>
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button className="danger small" disabled={busy} onClick={() => run(() => api.shareTeamRemove(form._id, t._id))}>Remove</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            <h3 className="usage-subhead">People with access</h3>
            <div className="people-row">
              <div><strong>{info.owner?.name || info.owner?.email}</strong><span>{info.owner?.email}</span></div>
              <span className="access-badge">Owner</span>
            </div>
            {info.collaborators.map((c) => (
              <div key={c._id} className="people-row">
                <div><strong>{c.name || c.email}</strong><span>{c.email}</span></div>
                <div className="people-actions">
                  <select value={c.role} disabled={busy} onChange={(e) => run(() => api.shareSetRole(form._id, c._id, e.target.value))}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button className="danger small" disabled={busy} onClick={() => run(() => api.shareRemove(form._id, c._id))}>Remove</button>
                </div>
              </div>
            ))}
            {info.collaborators.length === 0 && <p className="empty-hint">Not shared with anyone yet.</p>}
          </>
        )}
      </div>
    </div>
  );
}
