import React, { useEffect, useRef, useState } from "react";
import Home from "./components/Home.jsx";
import FormBuilder from "./components/FormBuilder.jsx";
import FormRenderer from "./components/FormRenderer.jsx";
import AboutPage from "./components/AboutPage.jsx";
import AuthPage from "./components/AuthPage.jsx";
import ExplorePage from "./components/ExplorePage.jsx";
import AdminPage from "./components/AdminPage.jsx";
import ReportWidget from "./components/ReportWidget.jsx";
import SettingsPage from "./components/SettingsPage.jsx";
import Sidebar from "./components/Sidebar.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import Logo from "./components/Logo.jsx";
import Icon from "./components/Icon.jsx";
import PendingApproval from "./components/PendingApproval.jsx";
import VerifyEmail from "./components/VerifyEmail.jsx";
import TeamsPage from "./components/TeamsPage.jsx";
import PublicBar from "./components/PublicBar.jsx";
import PricingPage from "./components/PricingPage.jsx";
import ApprovalsPage from "./components/ApprovalsPage.jsx";
import ResetPassword from "./components/ResetPassword.jsx";
import { api, getUser, getToken, saveUser, clearSession } from "./api.js";
import { confirmLeave } from "./lib/navGuard.js";

/** Parses the hash into a route. Real routes so browser back/forward work. */
function parseHash(hash) {
  const h = hash.replace(/^#/, "") || "/";
  if (h === "/") return { name: "home" };
  if (h === "/about") return { name: "about" };
  if (h === "/explore") return { name: "explore" };
  if (h === "/admin" || h === "/reports") return { name: "admin" };
  if (h === "/settings") return { name: "settings" };
  const settingsTab = h.match(/^\/settings\/(appearance|ai|usage|notifications|database|account)$/);
  if (settingsTab) return { name: "settings", tab: settingsTab[1] };
  if (h === "/teams") return { name: "teams" };
  if (h === "/pricing") return { name: "pricing" };
  if (h === "/approvals") return { name: "approvals" };
  const joinMatch = h.match(/^\/join\/([A-Za-z0-9-]{4,24})$/);
  if (joinMatch) return { name: "join", code: joinMatch[1] };
  if (h === "/new") return { name: "new" };
  const resetMatch = h.match(/^\/reset\?token=([A-Za-z0-9_-]+)$/);
  if (resetMatch) return { name: "reset", token: resetMatch[1] };
  if (h === "/forgot") return { name: "forgot" };
  const verifyMatch = h.match(/^\/verify\?token=([A-Za-z0-9_-]+)$/);
  if (verifyMatch) return { name: "verify", token: verifyMatch[1] };
  const editMatch = h.match(/^\/edit\/([a-fA-F0-9]+)$/);
  if (editMatch) return { name: "edit", id: editMatch[1] };
  const publicMatch = h.match(/^\/f\/([^/?#]+)$/);
  if (publicMatch) return { name: "public", id: publicMatch[1] };
  return { name: "home" };
}

function navigate(hash) {
  window.location.hash = hash;
}

/** Applies the effective (light/dark) theme to the document, resolving "system". */
function applyThemeToDocument(theme) {
  const effective =
    theme === "system" || !theme
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
  document.documentElement.dataset.theme = effective;
}

/** Opened from a company's share link by someone who is already signed in. */
function JoinCompany({ code, user, onUser, onDone }) {
  const [name, setName] = useState(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { api.joinInfo(code).then((r) => setName(r.companyName)).catch(() => setBad(true)); }, [code]);
  async function join() {
    setBusy(true); setError(null);
    try { const { user: u } = await api.requestJoin(code); saveUser(u); onUser(u); onDone(); } catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <div className="auth-page"><div className="auth-center"><div className="auth-side"><div className="auth-card">
      {bad ? (
        <>
          <h2 className="auth-title">This company link is not valid</h2>
          <p className="auth-sub">It may have been replaced, or the company is no longer accepting members. Ask the company admin for a new link.</p>
          <button className="primary" onClick={onDone}>Go to your forms</button>
        </>
      ) : (
        <>
          <div className="join-banner"><span>You are invited to join</span><strong>{name || "..."}</strong></div>
          <p className="auth-sub">You are signed in as {user.email}. A company admin will approve your request.</p>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy || !name} onClick={join}>{busy ? "Please wait..." : "Request to join"}</button>
        </>
      )}
      {!bad && <button className="link-btn" onClick={onDone}>Not now</button>}
    </div></div></div></div>
  );
}

/** Shown for a link to a form that doesn't exist (or isn't published). */
function FormNotFound({ message }) {
  return (
    <div className="public-page">
      <div className="not-found">
        <Logo variant="horizontal" height={30} />
        <h1>{message === "Form not found" || !message ? "This form isn't available" : message}</h1>
        <p>The link may be mistyped, or the form was unpublished or deleted. Check with the person who sent it.</p>
        <a className="primary btn-link solid" href="#/explore">Go to GUUT Forms</a>
      </div>
      <ReportWidget />
    </div>
  );
}

function PublicFormPage({ id, user, onSaveTemplate }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!/^[a-f\d]{24}$/i.test(id)) { setError("Form not found"); return; }
    api.getForm(id).then(setForm).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { if (form?.title) document.title = `${form.title} | GUUT Forms`; return () => { document.title = "GUUT Forms"; }; }, [form?.title]);
  // Paint the owner's background behind everything, including the scrollbar gutter.
  useEffect(() => {
    const bg = form?.theme?.backgroundColor;
    if (!bg) return;
    document.body.style.background = bg;
    return () => { document.body.style.background = ""; };
  }, [form?.theme?.backgroundColor]);

  async function handleSaveTemplate() {
    setSaving(true);
    setSaveError(null);
    try {
      const copy = await api.duplicateForm(id);
      setSaved(true);
      onSaveTemplate(copy);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <FormNotFound message={error} />;
  if (!form) return <div className="public-page"><p className="public-loading">Loading...</p></div>;
  // The owner's background covers the whole page, not just a band around the card.
  return (
    <div className="public-page" style={{ background: form.theme?.backgroundColor || "#f6f7fb" }}>
      <div className="app-shell public-form-shell">
        {user && (
          <div className="save-template-bar">
            <button className="secondary small" disabled={saving || saved} onClick={handleSaveTemplate}>
              {saved ? "Saved to your forms" : saving ? "Saving..." : "Save as template"}
            </button>
            {saveError && <span className="error">{saveError}</span>}
          </div>
        )}
        <FormRenderer form={form} fullPage hideBranding={!!form.hideBranding} />
        {!form.hideBranding && (
          <div className="public-foot">
            <a href="/" aria-label="Made with GUUT Forms">
              <Logo variant="mark" height={18} /> Made with GUUT Forms
            </a>
          </div>
        )}
      </div>
      <ReportWidget />
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  const [user, setUser] = useState(() => getUser());
  const [activeForm, setActiveForm] = useState(null);
  const [loadingActiveForm, setLoadingActiveForm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authInitial, setAuthInitial] = useState({});
  const [approvalCount, setApprovalCount] = useState(0);
  const pendingDraft = useRef(null); // unsaved draft for the "/new" route, not URL-addressable

  // Every in-app link changes the hash. If the builder has unsaved changes, ask first; staying puts the
  // previous address back without reloading anything.
  const lastHash = useRef(window.location.hash);
  useEffect(() => {
    const onHashChange = () => {
      if (!confirmLeave()) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${lastHash.current || "#/"}`);
        return;
      }
      lastHash.current = window.location.hash;
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Validate/refresh the stored session on load.
  useEffect(() => {
    if (getToken()) {
      api.me().then(({ user }) => { saveUser(user); setUser(user); })
        .catch(() => { clearSession(); setUser(null); });
    }
  }, []);

  // Company admins see how many decisions are waiting.
  useEffect(() => {
    if (user?.company?.type === "business" && user.role === "admin" && user.companyId) {
      api.approvals().then((d) => setApprovalCount(d.total)).catch(() => {});
    } else setApprovalCount(0);
  }, [user?._id, route.name]);

  // A rejected token anywhere in the app ends the session cleanly.
  useEffect(() => {
    const onExpired = () => { clearSession(); setUser(null); };
    window.addEventListener("guut:session-expired", onExpired);
    return () => window.removeEventListener("guut:session-expired", onExpired);
  }, []);

  // Apply the account's theme preference (or the OS default pre-login). Public forms always render in the
  // owner's (light) design, whatever the respondent's device prefers.
  const isPublicForm = route.name === "public";
  useEffect(() => {
    if (isPublicForm) { document.documentElement.dataset.theme = "light"; return; }
    applyThemeToDocument(user?.settings?.theme || "system");
    if (!user?.settings?.theme || user.settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyThemeToDocument("system");
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    }
  }, [user?.settings?.theme, isPublicForm]);

  useEffect(() => {
    if (route.name === "edit") {
      if (activeForm?._id === route.id) return;
      setLoadingActiveForm(true);
      api.getForm(route.id).then((f) => {
        setActiveForm(f);
        setLoadingActiveForm(false);
      }).catch(() => setLoadingActiveForm(false));
    }
  }, [route]);

  // Ctrl/Cmd+K opens the quick switcher; the mobile menu closes whenever the page changes.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && getToken()) { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { setMenuOpen(false); window.scrollTo({ top: 0 }); }, [route.name, route.id]);

  function startBlankForm() {
    pendingDraft.current = { title: "Untitled Form", description: "", fields: [], source: "manual", generationPrompt: null };
    navigate("/new");
  }

  function logout() {
    clearSession();
    setUser(null);
    navigate("/explore");
  }

  // Public form fill opens standalone (no app chrome).
  if (route.name === "public") {
    return (
      <PublicFormPage
        id={route.id}
        user={user}
        onSaveTemplate={(copy) => { setActiveForm(copy); navigate(`/edit/${copy._id}`); }}
      />
    );
  }

  const inWorkspace = route.name === "new" || route.name === "edit";
  // The email-confirmation link must work for someone who is not signed in yet.
  const isPublicRoute = ["about", "explore", "verify", "pricing", "reset", "forgot"].includes(route.name);
  const isBusiness = user?.company?.type === "business";
  const isCompanyAdmin = isBusiness && user?.role === "admin";
  const waiting = ["pending", "declined"].includes(user?.membership?.status) && !user?.companyId;
  const needsAuth = !isPublicRoute; // home / new / edit / settings require a login

  const pages = [
    { hash: "/", label: "Forms", icon: "forms" },
    { hash: "/teams", label: "Teams", icon: "teams" },
    ...(isCompanyAdmin ? [{ hash: "/approvals", label: "Approvals", icon: "admin" }] : []),
    { hash: "/explore", label: "Explore", icon: "explore" },
    ...(user?.role === "superadmin" || user?.role === "admin" ? [{ hash: "/admin", label: "Admin", icon: "admin" }] : []),
    { hash: "/settings", label: "Settings", icon: "settings" },
    { hash: "/about", label: "About", icon: "about" },
  ];
  const showSidebar = !!user && !waiting; // signed-out visitors get the top bar instead

  return (
    <div className={`shell ${showSidebar ? "with-sidebar" : "bare"} ${!showSidebar && !waiting ? "has-pubbar" : ""}`}>
      {showSidebar && (
        <Sidebar
          user={user} route={route} open={menuOpen} onClose={() => setMenuOpen(false)}
          onNavigate={navigate} approvalCount={approvalCount} onNewForm={startBlankForm} onSearch={() => setPaletteOpen(true)} onLogout={logout}
        />
      )}
      <div className="shell-main">
        {!showSidebar && !waiting && <PublicBar route={route} onNavigate={navigate} />}
        {showSidebar && (
          <header className="mobile-bar">
            <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Icon name="menu" size={22} /></button>
            <button className="mobile-brand" onClick={() => navigate(user ? "/" : "/explore")} aria-label="GUUT Forms home"><Logo variant="horizontal" height={26} /></button>
            {user ? <button className="icon-btn" onClick={() => setPaletteOpen(true)} aria-label="Search"><Icon name="search" size={20} /></button> : <button className="primary small" onClick={() => navigate("/")}>Sign in</button>}
          </header>
        )}
        <div className="app-shell">
      <main>
        {user && user.companyId && user.membership?.status === "pending" && (
          <div className="info-banner">
            <span>Your request to join {user.pendingCompanyName || "a company"} is waiting for an admin to approve it.</span>
            <button className="link-btn" onClick={() => api.cancelJoin().then(({ user: u }) => { saveUser(u); setUser(u); }).catch(() => {})}>Cancel request</button>
          </div>
        )}
        {route.name === "join" ? (
          user && !waiting ? (
            <JoinCompany code={route.code} user={user} onUser={setUser} onDone={() => navigate("/")} />
          ) : (
            <AuthPage key={`join-${route.code}`} joinCode={route.code} onAuth={(u) => { setUser(u); navigate("/"); }} />
          )
        ) : needsAuth && !user ? (
          <AuthPage key={JSON.stringify(authInitial)} initial={authInitial} onAuth={(u) => { setUser(u); navigate("/"); }} />
        ) : waiting ? (
          <PendingApproval user={user} onUser={setUser} onLogout={logout} />
        ) : (
          <>
            {route.name === "home" && (
              <Home
                user={user}
                onOpenDraft={(draft) => { pendingDraft.current = draft; navigate("/new"); }}
                onOpenForm={(f) => navigate(`/edit/${f._id}`)}
              />
            )}

            {route.name === "explore" && (
              <ExplorePage
                onOpenPublic={(id) => navigate(`/f/${id}`)}
                user={user}
                onSaveTemplate={(copy) => { setActiveForm(copy); navigate(`/edit/${copy._id}`); }}
              />
            )}

            {route.name === "about" && <AboutPage />}

            {route.name === "pricing" && (
              <PricingPage user={user} onChoose={(kind, plan) => {
                if (user) { navigate(user.role === "admin" && user.company?.type === "business" ? "/admin" : "/"); return; }
                setAuthInitial({ mode: "create", type: kind, plan }); navigate("/");
              }} />
            )}

            {route.name === "approvals" && (
              isCompanyAdmin ? <ApprovalsPage onCount={setApprovalCount} /> : <div className="empty-hint"><p>Approvals are for company admins.</p></div>
            )}

            {(route.name === "reset" || route.name === "forgot") && (
              <ResetPassword token={route.token} onAuth={(u) => { setUser(u); navigate("/"); }} />
            )}

            {route.name === "verify" && (
              <VerifyEmail token={route.token} onAuth={(u) => { setUser(u); navigate("/"); }} />
            )}

            {route.name === "admin" && (
              user?.role === "superadmin" || user?.role === "admin"
                ? <AdminPage currentUser={user} />
                : <div className="empty-hint"><p>This area is for admins only.</p></div>
            )}

            {route.name === "teams" && <TeamsPage user={user} />}

            {route.name === "settings" && (
              <SettingsPage key={route.tab || "settings"} initialTab={route.tab} user={user} onUserUpdated={(u) => setUser(u)} />
            )}

            {route.name === "new" && (
              pendingDraft.current ? (
                <FormBuilder
                  draft={pendingDraft.current}
                  formId={null}
                  onSaved={(saved) => { setActiveForm(saved); navigate(`/edit/${saved._id}`); }}
                />
              ) : (
                <div className="empty-hint">
                  <p>Nothing to build yet.</p>
                  <button className="primary" onClick={() => navigate("/")}>Start a new form</button>
                </div>
              )
            )}

            {route.name === "edit" && (
              loadingActiveForm || !activeForm ? (
                <p>Loading...</p>
              ) : (
                <FormBuilder draft={activeForm} formId={activeForm._id} onSaved={(saved) => setActiveForm(saved)} />
              )
            )}
          </>
        )}
      </main>

      <ReportWidget />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} pages={pages} onGo={navigate} />
    </div>
  );
}
