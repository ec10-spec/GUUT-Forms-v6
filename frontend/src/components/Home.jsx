import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import TemplateGallery from "./TemplateGallery.jsx";
import AiSuggestions from "./AiSuggestions.jsx";
import TeamAccess from "./TeamAccess.jsx";
import Icon from "./Icon.jsx";
import { TEMPLATES, draftFromTemplate } from "../lib/templates.js";
import { PENDING_PROMPT_KEY } from "./LandingPage.jsx";
import { relTime, fullDate, num } from "../lib/relTime.js";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ss = {
  take: (k) => { try { const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};
// Response counts seen when each form was last opened, for "+N new" on the cards.
const SEEN_KEY = "guut_seen_counts";
const seenCounts = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; } };
const markSeen = (id, count) => { try { const s = seenCounts(); s[id] = count; localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
export const GEN_TOKENS_KEY = "guut_gen_max_tokens";
const genMaxTokens = () => { const n = Number((() => { try { return localStorage.getItem(GEN_TOKENS_KEY); } catch { return null; } })()); return Number.isFinite(n) && n >= 200 ? Math.min(n, 3000) : 1000; };

// Templates shown on the start screen (first of each category, then the rest).
const STARTERS = (() => {
  const seen = new Set();
  const first = TEMPLATES.filter((t) => (seen.has(t.category) ? false : seen.add(t.category)));
  return [...first, ...TEMPLATES.filter((t) => !first.includes(t))].slice(0, 6);
})();

/**
 * Forms home. New accounts get one focused start screen (describe it, pick a template, or start blank).
 * Once there are forms, the list comes first with a slim "describe a new form" bar above it.
 */
export default function Home({ user, onOpenDraft, onOpenForm }) {
  const [prompt, setPrompt] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [budget, setBudget] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genNeedsKey, setGenNeedsKey] = useState(false);
  const [suggested, setSuggested] = useState(null);
  const [galleryOpen, setGalleryOpen] = useState(() => ss.take("guut_open_templates") === "1");

  const [forms, setForms] = useState([]);
  const [q, setQ] = useState("");
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [copiedFor, setCopiedFor] = useState(null);
  const searchRef = useRef(null);
  const pendingPrompt = useRef(ss.take(PENDING_PROMPT_KEY));

  useEffect(() => {
    api.getAiBudget().then(setBudget).catch(() => setBudget({ aiReady: false }));
    loadForms();
    if (pendingPrompt.current) setPrompt(pendingPrompt.current);
  }, []);
  // A visitor who described a form on the landing page gets it drafted right after signing up.
  useEffect(() => {
    if (pendingPrompt.current && budget?.aiReady) { const p = pendingPrompt.current; pendingPrompt.current = null; generate(p); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget?.aiReady]);
  // "/" jumps to the search box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (searchRef.current) { e.preventDefault(); searchRef.current.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e) => { if (!e.target.closest?.(".card-menu")) setMenuFor(null); };
    const onKey = (e) => e.key === "Escape" && setMenuFor(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [menuFor]);

  async function loadForms(query = "") {
    setLoadingForms(true);
    try {
      setForms(await api.listForms(query));
      setFormsError(null);
    } catch (err) {
      setFormsError(err.code === "NO_COMPANY_DB" ? null : err.message);
      if (err.code === "NO_COMPANY_DB") setForms([]);
    } finally {
      setLoadingForms(false);
    }
  }

  async function handleAttachmentChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    const kind = file.type === "application/pdf" ? "pdf"
      : file.type.startsWith("image/") ? "image"
      : ext === "xlsx" || ext === "xls" || file.type.includes("spreadsheet") || file.type === "application/vnd.ms-excel" ? "spreadsheet"
      : ext === "csv" || ext === "txt" || file.type === "text/csv" || file.type === "text/plain" ? "text"
      : null;
    if (file.size > 3 * 1024 * 1024) { setGenError("That file is over 3 MB. Attach a smaller file."); return; }
    if (!kind) { setGenError("Attach an image, a PDF, an Excel or CSV file, or a text file."); return; }
    setGenError(null);
    setAttachment({ file, mediaType: file.type, kind });
  }

  async function generate(text = prompt) {
    if (!String(text).trim() || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      let attachmentPayload = null;
      if (attachment) {
        const base64 = await fileToBase64(attachment.file);
        attachmentPayload = { base64, mediaType: attachment.mediaType, kind: attachment.kind, filename: attachment.file.name };
      }
      const { draft, tokenBudget } = await api.generateForm(text, { maxTokens: genMaxTokens(), attachment: attachmentPayload });
      setBudget(tokenBudget);
      setSuggested({ ...draft, generationPrompt: text });
    } catch (err) {
      setGenError(err.message);
      setGenNeedsKey(["NO_API_KEY", "BAD_API_KEY", "CREDIT_EXHAUSTED"].includes(err.code));
    } finally {
      setGenerating(false);
    }
  }

  const blank = () => onOpenDraft({ title: "Untitled Form", description: "", fields: [], source: "manual", generationPrompt: null });
  const aiOff = budget?.aiReady === false;

  function open(f, tab) {
    markSeen(f._id, f.responseCount || 0);
    if (tab) ss.set(`guut_tab_${f._id}`, tab);
    onOpenForm(f);
  }
  async function remove(f) {
    setMenuFor(null);
    if (!confirm(`Delete "${f.title}" and all of its responses? This can't be undone.`)) return;
    try { await api.deleteForm(f._id); } catch (err) { setFormsError(err.message); }
    loadForms(q);
  }
  async function duplicate(f) {
    setMenuFor(null);
    try { await api.duplicateForm(f._id); loadForms(q); } catch (err) { setFormsError(err.message); }
  }
  function copyLink(f) {
    setMenuFor(null);
    try { navigator.clipboard?.writeText(api.shareUrl(f._id)); setCopiedFor(f._id); setTimeout(() => setCopiedFor(null), 1500); } catch { /* clipboard blocked */ }
  }

  if (suggested) {
    return (
      <AiSuggestions
        title={suggested.title}
        description={suggested.description}
        fields={suggested.fields}
        onDiscard={() => setSuggested(null)}
        onConfirm={(finalDraft) => onOpenDraft({ ...finalDraft, source: "ai_generated", generationPrompt: suggested.generationPrompt })}
      />
    );
  }

  const describeBar = (
    <div className="describe">
      <form className="describe-bar" onSubmit={(e) => { e.preventDefault(); generate(); }}>
        <Icon name="spark" size={18} className="describe-icon" />
        <input
          value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={8000}
          placeholder="Describe a form, for example: a quote request with product choices and a summary"
          aria-label="Describe the form you need"
        />
        <label className="icon-btn describe-attach" title="Attach a file (image, PDF, Excel, CSV)">
          <Icon name="clip" size={18} />
          <span className="sr-only">Attach a file</span>
          <input type="file" hidden accept="image/*,application/pdf,.xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain" onChange={handleAttachmentChange} />
        </label>
        <button className="primary" type="submit" disabled={generating || !prompt.trim() || aiOff} aria-describedby="describe-hint">
          {generating ? "Drafting..." : "Draft it"}
        </button>
      </form>
      <div className="describe-foot" id="describe-hint">
        {attachment && <span className="attach-name">Attached: {attachment.file.name} <button className="link-btn" onClick={() => setAttachment(null)}>Remove</button></span>}
        {aiOff ? (
          <span>To draft with GUUT AI, <a href="#/settings/ai">add your AI key</a>. Or start from a template.</span>
        ) : budget?.aiReady ? <span>GUUT AI drafts the questions. You review them before anything is saved.</span> : null}
      </div>
      {genError && (
        <div className="hero-error light" role="alert">
          {genError}{" "}
          {genNeedsKey && <a href="#/settings/ai">Open Settings, AI</a>}
        </div>
      )}
    </div>
  );

  const templateGrid = (limit) => (
    <div className="starter-grid">
      {STARTERS.slice(0, limit).map((t) => (
        <button key={t.id} className="starter-card" onClick={() => onOpenDraft(draftFromTemplate(t))}>
          <span className="gallery-cat">{t.category}</span>
          <strong>{t.name}</strong>
          <span className="starter-blurb">{t.blurb}</span>
          <span className="gallery-meta">{t.fields.length} questions</span>
        </button>
      ))}
    </div>
  );

  const firstRun = !loadingForms && !formsError && forms.length === 0 && !q;

  if (firstRun) {
    return (
      <div className="home start">
        <TeamAccess user={user} onChanged={() => loadForms(q)} />
        <section className="start-screen">
          <h1>Create your first form</h1>
          <p className="start-sub">Describe it and GUUT AI drafts it, or start from a template.</p>
          {describeBar}
          <div className="start-templates">
            <div className="start-templates-head">
              <h2>Or start from a template</h2>
              <button className="link-btn" onClick={() => setGalleryOpen(true)}>See all templates</button>
            </div>
            {templateGrid(6)}
            <p className="start-blank">or <button className="link-btn" onClick={blank}>start with a blank form</button></p>
          </div>
        </section>
        {galleryOpen && <TemplateGallery onClose={() => setGalleryOpen(false)} onPick={(d) => { setGalleryOpen(false); onOpenDraft(d); }} />}
      </div>
    );
  }

  const seen = seenCounts();
  return (
    <div className="home">
      <div className="home-head">
        <h1>Forms</h1>
        <div className="home-head-tools">
          <span className="search-field">
            <Icon name="search" size={16} />
            <input
              ref={searchRef} placeholder="Search forms" value={q} aria-label="Search forms"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadForms(q)}
            />
            <kbd aria-hidden="true">/</kbd>
          </span>
          <button className="secondary" onClick={() => setGalleryOpen(true)}>Templates</button>
        </div>
      </div>

      {describeBar}
      <TeamAccess user={user} onChanged={() => loadForms(q)} />

      <section className="your-forms" aria-label="Your forms">
        {formsError && <p className="error">{formsError}</p>}
        {loadingForms ? (
          <div className="forms-grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</div>
        ) : forms.length === 0 ? (
          <div className="empty-state">
            <h3>No forms match that search</h3>
            <p>Try a different word, or <button className="link-btn" onClick={() => { setQ(""); loadForms(""); }}>clear the search</button>.</p>
          </div>
        ) : (
          <div className="forms-grid">
            {forms.map((f) => {
              const count = f.responseCount;
              const fresh = Number.isFinite(count) && seen[f._id] !== undefined ? Math.max(0, count - seen[f._id]) : 0;
              const manage = f.myAccess === "owner" || f.myAccess === "admin";
              const live = !!f.publishedAt;
              return (
                <div key={f._id} className="form-card" onClick={() => open(f)} tabIndex={0} role="link" aria-label={`Open ${f.title}`} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open(f)}>
                  <div className="card-top">
                    <span className={`status-pill ${live ? "published" : "draft"}`}>{live ? "Live" : "Draft"}</span>
                    {f.isPublic && live && <span className="status-pill public">On Explore</span>}
                    <span className="card-menu" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" aria-label={`Actions for ${f.title}`} aria-haspopup="menu" aria-expanded={menuFor === f._id} onClick={() => setMenuFor(menuFor === f._id ? null : f._id)}>
                        <span className="dots" aria-hidden="true">•••</span>
                      </button>
                      {menuFor === f._id && (
                        <div className="card-menu-list" role="menu">
                          <button role="menuitem" onClick={() => { setMenuFor(null); open(f); }}>Open</button>
                          {live && <button role="menuitem" onClick={() => copyLink(f)}>Copy link</button>}
                          <button role="menuitem" onClick={() => duplicate(f)}>Duplicate</button>
                          {manage && <button role="menuitem" className="danger-text" onClick={() => remove(f)}>Delete</button>}
                        </div>
                      )}
                    </span>
                  </div>
                  <h3>{f.title}</h3>
                  {(f.myAccess === "editor" || f.myAccess === "viewer") && (
                    <span className="access-badge">Shared with you{f.ownerName ? ` by ${f.ownerName}` : ""}: {f.myAccess === "editor" ? "can edit" : "can view"}</span>
                  )}
                  {f.myAccess === "admin" && f.ownerName && <span className="access-badge subtle">Created by {f.ownerName}</span>}
                  <div className="card-stats">
                    {Number.isFinite(count) ? (
                      <button className="card-count" onClick={(e) => { e.stopPropagation(); open(f, "responses"); }} title="Open responses">
                        <strong>{num(count)}</strong> {count === 1 ? "response" : "responses"}
                        {fresh > 0 && <span className="new-pill">+{num(fresh)} new</span>}
                      </button>
                    ) : <span className="form-meta">{f.fields.length} {f.fields.length === 1 ? "question" : "questions"}</span>}
                  </div>
                  <div className="card-foot">
                    <span className="form-meta" title={fullDate(f.lastResponseAt || f.updatedAt)}>
                      {f.lastResponseAt ? `Last response ${relTime(f.lastResponseAt)}` : `Edited ${relTime(f.updatedAt || f.createdAt)}`}
                    </span>
                    {copiedFor === f._id && <span className="form-meta">Link copied</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="home-templates" aria-label="Templates">
        <div className="start-templates-head">
          <h2>Start from a template</h2>
          <button className="link-btn" onClick={() => setGalleryOpen(true)}>See all</button>
        </div>
        {templateGrid(3)}
      </section>
      {galleryOpen && <TemplateGallery onClose={() => setGalleryOpen(false)} onPick={(d) => { setGalleryOpen(false); onOpenDraft(d); }} />}
    </div>
  );
}
