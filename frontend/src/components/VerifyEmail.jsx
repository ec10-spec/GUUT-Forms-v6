import Logo from "./Logo.jsx";
import React, { useEffect, useRef, useState } from "react";
import { api, saveSession } from "../api.js";

/** Opened from the link in the confirmation email: confirms the address and signs the person in. */
export default function VerifyEmail({ token, onAuth }) {
  const [state, setState] = useState("working"); // working | failed
  const [error, setError] = useState(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // the link is single-use, so only ever call once
    ran.current = true;
    api.verifyEmail(token)
      .then((res) => { saveSession(res); onAuth?.(res.user); })
      .catch((e) => { setError(e.message); setState("failed"); });
  }, [token]);

  async function resend(e) {
    e.preventDefault();
    try { await api.resendVerification(email); setSent(true); } catch (err) { setError(err.message); }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo variant="horizontal" height={30} className="auth-logo" />
        {state === "working" ? (
          <>
            <h1>Confirming your email...</h1>
            <p className="auth-sub">One moment.</p>
          </>
        ) : (
          <>
            <h1>Link not valid</h1>
            <p className="auth-sub">{error}</p>
            {sent ? (
              <p className="key-saved-msg">If that address has an unconfirmed account, a new link is on its way.</p>
            ) : (
              <form className="auth-form" onSubmit={resend}>
                <label>Your email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <button className="primary" type="submit">Send a new link</button>
              </form>
            )}
            <button className="link-btn" onClick={() => { window.location.hash = "/"; }}>Back to sign in</button>
          </>
        )}
      </div>
    </div>
  );
}
