import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { fmtBytes } from "./UsageViews.jsx";

/** Company admin: the code employees sign up with, plus the people waiting for approval. */
export function JoinPanel({ onChanged }) {
  const [j, setJ] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() { try { setJ(await api.companyJoin()); setError(null); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); await load(); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const link = j ? `${window.location.origin}${window.location.pathname}#/join/${j.code}` : "";
  const [copiedLink, setCopiedLink] = useState(false);
  function copy() { navigator.clipboard.writeText(j.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  function copyLink() { navigator.clipboard.writeText(link); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 1500); }

  if (error && !j) return <p className="error">{error}</p>;
  if (!j) return null;
  return (
    <div className="join-panel">
      {error && <p className="error">{error}</p>}
      {j.requests.length > 0 && (
        <div className="team-card">
          <h2>Waiting for your approval ({j.requests.length})</h2>
          {j.requests.map((r) => (
            <div key={r._id} className="people-row">
              <div><strong>{r.name || r.email}</strong><span>{r.email} asked to join</span></div>
              <div className="people-actions">
                <button className="primary small" disabled={busy} onClick={() => run(() => api.companyJoinDecide(r._id, true))}>Approve</button>
                <button className="small" disabled={busy} onClick={() => run(() => api.companyJoinDecide(r._id, false))}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="team-card">
        <h2>Invite people</h2>
        <p className="settings-hint">Share the link. People sign in or create an account, then ask to join. You approve each person under Approvals before they can use your forms.</p>
        <div className="code-row">
          <code className={`join-code link ${j.enabled ? "" : "off"}`}>{link}</code>
          <button className="primary small" onClick={copyLink}>{copiedLink ? "Copied" : "Copy link"}</button>
        </div>
        <p className="settings-hint small">Or give them the code:</p>
        <div className="code-row">
          <code className={`join-code ${j.enabled ? "" : "off"}`}>{j.code}</code>
          <button className="secondary small" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          <button className="small" disabled={busy} onClick={() => { if (confirm("Generate a new code? The current one will stop working.")) run(() => api.companyJoinRegenerate()); }}>New code</button>
          <label className="check-row inline">
            <input type="checkbox" checked={j.enabled} disabled={busy} onChange={(e) => run(() => api.companyJoinEnabled(e.target.checked))} />
          <span>Accepting new requests</span>
        </label>
        </div>
      </div>
    </div>
  );
}

const STATUS = { trialing: "Trial", active: "Active", past_due: "Payment overdue", canceled: "Canceled" };

/** Company admin: plan, status and the tiers. No payment processor yet: a plan change is a request. */
export function Billing() {
  const [b, setB] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  async function load() { try { setB(await api.companyBilling()); } catch (e) { setMsg({ ok: false, text: e.message }); } }
  useEffect(() => { load(); }, []);

  async function request(plan) {
    setBusy(true); setMsg(null);
    try { await api.companyPlanRequest(plan); setMsg({ ok: true, text: "Plan change requested. The platform team will confirm it with you." }); await load(); }
    catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }

  if (!b) return msg ? <p className="error">{msg.text}</p> : <p className="empty-hint">Loading...</p>;
  return (
    <div>
      <div className="stat-row">
        <div className="stat"><strong>{b.planDetails?.name || "No plan"}</strong><span>Current plan</span></div>
        <div className="stat"><strong>{STATUS[b.status] || b.status}</strong><span>Status</span></div>
        <div className="stat"><strong>{b.usage.seats}{b.planDetails?.maxSeats ? ` / ${b.planDetails.maxSeats}` : ""}</strong><span>Team members</span></div>
        <div className="stat"><strong>{b.usage.forms}</strong><span>Forms</span></div>
        <div className="stat">
          <strong>{fmtBytes(b.usage.storageBytes)}{b.usage.storageLimitBytes ? ` / ${fmtBytes(b.usage.storageLimitBytes)}` : ""}</strong>
          <span>{b.usage.ownDatabase ? "Stored (your database)" : "Hosted storage"}</span>
        </div>
      </div>
      {msg && <p className={msg.ok ? "key-saved-msg" : "error"}>{msg.text}</p>}
      <div className="pricing-grid">
        {b.plans.map((p) => (
          <div key={p.id} className={`price-card ${p.id === b.plan ? "current" : ""}`}>
            <h3>{p.name}</h3>
            <div className="price">{p.priceLabel}</div>
            <ul>{p.features.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="price-card-foot">{p.id === b.plan ? <span className="access-badge">Current plan</span>
              : p.id === b.requestedPlan ? <span className="access-badge subtle">Change requested</span>
              : <button className="secondary small" disabled={busy} onClick={() => request(p.id)}>Request this plan</button>}</div>
          </div>
        ))}
      </div>
      <p className="settings-hint small pricing-note">Online payment is not set up yet. Plan changes are confirmed by the platform team. Prices are provisional.</p>
    </div>
  );
}
