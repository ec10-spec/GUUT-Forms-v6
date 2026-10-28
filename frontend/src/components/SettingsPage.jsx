import React, { useState } from "react";
import { api, saveUser } from "../api.js";
import DatabaseLinkForm from "./DatabaseLinkForm.jsx";
import NotificationSettings from "./NotificationSettings.jsx";
import { MyUsage } from "./UsageViews.jsx";

const THEME_OPTIONS = [
  { value: "system", label: "Match system", hint: "Follows your OS light/dark setting" },
  { value: "light", label: "Light", hint: "" },
  { value: "dark", label: "Dark", hint: "" },
];

const PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)", keyField: "anthropicKey", modelField: "anthropicModel", hasField: "hasAnthropicKey",
    placeholder: "sk-ant-...", modelPlaceholder: "claude-sonnet-4-6", where: "console.anthropic.com",
    check: (k) => (k.startsWith("sk-ant-") ? null : "Claude keys start with sk-ant-. Check that you copied the whole key."),
  },
  openai: {
    label: "ChatGPT (OpenAI)", keyField: "openaiKey", modelField: "openaiModel", hasField: "hasOpenaiKey",
    placeholder: "sk-...", modelPlaceholder: "gpt-4o", where: "platform.openai.com",
    check: (k) => (k.startsWith("sk-ant-") ? "That is a Claude key. Choose Claude (Anthropic) above, or paste an OpenAI key." : k.startsWith("sk-") ? null : "OpenAI keys start with sk-. Check that you copied the whole key."),
  },
};

/**
 * Settings for every account: appearance, the user's own AI provider + API key
 * (Claude or ChatGPT, bring-your-own), and account/password. Company admins also
 * get a Database tab to paste their company's database link.
 */
