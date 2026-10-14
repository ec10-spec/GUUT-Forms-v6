import React, { Suspense, lazy, useEffect, useState } from "react";
import { api } from "../api.js";
import { TeamUsage } from "./UsageViews.jsx";
import { JoinPanel, Billing } from "./JoinAndBilling.jsx";

// The platform console is a separate chunk that is only fetched when the signed-in
// user really is on the platform team. Company admins never download it.
const PlatformAdmin = lazy(() => import("./PlatformAdmin.jsx"));

/**
 * Admin area. Platform team: the platform console (companies, users, logs). Company
 * admin: their own team, form problems and AI usage. Both are enforced server-side
 * as well; hiding things in the UI is only a convenience.
 */
export default function AdminPage({ currentUser }) {
  return currentUser.role === "superadmin"
    ? <Suspense fallback={<p className="empty-hint">Loading...</p>}><PlatformAdmin currentUser={currentUser} /></Suspense>
    : <CompanyAdmin currentUser={currentUser} />;
}

// A customer's company admin: their team and the problems with their forms.
// (Their database link lives in Settings → Database.)
function CompanyAdmin({ currentUser }) {
  const [tab, setTab] = useState("problems");
  const [info, setInfo] = useState(null);
  const [teamKey, setTeamKey] = useState(0); // refresh the team list after approving someone
  useEffect(() => { api.companyInfo().then(setInfo).catch(() => {}); }, []);
  return (
    <div className="admin-page">
      <span className="hero-eyebrow"><span className="dot" /> {info?.name || "Your company"}</span>
      <h1>Admin</h1>
      {info && ["past_due", "canceled"].includes(info.billing?.status) && (
        <div className="db-banner">
          <strong>{info.billing.status === "canceled" ? "Your subscription is canceled." : "Your payment is overdue."}</strong> Open the Billing tab to review your plan.
        </div>
      )}
      <div className="settings-tabs">
        <button className={tab === "problems" ? "active" : ""} onClick={() => setTab("problems")}>Form problems</button>
        <button className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>Team</button>
        <button className={tab === "billing" ? "active" : ""} onClick={() => setTab("billing")}>Billing</button>
        <button className={tab === "usage" ? "active" : ""} onClick={() => setTab("usage")}>AI usage</button>
      </div>
      {tab === "problems" && <Problems />}
      {tab === "team" && <><JoinPanel onChanged={() => setTeamKey((k) => k + 1)} /><Team key={teamKey} currentUser={currentUser} /></>}
      {tab === "billing" && <Billing />}
      {tab === "usage" && <TeamUsage />}
    </div>
  );
}

const fmt = (d) => (d ? new Date(d).toLocaleString() : "-");

// ------------------------------------------------------- company admin: team
function Team({ currentUser }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "user" });

  async function load() { try { setUsers(await api.companyUsers()); setError(null); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try { await api.companyAddUser(form); setForm({ email: "", name: "", password: "", role: "user" }); load(); } catch (err) { setError(err.message); }
  }
  async function patch(id, payload) { try { await api.companyUpdateUser(id, payload); load(); } catch (err) { setError(err.message); } }

  return (
    <div>
      <p className="settings-hint">Add the people who will build forms. They sign in with the <strong>User login</strong> tab using the email and temporary password you set here.</p>
      {error && <p className="error">{error}</p>}
      <form className="inline-form wrap" onSubmit={create}>
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input type="password" placeholder="Temporary password (8+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="user">Regular user</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary" type="submit">Add person</button>
      </form>
      {!users ? <p className="empty-hint">Loading...</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Person</th><th>Type</th><th>Last login</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u._id === currentUser._id;
                return (
                  <tr key={u._id} className={u.active ? "" : "row-muted"}>
                    <td><strong>{u.name || u.email}</strong>{u.name && <div className="admin-meta">{u.email}</div>}</td>
                    <td>
                      <select value={u.role} disabled={self} onChange={(e) => patch(u._id, { role: e.target.value })}>
                        <option value="user">Regular user</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>{fmt(u.lastLoginAt)}</td>
                    <td>{u.active ? "Active" : "Disabled"}</td>
                    <td className="admin-actions">
                      <button className="secondary small" disabled={self} onClick={() => patch(u._id, { active: !u.active })}>{u.active ? "Disable" : "Enable"}</button>
                      <button className="secondary small" onClick={() => { const p = prompt(`New password for ${u.email} (8+ characters):`); if (p) patch(u._id, { newPassword: p }); }}>Reset password</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------- company admin: form problems
function Problems() {
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(append = false) {
    setLoading(true);
    try {
      const { problems, hasMore } = await api.companyProblems(append && rows.length ? rows[rows.length - 1].createdAt : "");
      setRows(append ? [...rows, ...problems] : problems); setHasMore(hasMore); setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div>
      <p className="settings-hint">
        Problems with <strong>your company's forms</strong>: reports from people filling them in or using them, database connection trouble,
        and form errors. Problems with the application itself go to the platform team, not here.
      </p>
      {error && <p className="error">{error}</p>}
      {!loading && rows.length === 0 ? <p className="empty-hint">No problems reported. All good.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Time</th><th>Type</th><th>What happened</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id}>
                  <td className="nowrap">{fmt(l.createdAt)}</td>
                  <td><span className={`log-level ${l.category === "user_report" ? "warn" : l.level}`}>{l.category === "user_report" ? "reported" : l.category === "db" ? "database" : "error"}</span></td>
                  <td className="report-detail">
                    {l.message}
                    {(l.name || l.email) && <div className="admin-meta">From: {[l.name, l.email].filter(Boolean).join(" · ")}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <p className="empty-hint">Loading...</p>}
      {hasMore && !loading && <button className="secondary" onClick={() => load(true)}>Load older</button>}
      <button className="secondary" onClick={() => load()} style={{ marginLeft: hasMore ? 8 : 0 }}>Refresh</button>
    </div>
  );
}
