import React, { useEffect, useState } from "react";
import { api, saveSession, saveUser } from "../api.js";
import Logo from "./Logo.jsx";

const TYPES = [
  ["individual", "Individual", "Free. For you, your friends or your class."],
  ["business", "Business", "A shared workspace for your company."],
  ["employee", "Join my company", "Use a company code. Your admin approves you."],
];

/**
 * Sign in or create an account. Opened from a company link (#/join/CODE) it shows the company's name
 * and, once the person is signed in, sends the join request for a company admin to approve.
 */
export default function AuthPage({ onAuth, joinCode = "", initial = {} }) {
  const [mode, setMode] = useState(initial.mode || (joinCode ? "create" : "signin")); // "signin" | "create"
  const [type, setType] = useState(joinCode ? "employee" : initial.type || null); // "individual" | "business" | "employee"
  const [f, setF] = useState({ name: "", email: "", password: "", companyName: "", plan: initial.plan || "starter", joinCode });
  const [plans, setPlans] = useState(null);
  const [joinName, setJoinName] = useState(null);
  const [joinBad, setJoinBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [sentTo, setSentTo] = useState(null); // email we sent a confirmation link to
  const [resent, setResent] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  useEffect(() => { api.plans().then(setPlans).catch(() => {}); }, []);
  useEffect(() => {
    if (!joinCode) return;
    api.joinInfo(joinCode).then((r) => setJoinName(r.companyName)).catch(() => setJoinBad(true));
  }, [joinCode]);

  function go(nextMode, nextType = null, plan) {
    setMode(nextMode); setType(nextType); setError(null);
    if (plan) set({ plan });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null); setErrorCode(null);
    try {
      const res = mode === "signin"
        ? await api.login(f.email, f.password)
        : await api.signup({ type, email: f.email, password: f.password, name: f.name, companyName: f.companyName, plan: f.plan, joinCode: f.joinCode });
      if (res.needsVerification) { setSentTo(res.email); return; }
      saveSession(res);
      let user = res.user;
      // Signed in through a company link: ask to join. An admin approves; failures here are not fatal.
      if (mode === "signin" && joinCode && joinName) {
        try { user = (await api.requestJoin(joinCode)).user; saveUser(user); } catch (err) { setError(err.message); }
      }
      onAuth?.(user);
    } catch (err) {
      setError(err.message);
      setErrorCode(err.code || null);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try { await api.resendVerification(sentTo || f.email); setResent(true); } catch (err) { setError(err.message); }
  }

  const creating = mode === "create";
  const chooser = creating && !type;

  if (sentTo) {
    return (
      <div className="auth-page">
        <div className="auth-center"><div className="auth-side">
        <div className="auth-card">
          <Logo variant="horizontal" height={30} className="auth-logo-sm" />
          <h1>Check your email</h1>
          <p className="auth-sub">
            We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish creating your account. The link works for 24 hours.
          </p>
          {resent && <p className="key-saved-msg">Sent again. Check your inbox and spam folder.</p>}
          {error && <p className="error">{error}</p>}
          <div className="api-key-actions stack">
            <button className="secondary" onClick={resend}>Send the link again</button>
            <button className="link-btn" onClick={() => { setSentTo(null); setResent(false); go("signin"); }}>Back to sign in</button>
          </div>
        </div>
        </div></div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-center">
      <div className="auth-side">
        {!joinCode && <div className="auth-hero"><h1>Describe a form. Publish it. Understand the answers.</h1><p>Build forms in minutes, share them with anyone, and turn responses into charts and plain-language insight.</p></div>}
        <div className="auth-card">
          {joinCode && (
            <div className="join-banner">
              {joinBad ? <strong>This company link is not valid or is no longer accepting members.</strong> : <><span>You are invited to join</span><strong>{joinName || "..."}</strong></>}
            </div>
          )}

          <div className="settings-tabs auth-doors">
            <button type="button" className={!creating ? "active" : ""} onClick={() => go("signin")}>Sign in</button>
            <button type="button" className={creating ? "active" : ""} onClick={() => go("create")}>Create account</button>
          </div>

          {!creating && (
            <>
              <h2 className="auth-title">Sign in</h2>
              
            </>
          )}

          {chooser && (
            <>
              <h2 className="auth-title">Create your account</h2>
              <p className="auth-sub">What are you signing up as?</p>
              <div className="type-cards">
                {TYPES.map(([id, title, desc]) => (
                  <button key={id} type="button" className="type-card" onClick={() => go("create", id)}>
                    <strong>{title}</strong><span>{desc}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {(!creating || type) && (
            <form onSubmit={submit} className="auth-form">
              {creating && (
                <>
                  <h2 className="auth-title">{type === "employee" ? (joinName ? `Join ${joinName}` : "Join your company") : `${TYPES.find((t) => t[0] === type)[1]} account`}</h2>
                  {!joinCode && <button type="button" className="link-btn align-left" onClick={() => go("create")}>Change account type</button>}
                  <label>Your name
                    <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" autoComplete="name" />
                  </label>
                  {type === "business" && (
                    <>
                      <label>Company name
                        <input value={f.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder="Acme Inc." required />
                      </label>
                      <label>Plan
                        <select value={f.plan} onChange={(e) => set({ plan: e.target.value })}>
                          {(plans?.business || [{ id: "starter", name: "Starter", priceLabel: "" }]).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}{p.priceLabel ? `: ${p.priceLabel}` : ""}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {type === "employee" && !joinCode && (
                    <label>Company code
                      <input value={f.joinCode} onChange={(e) => set({ joinCode: e.target.value })} placeholder="ABCD-EFGH" autoComplete="off" required />
                      <span className="field-help">Ask your company admin. They approve your account before you can use the company's forms.</span>
                    </label>
                  )}
                </>
              )}
              <label>Email
                <input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@company.com" autoComplete="email" required />
              </label>
              <label>Password
                <input
                  type="password" value={f.password} onChange={(e) => set({ password: e.target.value })}
                  placeholder={creating ? "At least 8 characters" : "Your password"} autoComplete={creating ? "new-password" : "current-password"} minLength={creating ? 8 : undefined} required
                />
              </label>

              {error && <p className="error">{error}</p>}
              {errorCode === "EMAIL_NOT_VERIFIED" && (
                <button type="button" className="link-btn align-left" onClick={() => { setSentTo(f.email); resend(); }}>Send me a new confirmation link</button>
              )}

              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Please wait..." : !creating ? "Sign in" : type === "employee" ? "Request to join" : "Create account"}
              </button>
            </form>
          )}
        </div>

      </div>
      </div>
    </div>
  );
}
