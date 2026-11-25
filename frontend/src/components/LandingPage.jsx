import React, { useEffect, useState } from "react";
import FormRenderer from "./FormRenderer.jsx";
import Icon from "./Icon.jsx";
import { SAMPLE_FORM } from "../lib/sampleForm.js";
import { track } from "../lib/funnel.js";
import { api } from "../api.js";

export const PENDING_PROMPT_KEY = "guut_pending_prompt";
export const rememberPrompt = (text) => { try { text ? sessionStorage.setItem(PENDING_PROMPT_KEY, text) : sessionStorage.removeItem(PENDING_PROMPT_KEY); } catch { /* storage blocked */ } };

const STEPS = [
  ["Describe it", "Write what you need in a sentence. GUUT AI drafts the questions, choices and follow-up logic. Keep what you like, change the rest."],
  ["Publish it", "One click gives you a link. Share it, embed it on a site, or download the form as a single HTML file."],
  ["Understand it", "Responses turn into charts as they arrive. Ask GUUT AI what the answers mean and what to do next."],
];

const FEATURES = [
  ["Questions that adapt", "Show a follow-up only when it matters, for example asking what went wrong after a low rating."],
  ["Teams and reviewers", "Share a form with a whole team. Ask reviewers to approve it before it goes out."],
  ["Charts without setup", "Every question gets the right chart. Export to CSV or PDF any time."],
  ["Your data, your database", "Business accounts can keep forms and responses in their own MongoDB database."],
  ["Works anywhere", "Respondents need no account. The form works on phones and inside any website."],
  ["Bring your own AI", "Connect your Claude or ChatGPT key. A typical form costs about 1 to 2 cents of AI."],
];

/** The page signed-out visitors see first: what GUUT Forms does, a live sample form, and one way in. */
export default function LandingPage({ onStart, onExample }) {
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState([]);
  useEffect(() => { api.oauthProviders().then((p) => setProviders(p.filter((x) => x.enabled).map((x) => x.label))).catch(() => {}); }, []);
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    track("landing_view", ref ? { ref } : undefined);
  }, []);

  function start(e) {
    e?.preventDefault?.();
    rememberPrompt(prompt.trim());
    onStart();
  }

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-copy">
          <span className="hero-eyebrow"><span className="dot" /> Free for individuals</span>
          <h1>Describe a form. Publish it. Understand the answers.</h1>
          <p className="landing-sub">Build a form in minutes, share one link, and get charts and plain-language insight from every response.</p>
          <form className="landing-try" onSubmit={start}>
            <label className="sr-only" htmlFor="landing-prompt">Describe the form you need</label>
            <input id="landing-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} placeholder="For example: a feedback form for my coffee shop" />
            <button className="primary" type="submit">Start free</button>
          </form>
          <div className="landing-sub-actions">
            <button className="link-btn" onClick={onExample}>See an example form</button>
            <span>No credit card. Sign up with {providers.length ? `${providers.join(", ")} or email` : "your email"}.</span>
          </div>
        </div>
        <div className="landing-demo" aria-label="A sample form you can try">
          <div className="landing-demo-bar"><span /><span /><span /><em>Sample form: try it</em></div>
          <div className="landing-demo-body">
            <FormRenderer form={SAMPLE_FORM} demo hideBranding demoNote={<button className="primary" onClick={() => start()}>Make one like this, free</button>} />
          </div>
        </div>
      </section>

      <section className="landing-steps" aria-label="How it works">
        {STEPS.map(([title, body], i) => (
          <div key={title} className="landing-step">
            <span className="landing-step-n">{i + 1}</span>
            <h2>{title}</h2>
            <p>{body}</p>
            <StepVisual step={i} />
          </div>
        ))}
      </section>

      <section className="landing-features" aria-label="Features">
        <h2>Everything a small team needs, nothing it does not</h2>
        <div className="landing-feature-grid">
          {FEATURES.map(([t, b]) => <div key={t} className="landing-feature"><h3>{t}</h3><p>{b}</p></div>)}
        </div>
      </section>

      <section className="landing-cta">
        <h2>Your first form is two minutes away</h2>
        <p>Start free. Add your team when you are ready.</p>
        <div className="row-gap center">
          <button className="primary big-btn" onClick={() => start()}>Start free</button>
          <a className="btn-link" href="#/pricing">See pricing</a>
        </div>
      </section>
    </div>
  );
}

/** Small product illustrations built from the app's own styles (no stock art). */
function StepVisual({ step }) {
  if (step === 0) {
    return (
      <div className="sv sv-describe" aria-hidden="true">
        <div className="sv-input"><Icon name="spark" size={14} /> Feedback form for my coffee shop</div>
        <div className="sv-q">How often do you visit?</div>
        <div className="sv-q">How was your coffee today? <span className="sv-stars">★★★★★</span></div>
        <div className="sv-q sv-logic">If 3 or lower: What should we improve?</div>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="sv sv-share" aria-hidden="true">
        <span className="sv-live">Live</span>
        <div className="sv-link">{window.location.host}/#/f/coffee-feedback<span>Copy</span></div>
        <div className="sv-row"><span>Embed on a site</span><span>Download HTML</span></div>
      </div>
    );
  }
  const bars = [["Most days", 46], ["Weekly", 32], ["First time", 22]];
  return (
    <div className="sv sv-chart" aria-hidden="true">
      {bars.map(([l, v]) => <div key={l} className="sv-bar"><span>{l}</span><i style={{ width: `${v * 2}%` }} /><b>{v}%</b></div>)}
      <div className="sv-insight"><Icon name="spark" size={12} /> Regulars rate you 4.6. First-timers mention wait times: try a faster line at 8 am.</div>
    </div>
  );
}
