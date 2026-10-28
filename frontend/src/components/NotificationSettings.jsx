import React, { useState } from "react";
import { api, saveUser } from "../api.js";

/**
 * Settings > Notifications. Applies to the forms this person created. Company admins
 * also get the "a form was created" alert.
 */
export default function NotificationSettings({ user, onUserUpdated }) {
  const n = user.notifications || {};
  const r = n.responses || {};
  const [s, setS] = useState({
    enabled: r.enabled !== false, mode: r.mode || "every", hours: r.hours || 24, count: r.count || 10,
    formCreated: n.formCreated !== false, accessRequests: n.accessRequests !== false, sharedResponses: n.sharedResponses === true,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (patch) => { setS({ ...s, ...patch }); setMsg(null); };

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const { user: updated } = await api.updateSettings({
        notifications: {
          formCreated: s.formCreated, accessRequests: s.accessRequests, sharedResponses: s.sharedResponses,
          responses: { enabled: s.enabled, mode: s.mode, hours: Number(s.hours), count: Number(s.count) },
        },
      });
      saveUser(updated); onUserUpdated(updated);
      setMsg({ ok: true, text: "Notification settings saved." });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true); setMsg(null);
    try { const t = await api.testEmail(); setMsg({ ok: true, text: `Test email sent to ${t.to}.` }); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="settings-panel">
      <h2>Email notifications</h2>
      <p className="settings-hint">
        Emails say how many responses arrived and link to the form. They never contain what respondents wrote.
      </p>
      {!user.emailConfigured && (
        <div className="db-banner">
          <strong>Email isn't set up on this server yet.</strong> Your choices are saved and will apply as soon as the platform team enables email.
        </div>
      )}

      <form onSubmit={save} className="api-key-form">
        <label className="check-row">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>Email me about new responses to forms I created</span>
        </label>

        <fieldset className="notif-modes" disabled={!s.enabled}>
          <legend>How often</legend>
          <label className="check-row">
            <input type="radio" name="mode" checked={s.mode === "every"} onChange={() => set({ mode: "every" })} />
          <span>After every response</span>
        </label>
          <label className="check-row">
            <input type="radio" name="mode" checked={s.mode === "hours"} onChange={() => set({ mode: "hours" })} />
            One summary every
            <input className="num-inline" type="number" min={1} max={168} value={s.hours} disabled={s.mode !== "hours"} onChange={(e) => set({ hours: e.target.value })} />
            hours (only if there is something new)
          </label>
          <label className="check-row">
            <input type="radio" name="mode" checked={s.mode === "count"} onChange={() => set({ mode: "count" })} />
            One email after every
            <input className="num-inline" type="number" min={2} max={1000} value={s.count} disabled={s.mode !== "count"} onChange={(e) => set({ count: e.target.value })} />
            responses
          </label>
        </fieldset>

        {user.role === "admin" && (
          <label className="check-row">
            <input type="checkbox" checked={s.formCreated} onChange={(e) => set({ formCreated: e.target.checked })} />
          <span>As a company admin, email me when someone in my company creates a form</span>
        </label>
        )}
        <label className="check-row">
          <input type="checkbox" checked={s.sharedResponses} onChange={(e) => set({ sharedResponses: e.target.checked })} />
          <span>Also email me about new responses on forms that others share with me or my teams (uses the settings above)</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.accessRequests} onChange={(e) => set({ accessRequests: e.target.checked })} />
          <span>Email me when a teammate asks for access to one of my forms</span>
        </label>

        {msg && <p className={msg.ok ? "key-saved-msg" : "error"}>{msg.text}</p>}
        <div className="api-key-actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? "Working..." : "Save"}</button>
          <button type="button" className="secondary" disabled={busy || !user.emailConfigured} onClick={sendTest}>Send test email</button>
        </div>
      </form>
    </div>
  );
}
