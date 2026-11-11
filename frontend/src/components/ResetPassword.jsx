import React, { useState } from "react";
import { api, saveSession } from "../api.js";
import Logo from "./Logo.jsx";

/**
 * "Forgot password". Without a token: ask for the email and send a reset link. With a token (the link
 * from that email): choose a new password, which also signs out every other device.
 */
export default function ResetPassword({ token, onAuth }) {
  const [email, setEmail] = useState(() => { try { return sessionStorage.getItem("guut_auth_email") || ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  async function request(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { const r = await api.forgotPassword(email.trim()); setSent(r); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function reset(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.resetPassword(token, password);
      saveSession(r);
      window.history.replaceState(null, "", `${window.location.pathname}#/`);
      onAuth?.(r.user);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="auth-page"><div className="auth-center"><div className="auth-side"><div className="auth-card">
      <Logo variant="horizontal" height={30} className="auth-card-logo" />
      {token ? (
        <form onSubmit={reset} className="auth-form">
          <h2 className="auth-title">Choose a new password</h2>
          <p className="auth-sub">You'll be signed in, and signed out on every other device.</p>
          <label>New password
            <span className="password-row">
              <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters" required />
              <button type="button" className="link-btn show-pw" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
            </span>
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit" disabled={busy || password.length < 8}>{busy ? "Please wait..." : "Save new password"}</button>
          <a className="link-btn align-left" href="#/forgot">Send a new link</a>
        </form>
      ) : sent ? (
        <>
          <h2 className="auth-title">Check your email</h2>
          <p className="auth-sub">If an account uses <strong>{email}</strong>, we sent it a link to reset the password. The link works for 1 hour.</p>
          {!sent.emailConfigured && <p className="db-banner">Email isn't set up on this server yet, so the link can't be delivered. Ask the platform team or your company admin to reset your password.</p>}
          <a className="link-btn align-left" href="#/">Back to sign in</a>
        </>
      ) : (
        <form onSubmit={request} className="auth-form">
          <h2 className="auth-title">Reset your password</h2>
          <p className="auth-sub">Enter your account email and we'll send you a link to choose a new password.</p>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" required />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit" disabled={busy || !email.trim()}>{busy ? "Sending..." : "Send reset link"}</button>
          <a className="link-btn align-left" href="#/">Back to sign in</a>
        </form>
      )}
    </div></div></div></div>
  );
}
