import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { platformApi } from "../platformApi.js";
import { fmtBytes } from "./UsageViews.jsx";
import { DaysSelect, UsageTotals, UsageTable, fmtTokens } from "./UsageViews.jsx";

/**
 * Platform-team console: platform health, companies and their linked databases,
 * users, AI usage and the backend logs. This file (and platformApi.js) is only
 * downloaded by the platform team. Every endpoint behind it is also enforced
 * server-side.
 */

// The platform team (us): every company, every user, all logs.
export default function PlatformAdmin({ currentUser }) {
  const [tab, setTab] = useState("companies");
  return (
    <div className="admin-page">
      <span className="hero-eyebrow"><span className="dot" /> Platform team</span>
      <h1>Admin</h1>
      <div className="settings-tabs">
        {[["companies", "Companies & databases"], ["users", "Users"], ["usage", "AI usage"], ["logs", "Logs"], ["overview", "Platform"]].map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "companies" && <Companies />}
      {tab === "users" && <Users currentUser={currentUser} />}
      {tab === "usage" && <PlatformUsage />}
      {tab === "logs" && <Logs />}
      {tab === "overview" && <Overview />}
    </div>
  );
}

const fmt = (d) => (d ? new Date(d).toLocaleString() : "-");

// ------------------------------------------------------------------ platform
function Overview() {
  const [o, setO] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { platformApi.adminOverview().then(setO).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!o) return <p className="empty-hint">Loading...</p>;
  return (
    <div className="settings-panel wide">
      <h2>Platform database (ours)</h2>
      <p className="settings-hint">
        Holds accounts, companies, logs and the form directory. It is set with the <code>MONGO_URI</code> environment
        variable on your host (Render), so it is changed there, not here. Form data lives in each business's own database if it linked one, otherwise in our separate hosted database.
      </p>
      <p className="key-status">
        <span className={`key-dot ${o.platformDb.connected ? "key-dot-on" : ""}`} />
        {o.platformDb.connected ? `Connected to ${o.platformDb.host} / ${o.platformDb.name}` : "Not connected"}
      </p>
      <div className="stat-row">
        {[["Users", o.counts.users], ["Businesses", o.counts.companies], ["Individuals", o.counts.individuals], ["Waiting to join", o.counts.pendingJoins], ["Forms", o.counts.forms], ["Errors (24h)", o.counts.errors24h], ["Warnings (24h)", o.counts.warns24h]].map(([k, v]) => (
          <div key={k} className="stat"><strong>{v}</strong><span>{k}</span></div>
        ))}
      </div>
      <p className="settings-hint">
        Forms and responses are never stored in this platform database. Individuals, and businesses that haven't linked their own database, are stored in the separate hosted database (HOSTED_DB_NAME, default guut_hosted).
      </p>
    </div>
  );
}

// ------------------------------------------------------- billing (set by us, no payment processor yet)
function BillingEditor({ c, onChanged }) {
  const [plans, setPlans] = useState([]);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api.plans().then((p) => setPlans(p.business)).catch(() => {}); }, []);
  async function save(patch) {
    setMsg(null);
    try { await platformApi.adminSetBilling(c._id, patch); onChanged(); } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="billing-editor">
      <label>Plan
        <select value={c.billing?.plan || ""} onChange={(e) => save({ plan: e.target.value || null })}>
          <option value="">None</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Status
        <select value={c.billing?.status || "active"} onChange={(e) => save({ status: e.target.value })}>
          <option value="trialing">Trial</option><option value="active">Active</option><option value="past_due">Payment overdue</option><option value="canceled">Canceled</option>
        </select>
      </label>
      {c.billing?.requestedPlan && <span className="access-badge">Requested: {c.billing.requestedPlan}</span>}
      {msg && <span className="error">{msg}</span>}
    </div>
  );
}

