import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { api } from "./api.js";
import "./styles/app.css";

// Send uncaught browser errors to the backend log (stored in MongoDB). Deduped
// and capped so one broken render loop can't flood the log.
const seen = new Set();
function report(kind, message, stack) {
  const key = `${kind}:${message}`;
  if (!message || seen.has(key) || seen.size >= 20) return;
  seen.add(key);
  api.logClientError({ kind, message: String(message), stack: stack ? String(stack) : "", url: window.location.href });
}
window.addEventListener("error", (e) => report("error", e.message, e.error?.stack));
window.addEventListener("unhandledrejection", (e) => report("unhandledrejection", e.reason?.message || String(e.reason), e.reason?.stack));

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
