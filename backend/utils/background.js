import { waitUntil } from "@vercel/functions";

/**
 * Work that should finish after the reply has been sent (emails, cleanup).
 * A long-running server simply lets the promise run. On Vercel the function can be
 * frozen as soon as the reply is sent, so the promise is registered with waitUntil,
 * which keeps the instance alive until it settles. Never throws, never rejects.
 */
export function background(promise) {
  const p = Promise.resolve(promise).catch(() => {});
  try { waitUntil(p); } catch { /* not on Vercel: nothing to register */ }
  return p;
}
