// First-run funnel events (no form content, no personal data): sent once each, fire and forget.
const ORIGIN = (import.meta.env?.VITE_API_BASE || "").replace(/\/$/, "");
const sent = new Set();

export function track(event, extra) {
  const key = `${event}:${extra?.ref || ""}`;
  if (sent.has(key)) return;
  sent.add(key);
  try {
    fetch(`${ORIGIN}/api/funnel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, ...(extra || {}) }), keepalive: true }).catch(() => {});
  } catch { /* never break the page for analytics */ }
}
