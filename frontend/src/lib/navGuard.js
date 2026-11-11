// Warns before leaving a page with unsaved changes. The builder registers a check; App asks it before
// following any in-app link (every link changes the URL hash), and the browser asks on reload or close.

let check = null; // () => message | null

export function setLeaveGuard(fn) {
  check = fn;
  return () => { if (check === fn) check = null; };
}

/** True when it is fine to leave (nothing unsaved, or the person confirmed). */
export function confirmLeave() {
  const msg = check?.();
  if (!msg) return true;
  return window.confirm(msg);
}

window.addEventListener("beforeunload", (e) => {
  if (check?.()) { e.preventDefault(); e.returnValue = ""; }
});
