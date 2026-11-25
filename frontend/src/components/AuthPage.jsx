import React, { useEffect, useState } from "react";
import { api, saveSession, saveUser } from "../api.js";
import Logo from "./Logo.jsx";
import { track } from "../lib/funnel.js";

/**
 * "Continue with Google / Microsoft / Apple". Only providers set up on the server are shown. For a new
 * account the chosen account type travels with the sign-in, so a business or a join request works the same
 * as with email. Provider marks: drop each provider's official artwork (from their brand guidelines) into
 * frontend/public/brand/google.svg, microsoft.svg and apple.svg and it shows on the button; missing files are skipped.
 */
function OAuthButtons({ providers, creating, type, f, joinCode, onError }) {
  const enabled = (providers || []).filter((p) => p.enabled);
  if (!enabled.length) return null;
  function go(id) {
    if (creating && type === "business" && String(f.companyName || "").trim().length < 2) { onError("Enter your company name first."); return; }
    if (creating && type === "employee" && !String(f.joinCode || joinCode || "").trim()) { onError("Enter your company code first."); return; }
    const extra = creating ? { type, companyName: type === "business" ? f.companyName : "", plan: type === "business" ? f.plan : "", joinCode: type === "employee" ? f.joinCode || joinCode : "" } : (joinCode ? { joinCode } : {});
    try { if (joinCode) sessionStorage.setItem("guut_oauth_join", joinCode); else sessionStorage.removeItem("guut_oauth_join"); } catch { /* ignore */ }
    window.location.href = api.oauthStartUrl(id, extra);
  }
  return (
    <div className="oauth-block">
      {enabled.map((p) => (
        <button key={p.id} type="button" className={`oauth-btn oauth-${p.id}`} onClick={() => go(p.id)}>
          <img className="oauth-mark" src={`/brand/${p.id}.svg`} alt="" aria-hidden="true" onError={(e) => e.currentTarget.remove()} />
          Continue with {p.label}
        </button>
      ))}
      <div className="oauth-or"><span>or use your email</span></div>
    </div>
  );
}

/**
 * Sign in or create an account. Opened from a company link (#/join/CODE) it shows the company's name
 * and, once the person is signed in, sends the join request for a company admin to approve.
 */
