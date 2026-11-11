import React, { useState } from "react";

const KEY = "guut_guide_dismissed";
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

/** First-run guide for people with no forms yet: three steps to a live form. */
export default function GettingStarted({ onTemplates, onDescribe, onBlank }) {
  const [hidden, setHidden] = useState(read);
  if (hidden) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setHidden(true); };
  return (
    <section className="guide">
      <div className="guide-head">
        <h2>Publish your first form in about two minutes</h2>
        <button className="link-btn" onClick={dismiss}>Dismiss</button>
      </div>
      <ol className="guide-steps">
        <li><span className="guide-n">1</span><div><strong>Start</strong><p>Pick a template, or describe the form above and let AI draft it.</p><div className="guide-actions"><button className="primary small" onClick={onTemplates}>Browse templates</button><button className="secondary small" onClick={onDescribe}>Describe it</button><button className="link-btn" onClick={onBlank}>Blank form</button></div></div></li>
        <li><span className="guide-n">2</span><div><strong>Adjust and publish</strong><p>Edit the questions, pick colours under Design, then press Publish form.</p></div></li>
        <li><span className="guide-n">3</span><div><strong>Share the link</strong><p>Open Share, copy the link, and watch responses arrive under Responses. Charts and the AI assistant are in the same tab.</p></div></li>
      </ol>
    </section>
  );
}
