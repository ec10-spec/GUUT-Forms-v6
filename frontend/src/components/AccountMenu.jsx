import React, { useEffect, useRef, useState } from "react";

/**
 * Click-the-name dropdown in the header (same click-outside pattern as
 * ShareMenu). Currently just routes to Settings and Log out, but is the
 * natural home for any future account actions.
 */
export default function AccountMenu({ user, onOpenSettings, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="account-menu" ref={ref}>
      <button className="account-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="account-avatar">{(user.name || user.email || "?")[0].toUpperCase()}</span>
        <span className="account-email" title={user.email}>{user.name || user.email}</span>
      </button>

      {open && (
        <div className="account-panel">
          <div className="account-panel-header">
            <strong>{user.name || "Your account"}</strong>
            <span>{user.email}</span>
            {user.role !== "user" && <span className="role-badge">{user.role === "superadmin" ? "Platform team" : "Admin"}</span>}
          </div>
          <button
            className="account-panel-row"
            onClick={() => { setOpen(false); onOpenSettings(); }}
          >
            Settings
          </button>
          <button className="account-panel-row danger" onClick={() => { setOpen(false); onLogout(); }}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
