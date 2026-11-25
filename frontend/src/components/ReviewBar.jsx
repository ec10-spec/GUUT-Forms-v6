import React, { useEffect, useState } from "react";
import { api } from "../api.js";

const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const who = (u) => (u ? u.name || u.email : "someone");

/**
 * Team review for one form, shown in the builder. Editors ask the reviewers of a team the form is shared
 * with; a reviewer approves it or asks for changes. Hidden when the form has no team with reviewers.
 */
export default function ReviewBar({ formId, dirty, updatedAt }) {
  const [r, setR] = useState(null);
  const [mode, setMode] = useState(null); // "request" | "changes"
  const [teamId, setTeamId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    api.shareInfo(formId).then((d) => { if (live) setR(d.review || null); }).catch(() => {});
    return () => { live = false; };
  }, [formId]);

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
    <div className={`review-bar review-${status}`} role="region" aria-label="Team review">
      <div className="review-line">
        <span className="review-status">
          {status === "none" && <>Want a second pair of eyes? Ask a team's reviewers to check this form.</>}
          {status === "requested" && <><strong>Waiting for review</strong> by the {r.team?.name || "team"} reviewers. Asked by {who(r.requestedBy)} on {day(r.requestedAt)}.{r.requestNote ? ` Note: ${r.requestNote}` : ""}</>}
          {status === "approved" && <><strong>Approved</strong> by {who(r.decidedBy)} on {day(r.decidedAt)}.{r.note ? ` ${r.note}` : ""}{changedSince && <em> The form has changed since then.</em>}</>}
          {status === "changes_requested" && <><strong>Changes requested</strong> by {who(r.decidedBy)} on {day(r.decidedAt)}: {r.note}</>}
        </span>
        <span className="review-buttons">
          {status === "requested" && r.amReviewer && !mode && (
            <>
              <button className="primary small" disabled={busy} onClick={() => run(() => api.reviewDecide(formId, "approve", ""))}>Approve</button>
              <button className="small" disabled={busy} onClick={() => { setNote(""); setMode("changes"); }}>Request changes</button>
            </>
          )}
          {r.canRequest && !mode && status !== "requested" && <button className="secondary small" disabled={busy} onClick={startRequest}>{status === "none" ? "Request review" : "Ask for review again"}</button>}
          {r.canRequest && status === "requested" && !mode && <button className="small" disabled={busy} onClick={() => run(() => api.reviewClear(formId))}>Withdraw</button>}
          {r.canRequest && (status === "approved" || status === "changes_requested") && !mode && <button className="link-btn" disabled={busy} onClick={() => run(() => api.reviewClear(formId))}>Clear</button>}
        </span>
      </div>

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
          {dirty && <span className="field-help">Save your changes first so reviewers see the latest version.</span>}
          <div className="row-gap">
            <button className="primary small" type="submit" disabled={busy || !teamId}>Send request</button>
            <button className="small" type="button" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </form>
      )}
      {mode === "changes" && (
        <form className="review-form" onSubmit={(e) => { e.preventDefault(); run(() => api.reviewDecide(formId, "changes", note)); }}>
          <label>What should change?
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} required />
          </label>
          <div className="row-gap">
            <button className="primary small" type="submit" disabled={busy || !note.trim()}>Send</button>
            <button className="small" type="button" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
