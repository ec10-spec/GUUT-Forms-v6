import React, { useEffect, useState } from "react";
import { generateStandaloneHtml, standaloneFileName } from "../lib/standaloneExport.js";

/**
 * Shown right after a form is published for the first time: the link to send, an embed code for a website,
 * the single-file HTML download, and sharing with teammates. Everything here is also in the Share menu.
 */
export default function ShareSheet({ form, shareUrl, canManage, onSharePeople, onClose }) {
  const [copied, setCopied] = useState(null);
  const embed = `<iframe src="${shareUrl}" width="100%" height="900" style="border:0" title="${String(form?.title || "Form").replace(/"/g, "&quot;")}"></iframe>`;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function copy(what, text) {
    try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked */ }
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }
  function download() {
    const html = generateStandaloneHtml(form, window.location.origin, { appUrl: window.location.origin });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = standaloneFileName(form);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setCopied("html");
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal share-sheet" role="dialog" aria-modal="true" aria-labelledby="share-sheet-title">
        <div className="share-sheet-head">
          <span className="status-pill published">Live</span>
          <h2 id="share-sheet-title">Your form is live</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="settings-hint">Anyone with the link can respond. New responses show up under Responses.</p>

        <label className="share-sheet-label">Link</label>
        <div className="copy-row">
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} aria-label="Form link" />
          <button className="primary" onClick={() => copy("link", shareUrl)}>{copied === "link" ? "Copied" : "Copy link"}</button>
        </div>

        <div className="share-sheet-grid">
          <a className="share-tile" href={shareUrl} target="_blank" rel="noreferrer">
            <strong>Open the form</strong><span>See it as a respondent, or send a test response</span>
          </a>
          <button type="button" className="share-tile" onClick={() => copy("embed", embed)}>
            <strong>{copied === "embed" ? "Embed code copied" : "Copy embed code"}</strong><span>Paste it into any website page</span>
          </button>
          <button type="button" className="share-tile" onClick={download}>
            <strong>{copied === "html" ? "Downloaded" : "Download as HTML file"}</strong><span>One file you can email or upload anywhere</span>
          </button>
          {canManage && (
            <button type="button" className="share-tile" onClick={onSharePeople}>
              <strong>Share with people</strong><span>Give teammates view or edit access</span>
            </button>
          )}
        </div>
        <div className="share-sheet-foot"><button className="secondary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
