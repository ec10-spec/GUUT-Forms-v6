import { log } from "./logger.js";

// First-run funnel: where new people drop off between seeing GUUT Forms and getting a first response.
// Stored as Log entries (category "funnel", message = event name). Never holds form content.
export const FUNNEL_EVENTS = ["landing_view", "example_view", "made_with_click", "signup_started", "signup_done", "first_form_created", "first_publish", "first_response"];
// Events a browser may report itself (no account needed). The rest are recorded by the server.
export const CLIENT_EVENTS = new Set(["landing_view", "example_view", "made_with_click", "signup_started"]);

/** Never throws: analytics must not break a request. */
export function funnel(event, req, meta) {
  try {
    if (!FUNNEL_EVENTS.includes(event)) return;
    log({ level: "info", category: "funnel", message: event, req, meta: meta || null });
  } catch { /* ignore */ }
}
