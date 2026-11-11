import React, { useEffect, useState } from "react";
import { api, saveUser } from "../api.js";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "-");

/**
 * "Paste your database link" for a company admin. Forms and responses are
 * stored ONLY in this database. Test first, then Save & connect.
 */
export default function DatabaseLinkForm({ onUserUpdated }) {
  const [company, setCompany] = useState(null);
  const [uri, setUri] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => api.companyInfo().then(setCompany).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []);

  async function run(fn, okText) {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: typeof okText === "function" ? okText(r) : okText }); return r; }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  async function save() {
    const r = await run(
      () => api.companyLinkDb(uri.trim(), migrate),
      (r) => `Connected to ${r.company.dbHost} / ${r.company.dbName}.${r.migrated ? ` Copied ${r.migrated.forms} form(s) and ${r.migrated.submissions} response(s).` : ""}`
    );
    if (r) {
      setUri("");
      await load();
      const { user } = await api.me();
      saveUser(user);
      onUserUpdated?.(user);
    }
  }

  const linked = company?.dbMode === "custom";

  return (
    <div className="settings-panel">
      <h2>Your database</h2>
      <p className="settings-hint">
        Optional. Until you connect one, your forms and responses are <strong>hosted by us</strong>. Connect <strong>your own MongoDB database</strong>{" "}
        to keep everything your company collects on your own infrastructure.
      </p>

      {company && (
        <p className="key-status">
          <span className={`key-dot ${linked ? "key-dot-on" : ""}`} />
          {linked ? `Connected: ${company.dbHost} / ${company.dbName} (verified ${fmt(company.dbCheckedAt)})` : "Using GUUT hosted storage."}
        </p>
      )}

      <div className="api-key-form">
        <label>
          {linked ? "Replace with a different database link" : "Database link"}
          <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="mongodb+srv://username:password@cluster.mongodb.net/" autoComplete="off" spellCheck={false} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={migrate} onChange={(e) => setMigrate(e.target.checked)} />
          <span>{linked
            ? "Copy my existing forms and responses into the new database (the old ones are left untouched)"
            : "Move my existing forms and responses into this database (removed from our hosted storage once the copy is verified)"}</span>
        </label>
        {msg && <p className={msg.ok ? "key-saved-msg" : "error"}>{msg.text}</p>}
        <div className="api-key-actions">
          <button className="secondary" disabled={busy || !uri.trim()} onClick={() => run(() => api.companyTestDb(uri.trim()), (r) => `Works. Reached ${r.host} and can read and write to "${r.dbName}".`)}>Test link</button>
          <button className="primary" disabled={busy || !uri.trim()} onClick={save}>{busy ? "Working..." : "Save & connect"}</button>
          {linked && <button className="secondary" disabled={busy} onClick={() => run(async () => { const r = await api.companyCheckDb(); if (!r.ok) throw new Error(r.error); return r; }, "Still connected and working.")}>Check connection</button>}
        </div>
      </div>

      <details className="db-help">
        <summary>Where do I get this link? (free MongoDB Atlas, 2 minutes)</summary>
        <ol>
          <li>Sign up at <strong>mongodb.com/atlas</strong> and create a free <strong>M0</strong> cluster.</li>
          <li><strong>Database Access</strong> → Add user → pick a username and password (read and write to any database).</li>
          <li><strong>Network Access</strong> → Add IP address → <strong>Allow access from anywhere</strong> (0.0.0.0/0).</li>
          <li><strong>Database</strong> → Connect → Drivers → copy the link.</li>
          <li>Replace <code>&lt;password&gt;</code> with your user's password, paste it above, press <strong>Test link</strong>, then <strong>Save &amp; connect</strong>.</li>
        </ol>
        <p className="settings-hint small">Already have your own MongoDB server? Paste its link instead. If it has no database name, we create one called <code>guut_forms</code>.</p>
      </details>
    </div>
  );
}
