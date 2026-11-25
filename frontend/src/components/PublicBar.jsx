import React, { useEffect, useState } from "react";
import Logo from "./Logo.jsx";
import Icon from "./Icon.jsx";

/**
 * Top bar for people who are not signed in. Desktop: logo, About, Pricing, Explore, Sign in, Start free.
 * Phone: logo, Start free and a menu button that opens the other links.
 */
export default function PublicBar({ route, onNavigate }) {
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [route.name]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);
  const go = (hash) => { setMenu(false); onNavigate(hash); };
  const link = (hash, label, name) => (
    <button key={hash} className={`pub-link ${route.name === name ? "active" : ""}`} onClick={() => go(hash)} aria-current={route.name === name ? "page" : undefined}>{label}</button>
  );
  return (
    <header className="pub-bar">
      <button className="pub-brand" onClick={() => go("/")} aria-label="GUUT Forms home"><Logo variant="horizontal" height={30} /></button>
      <nav className="pub-nav" aria-label="Main">
        <span className="pub-links">
          {link("/about", "About", "about")}
          {link("/pricing", "Pricing", "pricing")}
          {link("/explore", "Explore", "explore")}
          {link("/signin", "Sign in", "signin")}
        </span>
        <button className="primary small pub-start" onClick={() => go("/signup")}>Start free</button>
        <button className="icon-btn pub-menu-btn" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}><Icon name={menu ? "close" : "menu"} size={22} /></button>
      </nav>
      {menu && (
        <>
          <div className="pub-sheet-backdrop" onClick={() => setMenu(false)} />
          <div className="pub-sheet" role="menu">
            {link("/about", "About", "about")}
            {link("/pricing", "Pricing", "pricing")}
            {link("/explore", "Explore", "explore")}
            {link("/signin", "Sign in", "signin")}
            <button className="primary" onClick={() => go("/signup")}>Start free</button>
          </div>
        </>
      )}
    </header>
  );
}
