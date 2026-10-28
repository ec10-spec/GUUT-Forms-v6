import React from "react";
import Logo from "./Logo.jsx";

const USE_CASES = [
  {
    title: "Students & Researchers",
    body: "Draft a participant intake or survey by describing it once, then adjust the logic and branding to match a specific study without touching a spreadsheet.",
  },
  {
    title: "Startup Founders & PMs",
    body: "Turn a rough idea for an onboarding or feedback flow into a working form in the time it takes to write the description, then iterate as the product changes.",
  },
  {
    title: "Sales & Marketing",
    body: "Stand up a lead-capture or event RSVP form on short notice, publish it, and share the link directly, no design pass required to look presentable.",
  },
  {
    title: "Operations Teams",
    body: "Replace ad hoc spreadsheet requests with a real form backed by a database, with responses searchable and exportable from day one.",
  },
];

export default function AboutPage() {
  return (
    <div className="about-page">
      <section className="about-hero">
        <Logo variant="full" height={92} className="about-logo" />
        <h1>Forms shouldn't start from a blank grid.</h1>
        <p className="about-lede">
          GUUT Forms is built on the same principle behind everything GUUT makes:
          information tools should adapt to how people actually describe what they
          need, not force them to learn a builder's mental model first.
        </p>
      </section>

      <section className="about-block">
        <h2>The AI difference</h2>
        <p>
          Instead of assembling a form field by field, describe what you're
          collecting in plain language. The AI proposes a starting set of
          questions, you decide which to keep and in what order, and the result
          drops straight into the same editor you'd use to build one by hand.
          Nothing is generated blind and nothing is locked in without your say.
        </p>
        <p>
          It's the same idea GUUT applies across its platform: let AI handle the
          first draft of structure so people spend their time on judgment calls,
          not data entry.
        </p>
      </section>

      <section className="about-block">
        <h2>Who it's for</h2>
        <div className="use-case-grid">
          {USE_CASES.map((u) => (
            <div key={u.title} className="use-case-card">
              <h3>{u.title}</h3>
              <p>{u.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="about-block">
        <h2>What makes it different</h2>
        <ul className="about-list">
          <li><span className="dot" /> One page per form: build, preview, and read responses without switching screens.</li>
          <li><span className="dot" /> A shareable link the moment you publish, no separate distribution step.</li>
          <li><span className="dot" /> Token usage visible and capped per query, so AI generation stays predictable to run.</li>
          <li><span className="dot" /> Built on MongoDB from the start, so responses are queryable data, not a file to reconcile later.</li>
        </ul>
      </section>

      <p className="about-footer">GUUT Forms, part of the GUUT platform.</p>
    </div>
  );
}
