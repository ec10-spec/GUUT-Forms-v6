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

/**
 * A small always-available "Report a problem" launcher (bottom-right). Opens a
 * chatbox with name, email, message and an optional file attachment, and posts
 * to /api/reports. Available on every page, including public forms, so anyone
 * hitting a bug can flag it.
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

  return (
    <div className="report-widget">
      {open && (
        <div className="report-panel">
          <div className="report-panel-head">
            <strong>Report a problem</strong>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>

          {done ? (
            <div className="report-done">
              <p>{topic === "form" ? "Thanks. Your report was sent to the form's admin." : "Thanks. Your report was sent to the platform team."}</p>
              <button className="secondary" onClick={() => { reset(); setOpen(false); }}>Close</button>
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
      )}

      <button className="report-launcher" onClick={() => setOpen((o) => !o)} aria-label="Report a problem">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v4" /><path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        Report a problem
      </button>
    </div>
  );
}
