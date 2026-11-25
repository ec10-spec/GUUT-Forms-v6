import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const who = (u) => (u ? u.name || u.email : "someone");
const LABEL = { none: "Review", requested: "In review", approved: "Approved", changes_requested: "Changes requested" };

/**
 * Team review for one form, as a small chip beside the form's status. Clicking it opens the details and
 * actions: editors ask a team's reviewers; a reviewer approves or asks for changes. Hidden when nobody can
 * review this form. Review never blocks publishing.
 */
export default function ReviewChip({ formId, dirty, updatedAt }) {
  const [r, setR] = useState(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // "request" | "changes"
  const [teamId, setTeamId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    let live = true;
    api.shareInfo(formId).then((d) => {
      if (!live) return;
      setR(d.review || null);
      // A reviewer arriving from "Waiting for your review" sees the decision straight away.
      if (d.review?.amReviewer && d.review.status === "requested") setOpen(true);
    }).catch(() => {});
    return () => { live = false; };
  }, [formId]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setMode(null); } };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); setMode(null); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!r) return null;
  const status = r.status;
  if (status === "none" && !r.canRequest) return null;

  async function run(fn) {
    setBusy(true); setError(null);
    try { const { review } = await fn(); setR(review); setMode(null); setNote(""); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const startRequest = () => { setTeamId(r.team?._id && r.reviewTeams.some((t) => t._id === r.team._id) ? r.team._id : r.reviewTeams[0]?._id || ""); setNote(""); setMode("request"); };
  const changedSince = status === "approved" && (dirty || (updatedAt && r.decidedAt && new Date(updatedAt) > new Date(r.decidedAt)));

  return (
    <span className="review-chip-wrap" ref={ref}>
      <button type="button" className={`review-chip review-${status} ${changedSince ? "stale" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        {status === "requested" && r.amReviewer ? "Your review needed" : LABEL[status]}{changedSince ? " (edited since)" : ""}
      </button>
      {open && (
        <div className="review-pop" role="dialog" aria-label="Team review">
          <p className="review-status">
            {status === "none" && <>Ask a team's reviewers to check this form before it goes out.</>}
            {status === "requested" && <><strong>Waiting for review</strong> by the {r.team?.name || "team"} reviewers. Asked by {who(r.requestedBy)} on {day(r.requestedAt)}.{r.requestNote ? ` Note: ${r.requestNote}` : ""}</>}
            {status === "approved" && <><strong>Approved</strong> by {who(r.decidedBy)} on {day(r.decidedAt)}.{r.note ? ` ${r.note}` : ""}{changedSince && " The form has changed since then."}</>}
            {status === "changes_requested" && <><strong>Changes requested</strong> by {who(r.decidedBy)} on {day(r.decidedAt)}: {r.note}</>}
          </p>

          {!mode && (
            <div className="row-gap">
              {status === "requested" && r.amReviewer && (
                <>
                  <button className="primary small" disabled={busy} onClick={() => run(() => api.reviewDecide(formId, "approve", ""))}>Approve</button>
                  <button className="small" disabled={busy} onClick={() => { setNote(""); setMode("changes"); }}>Request changes</button>
                </>
              )}
              {r.canRequest && status !== "requested" && <button className="secondary small" disabled={busy} onClick={startRequest}>{status === "none" ? "Request review" : "Ask for review again"}</button>}
              {r.canRequest && status === "requested" && <button className="small" disabled={busy} onClick={() => run(() => api.reviewClear(formId))}>Withdraw request</button>}
              {r.canRequest && (status === "approved" || status === "changes_requested") && <button className="link-btn" disabled={busy} onClick={() => run(() => api.reviewClear(formId))}>Clear</button>}
            </div>
          )}

          {mode === "request" && (
            <form className="review-form" onSubmit={(e) => { e.preventDefault(); run(() => api.reviewRequest(formId, teamId, note)); }}>
              <label>Team
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
                  {r.reviewTeams.map((t) => <option key={t._id} value={t._id}>{t.name} ({t.reviewerCount} reviewer{t.reviewerCount === 1 ? "" : "s"})</option>)}
                </select>
              </label>
              <label>Note for the reviewers (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="For example: check the wording of question 3" />
              </label>
              {dirty && <span className="field-help">Your latest edits are not saved yet. Reviewers see the saved version.</span>}
              <div className="row-gap">
                <button className="primary small" type="submit" disabled={busy || !teamId}>Send request</button>
                <button className="small" type="button" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </form>
          )}
          {mode === "changes" && (
            <form className="review-form" onSubmit={(e) => { e.preventDefault(); run(() => api.reviewDecide(formId, "changes", note)); }}>
              <label>What should change?
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} required autoFocus />
              </label>
              <div className="row-gap">
                <button className="primary small" type="submit" disabled={busy || !note.trim()}>Send</button>
                <button className="small" type="button" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </form>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </span>
  );
}
