import React from "react";
import { openReport } from "./ReportWidget.jsx";

// Privacy policy. Plain language, written to match what the app actually does today.
// DRAFT: have it reviewed before launch, and update it whenever a new service starts handling data.
const UPDATED = "November 24, 2026";
const CONTACT = "guutforms@outlook.com";

const SECTIONS = [
  ["Who we are", [
    "GUUT Forms is a form builder run by GUUT. This policy explains what we collect when you use the app (the website, the forms you publish, and the files you download from it), why, and the choices you have.",
    `Questions or requests: email ${CONTACT}.`,
  ]],
  ["What we collect", [
    "Account details: your name, email address, a securely hashed password (we never store the password itself), your account type, your company if you join one, and which sign-in methods you connected (Google, Microsoft or Apple). From those providers we only receive your name, email address and an account id.",
    "Your content: the forms you build, the responses they receive, files respondents upload, header images, imported responses, and AI conversations you choose to keep.",
    "Respondents: when someone fills in a form, we store their answers for the form's owner. We do not ask respondents to sign in.",
    "Technical records: for security and to fix problems we keep server logs with the time, the page or action, your IP address and browser type. Logs are deleted automatically after 30 days unless a longer period is set for the service.",
    "AI usage: the number of AI tokens each account uses and the estimated cost, so you and your admin can see usage.",
  ]],
  ["How we use it", [
    "To run the service: sign you in, save and show your forms, collect responses, send the emails you asked for (sign-up confirmation, password reset, response and review notifications).",
    "To keep it safe: rate limits, spotting misuse, and investigating problems you report.",
    "We do not sell personal data, we do not show ads, and we do not use your forms or responses to train AI models.",
  ]],
  ["AI features", [
    "AI features (form drafting, the analysis chat and GUUT AI) use your own Claude (Anthropic) or ChatGPT (OpenAI) API key. When you use them, the text you write and the form or response information needed to answer is sent to that provider under your own account with them, and their privacy terms apply.",
    "The analysis chat and GUUT AI send summaries of responses (counts and averages) by default, not individual answers. Sample answers are only sent when you choose to share them for a question.",
    "GUUT AI keeps your conversations so you can reopen them. You can turn off Save chat history in the assistant at any time, delete a single chat, or clear all of them.",
  ]],
  ["Where your data is stored", [
    "Accounts and settings are stored in our database. Forms, responses and files are stored in our hosted database, or in your company's own database if your company connected one. In that case your company controls that data and we only access it to run the app for you.",
    "We use service providers to run GUUT Forms: hosting (Vercel), databases (MongoDB Atlas), email delivery (Brevo), and, when you sign in with them, Google, Microsoft and Apple. They process data only to provide their service to us.",
  ]],
  ["Cookies and browser storage", [
    "We keep your sign-in session and a few preferences (theme, open panels, draft backups) in your browser's local storage. During Google, Microsoft or Apple sign-in we set one short-lived cookie that only confirms the sign-in started in your browser. We use no advertising or tracking cookies.",
  ]],
  ["Sharing", [
    "Your forms are private until you share or publish them. People you share a form with, and your company admins, can see it and its responses according to the access you gave. Forms you list on Explore are visible to everyone.",
    "We share information with authorities only when the law requires it.",
  ]],
  ["Keeping and deleting data", [
    "We keep your content while your account is active. Deleting a form deletes its responses, files and saved analysis chats. To delete your account and its data, email us from your account's address; company accounts are closed by a company admin.",
  ]],
  ["Your choices and rights", [
    "You can see and edit your forms and settings in the app, export responses as CSV or PDF, remove your AI keys, turn notifications off, and ask us for a copy of your personal data, a correction, or deletion. Depending on where you live you may have further rights; contact us and we will help.",
  ]],
  ["Children", [
    "GUUT Forms is not meant for children under 13, and we do not knowingly collect their personal data. Form owners must not use GUUT Forms to collect data from children without the consent the law requires.",
  ]],
  ["Changes", [
    "If we change this policy we will update the date below and, for important changes, tell account holders by email or in the app.",
  ]],
];

export default function PrivacyPage() {
  return (
    <div className="privacy-page">
      <span className="hero-eyebrow"><span className="dot" /> Legal</span>
      <h1>Privacy policy</h1>
      <p className="privacy-updated">Last updated {UPDATED}</p>
      <nav className="privacy-toc" aria-label="Sections">
        {SECTIONS.map(([h], i) => <a key={h} href={`#/privacy`} onClick={(e) => { e.preventDefault(); document.getElementById(`privacy-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{h}</a>)}
      </nav>
      {SECTIONS.map(([h, paras], i) => (
        <section key={h} id={`privacy-${i}`} className="privacy-section">
          <h2>{h}</h2>
          {paras.map((p) => <p key={p.slice(0, 40)}>{p}</p>)}
        </section>
      ))}
      <p className="privacy-contact">Contact: <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    </div>
  );
}

/** Small legal footer for signed-out pages and the sign-in screen. */
export function LegalFooter() {
  return (
    <footer className="legal-foot">
      <span>GUUT Forms</span>
      <a href="#/privacy">Privacy policy</a>
      <a href="#/pricing">Pricing</a>
      <a href="#/about">About</a>
      <button type="button" className="link-quiet" onClick={() => openReport()}>Report a problem</button>
    </footer>
  );
}
