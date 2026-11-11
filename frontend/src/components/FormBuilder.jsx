import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { FIELD_TYPES, newField, validateForm, validateTheme } from "./fields.js";
import FieldEditor from "./FieldEditor.jsx";
import FormRenderer from "./FormRenderer.jsx";
import SharePeopleModal from "./SharePeopleModal.jsx";
import SubmissionsView from "./SubmissionsView.jsx";
import ShareMenu from "./ShareMenu.jsx";
import DesignPanel from "./DesignPanel.jsx";
import { api } from "../api.js";
import { setLeaveGuard } from "../lib/navGuard.js";

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
 * Unsaved changes are tracked: leaving asks first, drafts autosave, and published forms keep a local backup
 * (published forms are never autosaved, so half-finished edits don't go live).
 */
export default function FormBuilder({ draft, formId, onSaved }) {
  const [tab, setTab] = useState("build");
  const [visited, setVisited] = useState({ build: true });
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
  const [notice, setNotice] = useState(() => (formId && ss.get(`guut_flash_${formId}`)) || null); // "published" | "saved"
  const [copied, setCopied] = useState(false);
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

  const selected = fields.find((f) => f.id === selectedId) || null;

  function reorder(newFields) {
    setFields(newFields.map((f, i) => ({ ...f, order: i })));
  }

  function addField(type) {
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
    try {
      // Save first, then publish, and update local state once with the final result.
      let result = id ? await api.updateForm(id, buildPayload()) : await api.createForm(buildPayload());
      if (publish) result = await api.publishForm(result._id);
      afterSave(result, sentSnap);
      setStatus(publish ? "Form published" : "Draft saved");
      if (publish) setNotice("published");
      if (!id) {
        // A new form moves to its own address (and remounts): carry the selection and the notice across.
        ss.set(`guut_sel_${result._id}`, selectedId);
        if (publish) ss.set(`guut_flash_${result._id}`, "published");
        dirtyRef.current = false;
      }
      onSaved?.(result);
    } catch (err) {
      setServerError(err.message);
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
  const copyLink = () => { navigator.clipboard?.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const saveState = readOnly ? null : saving || autoSaving ? "Saving..." : dirty ? (savedForm?.publishedAt ? "Unsaved changes" : id ? "Unsaved changes" : "Not saved yet") : savedAt ? "Saved" : id ? "All changes saved" : null;

  return (
    <div className="workspace">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button onClick={() => { window.location.hash = "/"; }}>Forms</button>
        <span>/</span>
        <strong>{title || "Untitled Form"}</strong>
      </nav>
      <div className="workspace-header">
        <input className="form-title-input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} placeholder="Form title" aria-label="Form title" title={title} />
        <div className="workspace-tabs" role="tablist">
          {[["build", "Build"], ["design", "Design"], ["preview", "Preview"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => go(k)}>{l}</button>
          ))}
          <button role="tab" aria-selected={tab === "responses"} className={tab === "responses" ? "active" : ""} onClick={() => go("responses")} disabled={!savedForm} title={!savedForm ? "Save the form first" : ""}>
            Responses
          </button>
        </div>
        <div className="form-status">
          <span className={`status-pill ${savedForm?.publishedAt ? "published" : "draft"}`}>{savedForm?.publishedAt ? "Published" : "Draft"}</span>
          {savedForm?.publishedAt && isPublic && <span className="status-pill public">Public</span>}
          {status ? <span className="status-toast">{status}</span> : saveState && <span className={`save-state ${dirty ? "dirty" : ""}`} aria-live="polite">{saveState}</span>}
        </div>
        <ShareMenu
          shareUrl={shareUrl} published={!!savedForm?.publishedAt} isPublic={isPublic} listingStatus={listing}
          onTogglePublic={togglePublic} form={savedForm} canManage={canManage} onSharePeople={() => setShareOpen(true)}
        />
      </div>

      {notice === "published" && savedForm?.publishedAt && (
        <div className="publish-notice" role="status">
          <span><strong>Published.</strong> Your form is live. Anyone with the link can respond.</span>
          <span className="publish-notice-actions">
            <button className="primary small" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
            <a className="secondary small btn-link" href={shareUrl} target="_blank" rel="noreferrer">Open</a>
            <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
          </span>
        </div>
      )}
      {backup && (
        <div className="info-banner">
          <span>You have unsaved changes to this form from {new Date(backup.at).toLocaleString()}.</span>
          <span className="publish-notice-actions">
            <button className="primary small" onClick={restoreBackup}>Restore them</button>
            <button className="small" onClick={discardBackup}>Discard</button>
          </span>
        </div>
      )}
      {readOnly && (
        <div className="ro-banner">View only: you can look at this form, its responses and charts, but not change it. Ask the owner for edit access.</div>
      )}

      {tab === "build" && (
        <fieldset disabled={readOnly} className="ro-fieldset">
        <div className="builder">
          <div className="builder-canvas">
            <AutoGrow className="form-desc-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Form description (optional)" rows={2} aria-label="Form description" />

            <div className="field-list">
              {fields.length === 0 && <p className="empty-hint">Add a field from the palette to get started.</p>}
              {fields.map((f, i) => (
                <div
                  key={f.id}
                  ref={(el) => (fieldRefs.current[f.id] = el)}
                  draggable={!readOnly}
                  onDragStart={() => setDragId(f.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropOn(f.id)}
                  onClick={() => setSelectedId(f.id)}
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
              ))}
            </div>

            <div className="palette">
              {FIELD_TYPES.map((t) => (
                <button key={t.type} onClick={() => addField(t.type)}>+ {t.label}</button>
              ))}
            </div>
          </div>

          <div className="builder-sidebar">
            <FieldEditor
              field={selected}
              allFields={fields}
              onChange={updateField}
              onDelete={() => deleteField(selected.id)}
              onDuplicate={() => duplicateField(selected.id)}
            />
            {((showErrors && clientErrors.length > 0) || serverError) && (
              <div className="error-box" role="alert">
                {showErrors && clientErrors.map((e, i) => <p key={i} className="error">{e}</p>)}
                {serverError && <p className="error">{serverError}</p>}
              </div>
            )}
            {!readOnly && (
              <>
                <button className="secondary save-button" disabled={saving} onClick={() => handleSave({ publish: false })}>
                  {saving ? "Saving..." : savedForm?.publishedAt ? "Save (updates the live form)" : "Save draft"}
                </button>
                <button className="primary save-button" disabled={saving} onClick={() => handleSave({ publish: true })}>
                  {saving ? "Publishing..." : savedForm?.publishedAt ? "Republish (save changes live)" : "Publish form"}
                </button>
              </>
            )}
          </div>
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
    </div>
  );
}