// ------------------------------------------------------- companies + databases
function Companies() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ name: "", adminEmail: "", adminName: "", adminPassword: "" });
  const [open, setOpen] = useState(null); // company id with the link-database form open
  const [type, setType] = useState("business");
  const [q, setQ] = useState("");

  async function load() {
    try { setList(await platformApi.adminCompanies(type, q.trim())); setError(null); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [type]);

  async function create(e) {
    e.preventDefault();
    setNotice(null);
    try {
      const r = await platformApi.adminCreateCompany(form);
      setNotice(r.admin
        ? `Created ${r.company.name}. ${r.admin.email} can sign in with the Admin login using the temporary password you set, then link the company's database in Settings.`
        : `Created ${r.company.name}. Add its first admin from the Users tab.`);
      setForm({ name: "", adminEmail: "", adminName: "", adminPassword: "" });
      setError(null);
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div>
      <p className="settings-hint">
        Businesses sign themselves up from the login page, and you can also create one here. No company can see that any other company exists.
      </p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="key-saved-msg">{notice}</p>}
      <form className="inline-form wrap" onSubmit={create}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Company name" required />
        <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="First admin email" />
        <input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} placeholder="Admin name" />
        <input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="Temporary password (8+)" minLength={8} required={!!form.adminEmail} />
        <button className="primary" type="submit">Create company</button>
      </form>
      <div className="inline-form wrap">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Account type">
          <option value="business">Businesses</option>
          <option value="individual">Individuals</option>
          <option value="all">All</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search by name" />
        <button className="secondary" type="button" onClick={load}>Search</button>
      </div>
      {!list ? <p className="empty-hint">Loading...</p> : (
        <div className="admin-cards">
          {list.map((c) => (
            <CompanyCard key={c._id} c={c} open={open === c._id} onToggle={() => setOpen(open === c._id ? null : c._id)} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCard({ c, open, onToggle, onChanged }) {
  const [uri, setUri] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function run(fn, okText) {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: typeof okText === "function" ? okText(r) : okText }); onChanged(); return r; }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }
  const copied = (r) => (r.migrated ? ` Copied ${r.migrated.forms} form(s) and ${r.migrated.submissions} response(s).` : "");

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <div>
          <h3>{c.name}</h3>
          <span className="admin-meta">{c.type === "individual" ? "Individual" : "Business"} · {c.userCount} user(s) · {c.formCount} form(s) · {fmtBytes(c.storage?.bytes)}{c.storageLimitBytes ? ` of ${fmtBytes(c.storageLimitBytes)}` : ""} stored</span>
        </div>
        <span className={`db-pill ${c.dbMode}`}>{c.dbMode === "custom" ? "Own database" : "Hosted by us"}</span>
      </div>
      {c.type === "business" && <BillingEditor c={c} onChanged={onChanged} />}
      <button className="link-btn align-left" onClick={async () => { try { await platformApi.adminRecalcStorage(c._id); onChanged(); } catch (e) { alert(e.message); } }}>Recalculate storage</button>
      {c.dbMode === "custom" && (
        <p className="admin-meta">{c.dbHost} / {c.dbName} · last verified {fmt(c.dbCheckedAt)}</p>
      )}
      <div className="admin-actions">
        <button className="secondary small" onClick={onToggle}>{c.dbMode === "custom" ? "Change database" : "Link own database"}</button>
        {c.dbMode === "custom" && (
          <>
            <button className="secondary small" disabled={busy} onClick={() => run(async () => { const r = await platformApi.adminCheckDb(c._id); if (!r.ok) throw new Error(r.error); return r; }, "Database is reachable and writable.")}>Check</button>
            <button className="danger small" disabled={busy} onClick={() => {
              if (confirm(`Unlink ${c.name}'s database?\n\nTheir forms and responses are copied into our hosted storage first (the originals stay untouched in their own database), then they continue on hosted storage.`)) {
                run(() => platformApi.adminUnlinkDb(c._id), "Unlinked.");
              }
            }}>Unlink</button>
          </>
        )}
      </div>
      {open && (
        <div className="admin-form">
          <label>
            MongoDB connection string for {c.name}
            <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="mongodb+srv://user:password@cluster.mongodb.net/acme_forms" autoComplete="off" />
          </label>
          <p className="settings-hint small">
            Must include a database name and a user with read/write access. It's encrypted at rest and never shown again.
          </p>
          <label className="check-row">
            <input type="checkbox" checked={migrate} onChange={(e) => setMigrate(e.target.checked)} />
            Copy this company's existing forms and responses into the new database (originals are left in place)
          </label>
          <div className="admin-actions">
            <button className="secondary small" disabled={busy || !uri.trim()} onClick={() => run(() => platformApi.adminTestDb(uri.trim()), (r) => `Connection works (${r.host} / ${r.dbName}).`)}>Test</button>
            <button className="primary small" disabled={busy || !uri.trim()} onClick={async () => {
              const r = await run(() => platformApi.adminLinkDb(c._id, uri.trim(), migrate), (r) => `Linked.${copied(r)}`);
              if (r) { setUri(""); onToggle(); }
            }}>{busy ? "Working..." : "Save & link"}</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? "key-saved-msg" : "error"}>{msg.text}</p>}
    </div>
  );
}

// --------------------------------------------------------------------- users
function Users({ currentUser }) {
  const [users, setUsers] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "user", companyId: "" });

  async function load() {
    try {
      const [u, c] = await Promise.all([platformApi.adminUsers(), platformApi.adminCompanies()]);
      setUsers(u); setCompanies(c); setError(null);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try { await platformApi.adminCreateUser({ ...form, companyId: form.companyId || undefined }); setForm({ email: "", name: "", password: "", role: "user", companyId: "" }); load(); }
    catch (err) { setError(err.message); }
  }
  async function patch(id, payload) {
    try { await platformApi.adminUpdateUser(id, payload); load(); } catch (err) { setError(err.message); }
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <form className="inline-form wrap" onSubmit={create}>
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input type="password" placeholder="Temporary password (8+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required />
        <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
          <option value="">New workspace</option>
          {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="user">Regular user</option>
          <option value="admin">Company admin</option>
          <option value="superadmin">Platform team</option>
        </select>
        <button className="primary" type="submit">Add user</button>
      </form>
      {!users ? <p className="empty-hint">Loading...</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>User</th><th>Company</th><th>Type</th><th>Last login</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u._id === currentUser._id;
                return (
                  <tr key={u._id} className={u.active ? "" : "row-muted"}>
                    <td><strong>{u.name || u.email}</strong>{u.name && <div className="admin-meta">{u.email}</div>}</td>
                    <td>
                      <select value={u.companyId || ""} onChange={(e) => confirm("Moving a user does not move the forms they already created. Continue?") && patch(u._id, { companyId: e.target.value })}>
                        {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={u.role} disabled={self} onChange={(e) => patch(u._id, { role: e.target.value })}>
                        <option value="user">Regular user</option>
                        <option value="admin">Company admin</option>
                        <option value="superadmin">Platform team</option>
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

// ---------------------------------------------------------------------- logs
const CATEGORIES = ["auth", "form", "ai", "admin", "db", "http", "server_error", "client_error", "user_report", "system"];

function Logs() {
  const [filters, setFilters] = useState({ level: "", category: "", q: "" });
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attach, setAttach] = useState({}); // log id -> base64 data URL

  async function load(append = false) {
    setLoading(true);
    try {
      const before = append && rows.length ? rows[rows.length - 1].createdAt : "";
      const { logs, hasMore } = await platformApi.adminLogs({ ...filters, before });
      setRows(append ? [...rows, ...logs] : logs);
      setHasMore(hasMore); setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.level, filters.category]);

  async function showAttachment(l) {
    const full = await platformApi.adminLog(l._id);
    setAttach((a) => ({ ...a, [l._id]: `data:${full.attachment.mediaType || "application/octet-stream"};base64,${full.attachment.base64}` }));
  }

  return (
    <div>
      <p className="settings-hint">
        Written by the backend into the platform database: sign-ins, failures, form and admin actions, AI calls (no prompts or keys),
        server errors, browser errors, and user problem reports. Entries expire automatically.
      </p>
      <div className="inline-form wrap">
        <select value={filters.level} onChange={(e) => setFilters({ ...filters, level: e.target.value })}>
          <option value="">All levels</option><option value="error">Errors</option><option value="warn">Warnings</option><option value="info">Info</option>
        </select>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="Search message, route, email..." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button className="secondary" onClick={() => load()}>Search / refresh</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && rows.length === 0 ? <p className="empty-hint">No log entries match.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Time</th><th>Level</th><th>Category</th><th>Message</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id}>
                  <td className="nowrap">{fmt(l.createdAt)}</td>
                  <td><span className={`log-level ${l.level}`}>{l.level}</span></td>
                  <td>{l.category}</td>
                  <td className="report-detail">
                    {l.message}
                    <div className="admin-meta">
                      {[l.route, l.statusCode, l.durationMs != null && `${l.durationMs}ms`, [l.name, l.email].filter(Boolean).join(" · "), l.userId && `user ${l.userId.slice(-6)}`].filter(Boolean).join(" · ")}
                    </div>
                    {l.attachment?.name && (
                      attach[l._id]
                        ? <a href={attach[l._id]} download={l.attachment.name}>Download {l.attachment.name}</a>
                        : <button className="link-btn" onClick={() => showAttachment(l)}>📎 Load {l.attachment.name}</button>
                    )}
                    {(l.stack || l.meta || l.url) && (
                      <details>
                        <summary>details</summary>
                        {l.url && <div className="admin-meta">Page: {l.url}</div>}
                        {l.meta && <pre>{JSON.stringify(l.meta, null, 2)}</pre>}
                        {l.stack && <pre>{l.stack}</pre>}
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <p className="empty-hint">Loading...</p>}
      {hasMore && !loading && <button className="secondary" onClick={() => load(true)}>Load older</button>}
    </div>
  );
}


// ------------------------------------------------------------------ AI usage
function PlatformUsage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setData(null); platformApi.adminUsage(days).then(setData).catch((e) => setError(e.message)); }, [days]);
  if (error) return <p className="error">{error}</p>;
  return (
    <div>
      <p className="settings-hint">Estimated AI token use for every user on the platform. Users pay their own provider with their own key; this shows how much each is using.</p>
      <DaysSelect days={days} onChange={setDays} />
      {!data ? <p className="empty-hint">Loading...</p> : (
        <>
          <UsageTotals data={data} />
          <h3 className="usage-subhead">By company</h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Company</th><th>Calls</th><th>Tokens</th><th>Est. cost</th></tr></thead>
              <tbody>
                {data.companies.map((c) => <tr key={c.companyId}><td><strong>{c.companyName || "-"}</strong></td><td>{c.calls}</td><td>{fmtTokens(c.tokens)}</td><td>${c.estimatedCostUsd}</td></tr>)}
              </tbody>
            </table>
          </div>
          <h3 className="usage-subhead">By user</h3>
          <UsageTable rows={data.rows} showCompany />
        </>
      )}
    </div>
  );
}
