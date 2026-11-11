import React from "react";
import Logo from "./Logo.jsx";

/** Top bar for people who are not signed in: logo on the left, the public pages and Sign in on the right. */
export default function PublicBar({ route, onNavigate }) {
  const link = (hash, label, name) => (
    <button key={hash} className={`pub-link ${route.name === name ? "active" : ""}`} onClick={() => onNavigate(hash)}>{label}</button>
  );
  return (
    <header className="pub-bar">
      <button className="pub-brand" onClick={() => onNavigate("/")} aria-label="GUUT Forms home"><Logo variant="horizontal" height={30} /></button>
      <nav className="pub-nav" aria-label="Main">
        {link("/about", "About", "about")}
        {link("/pricing", "Pricing", "pricing")}
        {link("/explore", "Explore", "explore")}
        <button className="primary small" onClick={() => onNavigate("/")}>Sign in</button>
      </nav>
    </header>
  );
}