export default function AuthPage({ onAuth, joinCode = "", initial = {} }) {
  const [mode, setMode] = useState(initial.mode || (joinCode ? "create" : "signin")); // "signin" | "create"
  // Most people are signing up for themselves: start there. Business and "join my company" are one link away.
  const [type, setType] = useState(joinCode ? "employee" : initial.type || "individual"); // "individual" | "business" | "employee"
  const [f, setF] = useState(() => {
    let email = "";
    try { email = sessionStorage.getItem("guut_auth_email") || ""; } catch { /* storage blocked */ }
    return { name: "", email, password: "", companyName: "", plan: initial.plan || "starter", joinCode };
  });
  const [showPw, setShowPw] = useState(false);
  const [ignoreJoin, setIgnoreJoin] = useState(false); // an invalid company link: continue as a normal sign-in
  const [plans, setPlans] = useState(null);
  const [providers, setProviders] = useState(null);
  const [joinName, setJoinName] = useState(null);
  const [joinBad, setJoinBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [sentTo, setSentTo] = useState(null); // email we sent a confirmation link to
  const [resent, setResent] = useState(false);
  const set = (patch) => {
    setF((x) => ({ ...x, ...patch }));
    // The email carries over between the Sign in and Create account tabs, and to "Forgot password".
    if (patch.email !== undefined) { try { sessionStorage.setItem("guut_auth_email", patch.email); } catch { /* ignore */ } }
  };

  useEffect(() => { api.plans().then(setPlans).catch(() => {}); api.oauthProviders().then(setProviders).catch(() => setProviders([])); }, []);
  // A failed Google / Microsoft / Apple sign-in comes back here with a message.
  useEffect(() => { if (initial.error) setError(initial.error); }, [initial.error]);
  useEffect(() => {
    if (!joinCode) return;
    api.joinInfo(joinCode).then((r) => setJoinName(r.companyName)).catch(() => setJoinBad(true));
  }, [joinCode]);

  function go(nextMode, nextType = "individual", plan) {
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
  useEffect(() => { if (creating) track("signup_started"); }, [creating]);
  const badJoin = joinCode && joinBad && !ignoreJoin;

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
          <Logo variant="horizontal" height={30} className="auth-card-logo" />
          {badJoin && (
            <>
              <div className="join-banner bad"><strong>This company link is not valid</strong><span>It may have been replaced, or the company is no longer accepting members. Ask the company admin for a new link.</span></div>
              <div className="api-key-actions stack">
                <button className="primary" type="button" onClick={() => { setIgnoreJoin(true); go("signin"); }}>Sign in</button>
                <button className="secondary" type="button" onClick={() => { setIgnoreJoin(true); go("create", "individual"); }}>Create an individual account</button>
              </div>
            </>
          )}
          {joinCode && !joinBad && (
            <div className="join-banner"><span>You are invited to join</span><strong>{joinName || "..."}</strong></div>
          )}

          {!badJoin && <>
          <div className="settings-tabs auth-doors">
            <button type="button" className={!creating ? "active" : ""} onClick={() => go("signin")}>Sign in</button>
            <button type="button" className={creating ? "active" : ""} onClick={() => go("create")}>Create account</button>
          </div>

          {!creating && (
            <>
              <h2 className="auth-title spaced">Welcome back</h2>
              <p className="auth-sub">Sign in to continue.</p>
              <OAuthButtons providers={providers} creating={false} f={f} joinCode={joinName ? joinCode : ""} onError={setError} />
            </>
          )}

          {(!creating || type) && (
            <form onSubmit={submit} className="auth-form">
              {creating && (
                <>
                  <h2 className="auth-title">{type === "employee" ? (joinName ? `Join ${joinName}` : "Join your company") : type === "business" ? "Create a business account" : "Create your free account"}</h2>
                  {type === "individual" && <p className="auth-sub">Free for individuals. No credit card.</p>}
                  {type === "business" && (
                    <>
                      <label>Company name
                        <input value={f.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder="Acme Inc." required autoComplete="organization" />
                      </label>
                      <label>Plan
                        <select value={f.plan} onChange={(e) => set({ plan: e.target.value })}>
                          {(plans?.business || [{ id: "starter", name: "Teams", priceLabel: "" }]).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}{p.priceLabel ? `: ${p.priceLabel}` : ""}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {type === "employee" && (!joinCode || ignoreJoin) && (
                    <label>Company code
                      <input value={f.joinCode} onChange={(e) => set({ joinCode: e.target.value })} placeholder="ABCD-EFGH" autoComplete="off" required />
                      <span className="field-help">Ask your company admin. They approve your account before you can use the company's forms.</span>
                    </label>
                  )}
                  <OAuthButtons providers={providers} creating type={type} f={f} joinCode={joinCode} onError={setError} />
                </>
              )}
              <label>Email
                <input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@company.com" autoComplete="email" required />
              </label>
              <label>Password
                <span className="password-row">
                  <input
                    type={showPw ? "text" : "password"} value={f.password} onChange={(e) => set({ password: e.target.value })}
                    placeholder={creating ? "At least 8 characters" : "Your password"} autoComplete={creating ? "new-password" : "current-password"} minLength={creating ? 8 : undefined} required
                  />
                  <button type="button" className="link-btn show-pw" onClick={() => setShowPw((v) => !v)} aria-pressed={showPw} aria-label={showPw ? "Hide password" : "Show password"}>{showPw ? "Hide" : "Show"}</button>
                </span>
              </label>
              {creating && (
                <label><span>Your name <span className="optional">(optional)</span></span>
                  <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="How you appear to teammates" autoComplete="name" />
                </label>
              )}
              {!creating && <a className="link-btn align-left forgot-link" href="#/forgot">Forgot password?</a>}

              {error && <p className="error">{error}</p>}
              {errorCode === "EMAIL_NOT_VERIFIED" && (
                <button type="button" className="link-btn align-left" onClick={() => { setSentTo(f.email); resend(); }}>Send me a new confirmation link</button>
              )}

              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Please wait..." : !creating ? "Sign in" : type === "employee" ? "Request to join" : "Create account"}
              </button>
              {creating && <p className="legal-note">By creating an account you agree to how we handle data in our <a href="#/privacy">Privacy policy</a>.</p>}
              {creating && (!joinCode || ignoreJoin) && (
                <div className="auth-alt">
                  {type !== "individual" && <button type="button" className="link-btn" onClick={() => go("create", "individual")}>Back to a free personal account</button>}
                  {type !== "business" && <span>Setting up for a company? <button type="button" className="link-btn" onClick={() => go("create", "business")}>Create a business account</button></span>}
                  {type !== "employee" && <span>Have a company code? <button type="button" className="link-btn" onClick={() => go("create", "employee")}>Join your company</button></span>}
                </div>
              )}
            </form>
          )}
          </>}
        </div>

      </div>
      </div>
    </div>
  );
}
