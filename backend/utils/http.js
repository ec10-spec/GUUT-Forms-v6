/** Throwable HTTP error: status < 500 messages are shown to the client as-is. */
export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
