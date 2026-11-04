import React, { useEffect, useRef, useState } from "react";
import { generateStandaloneHtml, standaloneFileName } from "../lib/standaloneExport.js";
import { getUser } from "../api.js";

/**
 * Persistent share control in the workspace header (same pattern as Google
 * Forms/Docs). Copy link and Open in new tab work once the form is published.
 * "List in public repository" toggles whether the form appears on /explore.
 * "Download as HTML file" is open to every account: a single self-contained
 * file anyone can share (email, Drive, any website). Responses go to this
 * deployment, so they land in GUUT's hosted database or the company's own
 * database. Business accounts and the platform team can also point the file
 * at their own backend ("Send responses to a different server", SETUP.md).
 * "Share with people" opens per-form sharing (view/edit access for teammates).
 */
export default function ShareMenu({ shareUrl, published, isPublic, listingStatus = "none", onTogglePublic, form, canManage = true, onSharePeople }) {
  const saved = !!form?._id;
  // Anyone can download the HTML file; only business accounts and the platform
  // team can send its responses to a different backend.
  const me = getUser();
  const canSelfHost = me?.role === "superadmin" || me?.company?.type === "business";
  const pending = listingStatus === "pending";
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selfHostOpen, setSelfHostOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [apiBase, setApiBase] = useState(() => window.location.origin);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSelfHostOpen(false); }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function copy() {
    if (!published) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function openInNewTab() {
    if (!published) return;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  function downloadStandalone() {
    if (!published || !form) return;
    const base = canSelfHost && apiBase.trim() ? apiBase.trim() : window.location.origin;
    const html = generateStandaloneHtml(form, base, { appUrl: window.location.origin });
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = standaloneFileName(form);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  }

  return (
    <div className="share-menu" ref={ref}>
      <button className="share-trigger" onClick={() => setOpen((o) => !o)} aria-label="Share">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" /><line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
        </svg>
        Share
      </button>

      {open && (
        <div className="share-panel">
          <div className={`share-row ${published ? "" : "disabled"}`} onClick={copy} title={published ? "" : "Publish this form to get a shareable link"}>
            <div>
              <strong>Copy link</strong>
              <span>{published ? "Anyone with the link can fill this out" : "Publish the form first"}</span>
            </div>
            {published && <span className="share-row-action">{copied ? "Copied" : "Copy"}</span>}
          </div>

          <div className={`share-row ${published ? "" : "disabled"}`} onClick={openInNewTab} title={published ? "" : "Publish this form first"}>
            <div>
              <strong>Open in new tab</strong>
              <span>Preview the live form as a respondent</span>
            </div>
            {published && <span className="share-row-action">Open ↗</span>}
          </div>

          <div className={`share-row toggle-row ${published ? "" : "disabled"}`} title={published ? "" : "Publish this form first"}>
            <div>
              <strong>List in public repository</strong>
              <span>{pending ? "Waiting for your company admin to approve" : listingStatus === "denied" && !isPublic ? "Your company admin declined this listing" : me?.company?.type === "business" && me?.role !== "admin" ? "Needs company admin approval before it appears in Explore" : "Show on the Explore page for anyone to find"}</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={!!isPublic || pending}
                disabled={!published || !canManage}
                onChange={(e) => onTogglePublic?.(e.target.checked)}
              />
              <span className="switch-slider" />
            </label>
          </div>

          <div
            className={`share-row ${published ? "" : "disabled"}`}
            onClick={() => published && downloadStandalone()}
            title={published ? "" : "Publish this form first"}
          >
            <div>
              <strong>Download as HTML file</strong>
              <span>{published ? "One file anyone can open and fill in. Send it, upload it or put it on any website" : "Publish the form first"}</span>
            </div>
            {published && <span className="share-row-action">{downloaded ? "Downloaded" : "Download"}</span>}
          </div>

          {canSelfHost && <div
            className={`share-row ${published ? "" : "disabled"}`}
            onClick={() => published && setSelfHostOpen((o) => !o)}
            title={published ? "" : "Publish this form first"}
          >
            <div>
              <strong>Send responses to a different server</strong>
              <span>For a backend you run yourself</span>
            </div>
            {published && <span className="share-row-action">{selfHostOpen ? "Hide" : "Set up"}</span>}
          </div>}

          {canSelfHost && selfHostOpen && published && (
            <div className="self-host-panel">
              <label className="self-host-label">
                API base URL (where submissions get sent)
                <input
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder="https://your-backend.example.com"
                />
              </label>
              <p className="self-host-hint">
                Leave this as it is to keep responses in GUUT, or point it at your own deployment (see SETUP.md).
                The download is still a single HTML file with no other dependencies.
              </p>
              <button className="secondary small self-host-download" onClick={downloadStandalone}>
                Download HTML with this server
              </button>
            </div>
          )}

          <div
            className={`share-row ${saved && canManage ? "" : "disabled"}`}
            onClick={() => { if (saved && canManage) { setOpen(false); onSharePeople?.(); } }}
            title={!saved ? "Save the form first" : !canManage ? "Only the owner or a company admin can share" : ""}
          >
            <div>
              <strong>Share with people</strong>
              <span>{!saved ? "Save the form first" : canManage ? "Give teammates view or edit access" : "Only the owner or a company admin can share"}</span>
            </div>
            {saved && canManage && <span className="share-row-action">Manage</span>}
          </div>
        </div>
      )}
    </div>
  );
}
