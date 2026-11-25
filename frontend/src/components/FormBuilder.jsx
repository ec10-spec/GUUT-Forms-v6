import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { FIELD_TYPES, newField, validateForm, validateTheme } from "./fields.js";
import FieldEditor from "./FieldEditor.jsx";
import FormRenderer from "./FormRenderer.jsx";
import SharePeopleModal from "./SharePeopleModal.jsx";
import SubmissionsView from "./SubmissionsView.jsx";
import ShareMenu from "./ShareMenu.jsx";
import DesignPanel from "./DesignPanel.jsx";
import ReviewChip from "./ReviewBar.jsx";
import ShareSheet from "./ShareSheet.jsx";
import { askGuutAi } from "../lib/guutAi.js";
import { api } from "../api.js";
import { setLeaveGuard } from "../lib/navGuard.js";

// One line under each question type in the "+ Add question" menu.
const TYPE_HINTS = {
  text: "A short answer, like a name",
  textarea: "A longer answer, like feedback",
  number: "A number, like an age or quantity",
  email: "An email address, checked for you",
  date: "A date from a calendar",
  checkbox: "Pick any number of options",
  select: "Pick exactly one option",
  rating: "A score from 1 to 5 stars",
  file: "An image, PDF or document",
};

const DEFAULT_THEME = { primaryColor: "#001549", backgroundColor: "#f6f7fb", headerImage: null };
const AUTOSAVE_MS = 3000;
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};
const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const snapshotOf = ({ title, description, fields, theme }) => JSON.stringify({ title, description: description || "", fields, theme });
const sortFields = (fs) => [...(fs || [])].sort((a, b) => a.order - b.order);

/** A textarea that grows with its text instead of scrolling. */
function AutoGrow(props) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

/**
 * Single-page workspace for one form: Build / Design / Preview / Responses tabs
 * live here so nothing requires leaving the page. Handles create, edit, publish,
 * theming, the public-repository toggle, and the persistent Share menu.
 * Unsaved changes are tracked: leaving asks first, drafts autosave (a new form is created as soon as it has a
 * question), and published forms keep a local backup: their edits only go live with "Publish changes".
 * One primary action sits in the header: Publish, or Publish changes when a live form has edits.
 */
