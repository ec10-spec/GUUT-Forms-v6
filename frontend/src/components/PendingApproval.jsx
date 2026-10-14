import Logo from "./Logo.jsx";
import React, { useState } from "react";
import { api, saveUser } from "../api.js";

/** Shown to an employee who signed up with a company code until a company admin decides. */
export default function PendingApproval({ user, onUser, onLogout }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const declined = user.membership?.status === "declined";

  async function recheck() {
    setBusy(true); setError(null);
    try { const { user: u } = await api.me(); saveUser(u); onUser(u); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function individual() {
    if (!declined && !confirm("Drop your request and use GUUT Forms on your own instead?")) return;
    setBusy(true); setError(null);
    try { const { user: u } = await api.continueIndividual(); saveUser(u); onUser(u); } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo variant="horizontal" height={34} className="auth-logo" />
        <h1>{declined ? "Request declined" : "Waiting for approval"}</h1>
        <p className="auth-sub">
          {declined
            ? "Your company admin declined your request to join. You can keep using GUUT Forms on your own."
            : `A company admin${user.pendingCompanyName ? ` at ${user.pendingCompanyName}` : ""} needs to approve your account before you can use the company's forms. We'll email you when they do.`}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="api-key-actions stack">
          {!declined && <button className="primary" disabled={busy} onClick={recheck}>Check again</button>}
          <button className={declined ? "primary" : "secondary"} disabled={busy} onClick={individual}>Use GUUT Forms as an individual instead</button>
          <button className="link-btn" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
