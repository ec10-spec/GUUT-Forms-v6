import React from "react";
import Logo from "./Logo.jsx";
import Icon from "./Icon.jsx";

const ROLE_LABEL = { superadmin: "Platform team", admin: "Company admin", user: null };

/** Main navigation: always visible on desktop, a slide-over drawer on phones. */
export default function Sidebar({ user, route, open, onClose, onNavigate, onNewForm, onSearch, onLogout, approvalCount = 0 }) {
  const go = (hash) => { onNavigate(hash); onClose(); };
  const isBusiness = user?.company?.type === "business";
  const isAdmin = user?.role === "superadmin" || user?.role === "admin";
  const on = (...names) => names.includes(route.name);

  const item = (hash, icon, label, active, badge) => (
    <button key={hash} className={`side-link ${active ? "active" : ""}`} onClick={() => go(hash)} aria-current={active ? "page" : undefined}>
      <Icon name={icon} /><span>{label}</span>{badge}
    </button>
  );

  return (
    <>
      {open && <div className="side-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="side-top">
          <button className="side-brand" onClick={() => go(user ? "/" : "/explore")} aria-label="GUUT Forms home">
            <Logo variant="horizontal" height={30} />
          </button>
          <button className="side-close icon-btn" onClick={onClose} aria-label="Close menu"><Icon name="close" /></button>
        </div>

        {user ? (
          <>
            <button className="side-cta" onClick={() => { onNewForm(); onClose(); }}>
              <Icon name="plus" /> New form
            </button>
            <button className="side-search" onClick={() => { onSearch(); onClose(); }}>
              <Icon name="search" /><span>Search</span><kbd>Ctrl K</kbd>
            </button>

            <nav className="side-nav">
              <span className="side-label">Workspace</span>
              {item("/", "forms", "Forms", on("home", "new", "edit"))}
              {item("/teams", "teams", "Teams", on("teams"))}
              {isBusiness && user.role === "admin" && item("/approvals", "admin", "Approvals", on("approvals"), approvalCount > 0 && <span className="count-pill">{approvalCount}</span>)}
              {item("/explore", "explore", "Explore", on("explore"))}
              {isAdmin && (
                <>
                  <span className="side-label">Manage</span>
                  {item("/admin", "admin", user.role === "superadmin" ? "Platform admin" : "Company admin", on("admin"))}
                </>
              )}
              <span className="side-label">Account</span>
              {item("/settings", "settings", "Settings", on("settings"))}
              {item("/about", "about", "About", on("about"))}
            </nav>

            <div className="side-user">
              <span className="avatar">{(user.name || user.email || "?")[0].toUpperCase()}</span>
              <div className="side-user-text">
                <strong title={user.email}>{user.name || user.email}</strong>
                <span>{ROLE_LABEL[user.role] || (user.company?.type === "business" ? user.company.name : "Individual account")}</span>
              </div>
              <button className="icon-btn" onClick={onLogout} aria-label="Log out" title="Log out"><Icon name="logout" /></button>
            </div>
          </>
        ) : (
          <nav className="side-nav">
            {item("/explore", "explore", "Explore", on("explore"))}
            {item("/pricing", "forms", "Pricing", on("pricing"))}
            {item("/about", "about", "About", on("about"))}
            <button className="side-cta" onClick={() => go("/")}>Sign in</button>
          </nav>
        )}
      </aside>
    </>
  );
}
