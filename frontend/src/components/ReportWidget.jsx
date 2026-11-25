import React, { useState } from "react";
import { api } from "../api.js";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Opens the "Report a problem" dialog from anywhere (sidebar, GUUT AI menu, page footers). */
export const openReport = (topic) => window.dispatchEvent(new CustomEvent("guut:report-open", { detail: { topic } }));

/**
 * "Report a problem": name, email, message and an optional file, posted to /api/reports. It has no floating
 * button of its own (that covered page content); it opens from the sidebar, the GUUT AI menu and the
 * footers of public pages and public forms.
 */
export default function ReportWidget() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("form");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  // GUUT AI's menu opens this panel too (its floating button is hidden while the assistant is docked).
  React.useEffect(() => {
    const on = (e) => {
      const t = e.detail?.topic || (/#\/(?:f|edit)\//.test(window.location.hash) ? "form" : "app");
      setTopic(t); setOpen(true);
    };
    window.addEventListener("guut:report-open", on);
    return () => window.removeEventListener("guut:report-open", on);
  }, []);

  function reset() {
    setName(""); setEmail(""); setMessage(""); setFile(null); setError(null); setDone(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!message.trim()) { setError("Please describe the problem."); return; }
    setBusy(true);
    setError(null);
    try {
      let attachment = null;
      if (file) {
        const base64 = await fileToBase64(file);
        attachment = { name: file.name, mediaType: file.type, base64 };
      }
      await api.submitReport({
        name, email, message: message.trim(), attachment, url: window.location.href,
        topic, formId: (window.location.hash.match(/#\/(?:f|edit)\/([a-fA-F0-9]{24})/) || [])[1],
      });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const close = () => { reset(); setOpen(false); };
  return (
    <div className="modal-backdrop report-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="report-panel" role="dialog" aria-modal="true" aria-label="Report a problem" onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
        <div className="report-panel-head">
          <strong>Report a problem</strong>
          <button className="icon-btn" onClick={close} aria-label="Close" autoFocus>×</button>
        </div>

        {done ? (
          <div className="report-done">
            <p>{topic === "form" ? "Thanks. Your report was sent to the form's admin." : "Thanks. Your report was sent to the platform team."}</p>
            <button className="secondary" onClick={close}>Close</button>
            <button className="link-btn" onClick={reset}>Send another</button>
          </div>
        ) : (
          <form onSubmit={submit} className="report-form">
            <label>
              What is this about?
              <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="form">A problem with a form</option>
                <option value="app">A problem with the application itself</option>
              </select>
            </label>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="So we can follow up (optional)" />
            </label>
            <label>
              What went wrong?
              <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the issue or what you expected to happen" required />
            </label>
            <label className="report-attach">
              {file ? `Attached: ${file.name}` : "Attach a screenshot or file (optional)"}
              <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Sending..." : "Send report"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
