// After a new deploy, a tab that was already open asks for code files that no longer exist (each build
// renames them). Reload once to pick up the new version instead of showing a broken page.
export const STALE_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk/i;
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem("guut_reloaded_at") || 0);
    if (Date.now() - last < 30000) return false; // at most once every 30 seconds, never a reload loop
    sessionStorage.setItem("guut_reloaded_at", String(Date.now()));
  } catch { /* storage blocked: still reload once */ }
  window.location.reload();
  return true;
}