export default function FormBuilder({ draft, formId, onSaved }) {
  // Opened from a form card's response count: start on Responses.
  const [tab, setTab] = useState(() => {
    const t = formId ? ss.get(`guut_tab_${formId}`) : null;
    if (t) ss.set(`guut_tab_${formId}`, null);
    return t === "responses" ? "responses" : "build";
  });
  const [visited, setVisited] = useState(() => ({ build: true, [tab]: true }));
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description || "");
  const [fields, setFields] = useState(sortFields(draft.fields));
  const [theme, setTheme] = useState({ ...DEFAULT_THEME, ...(draft.theme || {}) });
  const [isPublic, setIsPublic] = useState(!!draft.isPublic);
  const [listing, setListing] = useState(draft.listingStatus || "none");
  const [selectedId, setSelectedId] = useState(() => {
    const keep = ss.get(`guut_sel_${formId || "new"}`);
    return (keep && draft.fields.some((f) => f.id === keep) ? keep : sortFields(draft.fields)[0]?.id) || null;
  });
  const [dragId, setDragId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [savedForm, setSavedForm] = useState(formId ? draft : null);
  const [savedSnap, setSavedSnap] = useState(() => (formId ? snapshotOf({ ...draft, fields: sortFields(draft.fields), theme: { ...DEFAULT_THEME, ...(draft.theme || {}) } }) : null));
  const [savedAt, setSavedAt] = useState(null);
  const [status, setStatus] = useState(null);
  // After the first publish: the "your form is live" sheet with the link, embed code and download.
  const [shareSheet, setShareSheet] = useState(() => !!formId && ss.get(`guut_flash_${formId}`) === "published");
  const [addOpen, setAddOpen] = useState(false);
  const [narrow, setNarrow] = useState(false); // builder too narrow for two columns: edit questions in place
  const workspaceRef = useRef(null);
  const pickedRef = useRef(false); // the person chose a question (or added one) themselves
  const creatingRef = useRef(false);
  const [backup, setBackup] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const fieldRefs = useRef({});
  // Per-form access: owner / admin / editor / viewer. Viewers get a read-only builder.
  const access = savedForm?.myAccess || (savedForm ? null : "owner");
  const readOnly = access === "viewer";
  const canManage = access === "owner" || access === "admin";
  const id = savedForm?._id || formId || null;

  const snap = snapshotOf({ title, description, fields, theme });
  const dirty = !readOnly && (savedSnap === null ? fields.length > 0 || title !== draft.title || description !== (draft.description || "") : snap !== savedSnap);
  const clientErrors = useMemo(() => [...validateForm(title, fields), ...validateTheme(theme)], [title, fields, theme]);

  useEffect(() => { if (formId) ss.set(`guut_flash_${formId}`, null); }, [formId]);
  useEffect(() => { ss.set(`guut_sel_${id || "new"}`, selectedId); }, [selectedId, id]);
  // Errors from the server describe the version that was sent; any edit clears them. Client checks re-run live.
  useEffect(() => { setServerError(null); }, [snap]);

  // Keep publish state in sync if the loaded form is swapped in from the parent.
  useEffect(() => {
    if (draft?._id) {
      setSavedForm(draft);
      setIsPublic(!!draft.isPublic);
      setListing(draft.listingStatus || "none");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?._id, draft?.publishedAt]);

  // Auto-clear the transient "saved / published" confirmation.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(t);
  }, [status]);

  // Ask before leaving with unsaved changes (in-app links and closing the tab).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => setLeaveGuard(() => (dirtyRef.current ? "You have unsaved changes to this form. Leave without saving?" : null)), []);

  // Published forms: keep a local backup of unsaved edits, and offer it back after a reload.
  const backupKey = id ? `guut_draft_${id}` : null;
  useEffect(() => {
    if (!backupKey) return;
    const b = ls.get(backupKey);
    if (b && b.snap !== savedSnap && new Date(b.at) > new Date(draft.updatedAt || 0)) setBackup(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupKey]);
  useEffect(() => {
    if (!backupKey || !savedForm?.publishedAt) return;
    if (!dirty) { ls.set(backupKey, null); return; }
    const t = setTimeout(() => ls.set(backupKey, { snap, at: new Date().toISOString() }), 800);
    return () => clearTimeout(t);
  }, [snap, dirty, backupKey, savedForm?.publishedAt]);

  // GUUT AI: tell the assistant what is on screen (so edits build on unsaved changes too), and apply the
  // changes it proposes when the person clicks Apply. The previous version is kept for one-click Undo.
  const [aiUndo, setAiUndo] = useState(null);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("guut:builder-state", { detail: { formId: id, title, description, fields, readOnly } }));
  }, [id, title, description, fields, readOnly]);
  useEffect(() => () => window.dispatchEvent(new CustomEvent("guut:builder-state", { detail: null })), []);
  const liveRef = useRef({ title, description, fields });
  liveRef.current = { title, description, fields };
  useEffect(() => {
    const onApply = (e) => {
      const d = e.detail || {};
      if (readOnly || (d.formId || null) !== (id || null) || !Array.isArray(d.fields)) return;
      setAiUndo({ ...liveRef.current });
      setTitle(d.title || liveRef.current.title);
      setDescription(d.description ?? liveRef.current.description);
      setFields(sortFields(d.fields.map((f, i) => ({ ...f, order: i }))));
      setTab("build");
    };
    window.addEventListener("guut:assistant-apply", onApply);
    return () => window.removeEventListener("guut:assistant-apply", onApply);
  }, [id, readOnly]);
  function undoAi() {
    if (!aiUndo) return;
    setTitle(aiUndo.title); setDescription(aiUndo.description); setFields(aiUndo.fields);
    setAiUndo(null);
  }

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const isNarrow = e.contentRect.width < 860;
      setNarrow(isNarrow);
      // Narrow: questions are edited in place, so don't open one until the person picks it.
      if (isNarrow && !pickedRef.current) setSelectedId(null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // "+ Add question" menu closes on outside click or Escape.
  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e) => { if (!e.target.closest?.(".add-question")) setAddOpen(false); };
    const onKey = (e) => e.key === "Escape" && setAddOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [addOpen]);
  const titleRef = useRef(null);
  useEffect(() => {
    // A brand-new blank form: put the cursor in the title so naming it is the obvious first step.
    if (!formId && !draft.fields?.length) setTimeout(() => { titleRef.current?.focus(); titleRef.current?.select(); }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = fields.find((f) => f.id === selectedId) || null;

  function reorder(newFields) {
    setFields(newFields.map((f, i) => ({ ...f, order: i })));
  }

  function addField(type) {
    setAddOpen(false);
    pickedRef.current = true;
    const f = newField(type, fields.length);
    setFields([...fields, f]);
    setSelectedId(f.id);
    setTimeout(() => fieldRefs.current[f.id]?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
  }

  function updateField(updated) {
    setFields(fields.map((f) => (f.id === updated.id ? updated : f)));
  }

  function deleteField(fid) {
    // Questions that depended on this one go back to "always show".
    setFields(fields.filter((f) => f.id !== fid).map((f) => (f.showIf?.fieldId === fid ? { ...f, showIf: { fieldId: null, op: "eq", equals: null, values: [] } } : f)).map((f, i) => ({ ...f, order: i })));
    if (selectedId === fid) setSelectedId(null);
  }

  function duplicateField(fid) {
    const f = fields.find((x) => x.id === fid);
    const at = fields.findIndex((x) => x.id === fid);
    const copy = { ...f, id: `${f.id}_copy_${Date.now()}` };
    const next = [...fields];
    next.splice(at + 1, 0, copy);
    reorder(next);
    setSelectedId(copy.id);
  }

  function move(fid, delta) {
    const from = fields.findIndex((f) => f.id === fid);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= fields.length) return;
    const next = [...fields];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    reorder(next);
  }

  function handleDropOn(targetId) {
    if (!dragId || dragId === targetId) return;
    const from = fields.findIndex((f) => f.id === dragId);
    const to = fields.findIndex((f) => f.id === targetId);
    const next = [...fields];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorder(next);
    setDragId(null);
  }

  function buildPayload(overrides = {}) {
    return {
      title, description, fields, theme, isPublic,
      source: draft.source === "ai_generated" ? "ai_generated_edited" : draft.source,
      generationPrompt: draft.generationPrompt || null,
      ...overrides,
    };
  }

  const afterSave = useCallback((result, sentSnap) => {
    setSavedForm(result);
    setSavedSnap(sentSnap);
    setSavedAt(new Date());
    if (backupKey) ls.set(backupKey, null);
  }, [backupKey]);

  async function handleSave({ publish } = {}) {
    if (clientErrors.length) { setShowErrors(true); return; }
    setShowErrors(false);
    setServerError(null);
    setSaving(true);
    const sentSnap = snap;
    const creating = !id;
    if (creating) creatingRef.current = true;
    try {
      // Save first, then publish, and update local state once with the final result.
      let result = id ? await api.updateForm(id, buildPayload()) : await api.createForm(buildPayload());
      if (publish) result = await api.publishForm(result._id);
      const firstPublish = publish && !savedForm?.publishedAt;
      afterSave(result, sentSnap);
      setStatus(publish ? (firstPublish ? "Published" : "Changes are live") : "Saved");
      if (firstPublish) setShareSheet(true);
      if (!id) {
        // A new form gets its own address; the builder stays as it is (see App.jsx).
        ss.set(`guut_sel_${result._id}`, selectedId);
        dirtyRef.current = false;
      }
      onSaved?.(result);
    } catch (err) {
      setServerError(err.message);
      if (creating && !savedForm) creatingRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  // Autosave drafts that are not published yet, a few seconds after the last change.
  useEffect(() => {
    if (!id || savedForm?.publishedAt || readOnly || !dirty || saving || clientErrors.length) return;
    const t = setTimeout(async () => {
      const sentSnap = snap;
      setAutoSaving(true);
      try {
        const result = await api.updateForm(id, buildPayload());
        afterSave(result, sentSnap);
        onSaved?.(result);
      } catch (err) { setServerError(err.message); }
      finally { setAutoSaving(false); }
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, id, savedForm?.publishedAt, readOnly, saving, clientErrors.length]);

  // A new form is created on the server once it has a question, so nothing is lost if the tab closes.
  useEffect(() => {
    if (id || readOnly || !fields.length || saving || clientErrors.length || creatingRef.current) return;
    const t = setTimeout(async () => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      const sentSnap = snap;
      setAutoSaving(true);
      try {
        const result = await api.createForm(buildPayload());
        afterSave(result, sentSnap);
        ss.set(`guut_sel_${result._id}`, selectedId);
        dirtyRef.current = false;
        onSaved?.(result);
      } catch (err) { setServerError(err.message); creatingRef.current = false; }
      finally { setAutoSaving(false); }
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, id, readOnly, saving, clientErrors.length]);

  // Published forms: drop unpublished edits and go back to what is live.
  function discardChanges() {
    if (!savedSnap || !confirm("Discard your changes and go back to the live version?")) return;
    try {
      const b = JSON.parse(savedSnap);
      setTitle(b.title); setDescription(b.description || ""); setFields(sortFields(b.fields)); setTheme({ ...DEFAULT_THEME, ...b.theme });
    } catch { /* keep what is on screen */ }
    if (backupKey) ls.set(backupKey, null);
  }

  function restoreBackup() {
    try {
      const b = JSON.parse(backup.snap);
      setTitle(b.title); setDescription(b.description); setFields(sortFields(b.fields)); setTheme({ ...DEFAULT_THEME, ...b.theme });
    } catch { /* corrupt backup */ }
    setBackup(null);
  }
  function discardBackup() { if (backupKey) ls.set(backupKey, null); setBackup(null); }

  // Toggle whether a published form is listed in the public repository. Persists immediately.
  async function togglePublic(next) {
    if (!savedForm) return;
    setIsPublic(next);
    try {
      const saved = await api.updateForm(savedForm._id, buildPayload({ isPublic: next }));
      afterSave(saved, snap);
      setIsPublic(!!saved.isPublic);
      setListing(saved.listingStatus || "none");
      onSaved?.(saved);
    } catch (err) {
      setServerError(err.message);
      setIsPublic(!next);
    }
  }

  // Header image uploads are saved on the server straight away.
  function onHeaderSaved(result) {
    const nextTheme = { ...theme, headerImage: result.headerImage };
    setTheme(nextTheme);
    if (savedSnap) {
      try { const s = JSON.parse(savedSnap); s.theme = { ...s.theme, headerImage: result.headerImage }; setSavedSnap(JSON.stringify(s)); } catch { /* ignore */ }
    }
    if (result.form) { setSavedForm((f) => ({ ...f, ...result.form })); onSaved?.({ ...savedForm, ...result.form }); }
  }

  const shareUrl = api.shareUrl(savedForm?._id || "pending");
  const go = (t) => { setTab(t); setVisited((v) => ({ ...v, [t]: true })); };
  const live = !!savedForm?.publishedAt;
  const busyAny = saving || autoSaving;
  const saveState = readOnly ? null : busyAny ? "Saving..." : live ? (dirty ? "Edits not live yet" : null) : dirty ? (id ? "Unsaved changes" : fields.length ? "Not saved yet" : null) : id ? "Saved" : null;
  const errorsShown = (showErrors && clientErrors.length > 0) || serverError;

  // One banner at most, the most important one.
  const banner = readOnly
    ? <div className="ro-banner">View only: you can look at this form, its responses and charts, but not change it. Ask the owner for edit access.</div>
    : backup ? (
      <div className="info-banner">
        <span>You have unsaved changes to this form from {new Date(backup.at).toLocaleString()}.</span>
        <span className="publish-notice-actions">
          <button className="primary small" onClick={restoreBackup}>Restore them</button>
          <button className="small" onClick={discardBackup}>Discard</button>
        </span>
      </div>
    ) : aiUndo ? (
      <div className="info-banner ai-applied" role="status">
        <span><strong>GUUT AI updated this form.</strong> {live ? "Check the questions, then Publish changes to make them live." : "Check the questions. Changes save automatically."}</span>
        <span className="publish-notice-actions">
          <button className="small" onClick={undoAi}>Undo</button>
          <button className="icon-btn" onClick={() => setAiUndo(null)} aria-label="Dismiss">✕</button>
        </span>
      </div>
    ) : null;

  const editorFor = (f) => (
    <FieldEditor
      field={f}
      allFields={fields}
      onChange={updateField}
      onDelete={() => deleteField(f.id)}
      onDuplicate={() => duplicateField(f.id)}
    />
  );

  return (
    <div className="workspace" ref={workspaceRef}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <button onClick={() => { window.location.hash = "/"; }}>Forms</button>
        <span>/</span>
        <strong>{title || "Untitled form"}</strong>
      </nav>
      <div className="workspace-header">
        <input ref={titleRef} className="form-title-input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} placeholder="Name your form" aria-label="Form title" title={title} />
        <div className="workspace-tabs" role="tablist">
          {[["build", "Build"], ["design", "Design"], ["preview", "Preview"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => go(k)}>{l}</button>
          ))}
          <button role="tab" aria-selected={tab === "responses"} className={tab === "responses" ? "active" : ""} onClick={() => go("responses")} disabled={!savedForm} title={!savedForm ? "Add a question first: the form saves itself" : ""}>
            Responses
          </button>
        </div>
        <div className="form-status">
          <span className={`status-pill ${live ? "published" : "draft"}`}>{live ? "Live" : "Draft"}</span>
          {live && isPublic && <span className="status-pill public">On Explore</span>}
          {savedForm?._id && <ReviewChip key={`review-${shareOpen}`} formId={savedForm._id} dirty={dirty} updatedAt={savedForm.updatedAt} />}
          {status ? <span className="status-toast">{status}</span> : saveState && <span className={`save-state ${dirty ? "dirty" : ""}`} aria-live="polite">{saveState}</span>}
        </div>
        <div className="workspace-actions">
          <ShareMenu
            shareUrl={shareUrl} published={live} isPublic={isPublic} listingStatus={listing}
            onTogglePublic={togglePublic} form={savedForm} canManage={canManage} onSharePeople={() => setShareOpen(true)}
          />
          {!readOnly && !live && (
            <button className="primary publish-btn" disabled={saving || (autoSaving && !id)} onClick={() => handleSave({ publish: true })}>
              {saving ? "Publishing..." : "Publish"}
            </button>
          )}
          {!readOnly && live && dirty && (
            <>
              <button className="link-btn" disabled={saving} onClick={discardChanges}>Discard</button>
              <button className="primary publish-btn" disabled={saving} onClick={() => handleSave({ publish: true })}>
                {saving ? "Publishing..." : "Publish changes"}
              </button>
            </>
          )}
        </div>
      </div>

      {errorsShown && (
        <div className="error-box" role="alert">
          {showErrors && clientErrors.map((e, i) => <p key={i} className="error">{e}</p>)}
          {serverError && <p className="error">{serverError}</p>}
        </div>
      )}
      {banner}

      {tab === "build" && (
        <fieldset disabled={readOnly} className="ro-fieldset">
        <div className={`builder ${selected && !narrow ? "" : "single"}`}>
          <div className="builder-canvas">
            <AutoGrow className="form-desc-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description, shown under the title (optional)" rows={2} aria-label="Form description" />

            {fields.length === 0 && !readOnly && (
              <div className="empty-builder">
                <h2>How do you want to start?</h2>
                <div className="empty-builder-choices">
                  <button type="button" className="empty-choice" onClick={() => askGuutAi(`Draft the questions for this form: ${title && title !== "Untitled Form" ? title : ""}`.trim())}>
                    <strong>Describe it to GUUT AI</strong><span>Say what you need. GUUT AI suggests the questions and you apply them.</span>
                  </button>
                  <button type="button" className="empty-choice" onClick={() => { ss.set("guut_open_templates", "1"); window.location.hash = "/"; }}>
                    <strong>Pick a template</strong><span>Start from a ready-made form and adjust it.</span>
                  </button>
                  <button type="button" className="empty-choice" onClick={() => setAddOpen(true)}>
                    <strong>Add your first question</strong><span>Build it yourself, one question at a time.</span>
                  </button>
                </div>
              </div>
            )}

            <div className="field-list">
              {fields.map((f, i) => (
                <React.Fragment key={f.id}>
                  <div
                    ref={(el) => (fieldRefs.current[f.id] = el)}
                    draggable={!readOnly}
                    onDragStart={() => setDragId(f.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDropOn(f.id)}
                    onClick={() => { pickedRef.current = true; setSelectedId(f.id); }}
                    className={`field-card ${selectedId === f.id ? "selected" : ""}`}
                  >
                    <span className="drag-handle" aria-hidden="true">⠿</span>
                    <div className="field-preview">
                      <label>
                        {f.label}
                        {f.required && <span className="required-mark">*</span>}
                      </label>
                      {f.type === "text" && <input disabled placeholder={f.placeholder} aria-label={f.label} />}
                      {f.type === "textarea" && <textarea disabled placeholder={f.placeholder} rows={2} aria-label={f.label} />}
                      {f.type === "number" && <input disabled type="number" placeholder={f.placeholder} aria-label={f.label} />}
                      {f.type === "email" && <input disabled type="email" placeholder={f.placeholder} aria-label={f.label} />}
                      {f.type === "date" && <input disabled type="date" aria-label={f.label} />}
                      {f.type === "checkbox" && (
                        <div className="checkbox-group">
                          {f.options.map((o) => <label key={o} className="checkbox-option"><input type="checkbox" disabled aria-label={o} /><span>{o}</span></label>)}
                        </div>
                      )}
                      {f.type === "select" && <select disabled aria-label={f.label}>{f.options.map((o) => <option key={o}>{o}</option>)}</select>}
                      {f.type === "rating" && <div className="rating-group" aria-label="Rating from 1 to 5">{[1, 2, 3, 4, 5].map((n) => <span key={n} className="rating-star" aria-hidden="true">★</span>)}</div>}
                      {f.type === "file" && <span className="file-button disabled">Choose a file</span>}
                      {f.showIf?.fieldId && <span className="logic-badge">Shown only if a condition is met</span>}
                    </div>
                    {!readOnly && (
                      <div className="move-btns">
                        <button type="button" className="icon-btn" onClick={(e) => { e.stopPropagation(); move(f.id, -1); }} disabled={i === 0} aria-label={`Move "${f.label}" up`}>↑</button>
                        <button type="button" className="icon-btn" onClick={(e) => { e.stopPropagation(); move(f.id, 1); }} disabled={i === fields.length - 1} aria-label={`Move "${f.label}" down`}>↓</button>
                      </div>
                    )}
                  </div>
                  {narrow && selectedId === f.id && !readOnly && <div className="inline-editor">{editorFor(f)}</div>}
                </React.Fragment>
              ))}
            </div>

            {!readOnly && (
              <div className="add-question">
                <button type="button" className="secondary add-question-btn" onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen} aria-haspopup="menu">+ Add question</button>
                {addOpen && (
                  <div className="add-question-menu" role="menu">
                    {FIELD_TYPES.map((t) => (
                      <button key={t.type} type="button" role="menuitem" onClick={() => addField(t.type)}>
                        <strong>{t.label}</strong><span>{TYPE_HINTS[t.type]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {selected && !narrow && (
            <div className="builder-sidebar">
              {editorFor(selected)}
            </div>
          )}
        </div>
        </fieldset>
      )}

      {tab === "design" && (
        <fieldset disabled={readOnly} className="ro-fieldset">
          <DesignPanel theme={theme} onChange={setTheme} formId={savedForm?._id || null} onHeaderSaved={onHeaderSaved} errors={validateTheme(theme)}
            form={{ _id: savedForm?._id || "preview", title, description, fields }} />
        </fieldset>
      )}

      {tab === "preview" && (
        <div className="preview-tab">
          <FormRenderer form={{ _id: savedForm?._id || "preview", title, description, fields, theme }} previewOnly={!savedForm} />
        </div>
      )}

      {/* Stays mounted once opened, so the AI chat and filters survive switching tabs. */}
      {savedForm && visited.responses && (
        <div hidden={tab !== "responses"}><SubmissionsView form={savedForm} /></div>
      )}

      {shareOpen && savedForm && <SharePeopleModal form={savedForm} onClose={() => setShareOpen(false)} />}
      {shareSheet && live && (
        <ShareSheet
          form={savedForm} shareUrl={shareUrl} canManage={canManage}
          onSharePeople={() => { setShareSheet(false); setShareOpen(true); }}
          onClose={() => { setShareSheet(false); if (savedForm?._id) ss.set(`guut_flash_${savedForm._id}`, null); }}
        />
      )}
    </div>
  );
}