export default function SettingsPage({ user, onUserUpdated, initialTab }) {
  const [tab, setTab] = useState(initialTab || "appearance");
  // Other pages can open a specific tab (for example "Go to Settings, AI").
  React.useEffect(() => {
    const on = (e) => setTab(e.detail);
    window.addEventListener("guut:settings-tab", on);
    return () => window.removeEventListener("guut:settings-tab", on);
  }, []);
  const ai = user.ai || { provider: "anthropic" };

  const [theme, setTheme] = useState(user.settings?.theme || "system");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(ai[PROVIDERS[ai.provider]?.modelField] || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [pw, setPw] = useState({ current: "", next: "" });

  const provider = PROVIDERS[ai.provider] ? ai.provider : "anthropic";
  const P = PROVIDERS[provider];

  async function save(payload, okText) {
    setBusy(true);
    setMsg(null);
    try {
      const { user: updated } = await api.updateSettings(payload);
      saveUser(updated);
      onUserUpdated(updated);
      if (okText) setMsg({ ok: true, text: okText });
      return updated;
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function chooseProvider(next) {
    setApiKey("");
    setModel(user.ai?.[PROVIDERS[next].modelField] || "");
    await save({ ai: { provider: next } });
  }

  const keyProblem = apiKey.trim() ? P.check(apiKey.trim()) : null;

  async function saveKey(e) {
    e.preventDefault();
    if (keyProblem) { setMsg({ ok: false, text: keyProblem }); return; }
    const ai = { [P.modelField]: model };
    if (apiKey.trim()) ai[P.keyField] = apiKey;
    const updated = await save({ ai }, apiKey.trim() ? "Saved." : "Model saved.");
    if (updated) setApiKey("");
  }

  async function removeKey() {
    await save({ ai: { [P.keyField]: "" } }, "Key removed.");
  }

  async function testKey() {
    setBusy(true);
    setMsg(null);
    try {
      // A key typed in the box is tested before it is saved; otherwise the saved key is tested.
      const unsaved = apiKey.trim() ? { provider, apiKey: apiKey.trim(), model } : null;
      if (unsaved && keyProblem) { setMsg({ ok: false, text: keyProblem }); return; }
      const r = await api.testAi(unsaved);
      setMsg({ ok: true, text: `Connected. ${PROVIDERS[r.provider].label} answered using ${r.model}.${unsaved ? " Press Save to keep this key." : ""}` });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "" });
      setMsg({ ok: true, text: "Password changed. You were signed out on your other devices." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const switchTab = (t) => { setTab(t); setMsg(null); };
  const msgEl = msg && <p className={msg.ok ? "key-saved-msg" : "error"}>{msg.text}</p>;

  return (
    <div className="settings-page">
      <span className="hero-eyebrow"><span className="dot" /> Account</span>
      <h1>Settings</h1>

      <div className="settings-tabs">
        <button className={tab === "appearance" ? "active" : ""} onClick={() => switchTab("appearance")}>Appearance</button>
        <button className={tab === "ai" ? "active" : ""} onClick={() => switchTab("ai")}>AI</button>
        <button className={tab === "usage" ? "active" : ""} onClick={() => switchTab("usage")}>Usage</button>
        <button className={tab === "notifications" ? "active" : ""} onClick={() => switchTab("notifications")}>Notifications</button>
        {user.role === "admin" && (
          <button className={tab === "database" ? "active" : ""} onClick={() => switchTab("database")}>Database</button>
        )}
        <button className={tab === "account" ? "active" : ""} onClick={() => switchTab("account")}>Account</button>
      </div>

      {tab === "appearance" && (
        <div className="settings-panel">
          <h2>Appearance</h2>
          <p className="settings-hint">Choose how GUUT Forms looks on this account.</p>
          <div className="theme-options">
            {THEME_OPTIONS.map((opt) => (
              <label key={opt.value} className={`theme-option ${theme === opt.value ? "selected" : ""}`}>
                <input
                  type="radio" name="theme" checked={theme === opt.value} disabled={busy}
                  onChange={() => { setTheme(opt.value); save({ theme: opt.value }); }}
                />
                <span>
                  <strong>{opt.label}</strong>
                  {opt.hint && <span className="theme-option-hint">{opt.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === "ai" && (
        <div className="settings-panel">
          <h2>AI provider</h2>
          <p className="settings-hint">
            AI form generation and the response analysis assistant use your own API key and your own provider billing. Pick Claude or ChatGPT,
            paste a key, press Test connection to check it, then Save. You can save both and switch any time. Without a key, your free AI credit is used (when the platform offers it). Keys are personal: nobody else in your organisation uses yours.
          </p>

          <div className="theme-options provider-options">
            {Object.entries(PROVIDERS).map(([id, p]) => (
              <label key={id} className={`theme-option ${provider === id ? "selected" : ""}`}>
                <input type="radio" name="provider" checked={provider === id} disabled={busy} onChange={() => chooseProvider(id)} />
                <span>
                  <strong>{p.label}</strong>
                  <span className="theme-option-hint">
                    <span className={`key-dot ${ai[p.hasField] ? "key-dot-on" : ""}`} />{" "}
                    {ai[p.hasField] ? `Key saved (ends in ${ai[id === "openai" ? "openaiHint" : "anthropicHint"] || "..."})` : "No key yet"}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <form onSubmit={saveKey} className="api-key-form">
            <label>
              {P.label} API key
              <input
                type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setMsg(null); }} aria-invalid={!!keyProblem || undefined}
                placeholder={ai[P.hasField] ? "•••••••• (saved, paste a new one to replace)" : P.placeholder} autoComplete="off"
              />
            </label>
            <label>
              Model (optional)
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={`Default: ${P.modelPlaceholder}`} autoComplete="off" />
            </label>
            <p className="settings-hint small">
              Get a key at <strong>{P.where}</strong>. It's encrypted before it's stored and is never shown again.
              Leave the model blank to use the default; type any model name your account can use to override it.
            </p>
            {keyProblem && !msg && <p className="error">{keyProblem}</p>}
            {msgEl}
            <div className="api-key-actions">
              <button className="primary" type="submit" disabled={busy || !!keyProblem || (!apiKey.trim() && model === (user.ai?.[P.modelField] || ""))}>
                {busy ? "Working..." : "Save"}
              </button>
              <button type="button" className="secondary" disabled={busy || !!keyProblem || (!ai[P.hasField] && !apiKey.trim())} onClick={testKey}>Test connection</button>
              {ai[P.hasField] && <button type="button" className="danger" disabled={busy} onClick={removeKey}>Remove key</button>}
            </div>
          </form>
        </div>
      )}

      {tab === "usage" && <MyUsage />}

      {tab === "notifications" && <NotificationSettings user={user} onUserUpdated={onUserUpdated} />}

      {tab === "database" && user.role === "admin" && <DatabaseLinkForm onUserUpdated={onUserUpdated} />}

      {tab === "account" && (
        <div className="settings-panel">
          <h2>Account</h2>
          <dl className="account-facts">
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Account type</dt><dd>{user.role === "superadmin" ? "Platform team" : user.company?.type === "individual" ? "Individual" : user.role === "admin" ? "Business admin" : "Business member"}</dd>
            <dt>{user.company?.type === "individual" ? "Workspace" : "Company"}</dt><dd>{user.company?.name || "-"}</dd>
            <dt>Form data stored in</dt>
            <dd>
              {user.company?.dbMode === "custom"
                ? "Your company's own database"
                : "Hosted by GUUT"}
            </dd>
          </dl>

          <h2 className="settings-subhead">Change password</h2>
          <p className="settings-hint">Changing your password signs you out on every other device.</p>
          <form onSubmit={changePassword} className="api-key-form">
            <label>Current password
              <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required />
            </label>
            <label>New password (8+ characters)
              <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={8} required />
            </label>
            {msgEl}
            <div className="api-key-actions">
              <button className="primary" type="submit" disabled={busy}>Update password</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
