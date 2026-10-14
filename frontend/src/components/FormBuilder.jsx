import React, { useState, useEffect } from "react";
import { FIELD_TYPES, newField, validateForm } from "./fields.js";
import FieldEditor from "./FieldEditor.jsx";
import FormRenderer from "./FormRenderer.jsx";
import SharePeopleModal from "./SharePeopleModal.jsx";
import SubmissionsView from "./SubmissionsView.jsx";
import ShareMenu from "./ShareMenu.jsx";
import DesignPanel from "./DesignPanel.jsx";
import { api } from "../api.js";

const DEFAULT_THEME = { primaryColor: "#001549", backgroundColor: "#f6f7fb", headerImage: null };

/**
 * Single-page workspace for one form: Build / Design / Preview / Responses tabs
 * live here so nothing requires leaving the page. Handles create, edit, publish,
 * theming, the public-repository toggle, and the persistent Share menu.
 */
export default function FormBuilder({ draft, formId, onSaved }) {
  const [tab, setTab] = useState("build");
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description || "");
  const [fields, setFields] = useState([...draft.fields].sort((a, b) => a.order - b.order));
  const [theme, setTheme] = useState({ ...DEFAULT_THEME, ...(draft.theme || {}) });
  const [isPublic, setIsPublic] = useState(!!draft.isPublic);
  const [listing, setListing] = useState(draft.listingStatus || "none");
  const [selectedId, setSelectedId] = useState(fields[0]?.id || null);
  const [dragId, setDragId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [savedForm, setSavedForm] = useState(formId ? draft : null);
  const [status, setStatus] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Per-form access: owner / admin / editor / viewer. Viewers get a read-only builder.
  const access = savedForm?.myAccess || (savedForm ? null : "owner");
  const readOnly = access === "viewer";
  const canManage = access === "owner" || access === "admin";

  // Keep publish state in sync if the loaded form is swapped in from the parent
  // (e.g. after navigation). Only touches saved/published state, never the
  // fields being edited.
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

  const selected = fields.find((f) => f.id === selectedId) || null;

  function reorder(newFields) {
    setFields(newFields.map((f, i) => ({ ...f, order: i })));
  }

  function addField(type) {
    const f = newField(type, fields.length);
    setFields([...fields, f]);
    setSelectedId(f.id);
  }

  function updateField(updated) {
    setFields(fields.map((f) => (f.id === updated.id ? updated : f)));
  }

  function deleteField(id) {
    setFields(fields.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function duplicateField(id) {
    const f = fields.find((x) => x.id === id);
    const copy = { ...f, id: `${f.id}_copy_${Date.now()}`, order: fields.length };
    setFields([...fields, copy]);
    setSelectedId(copy.id);
  }

  function handleDropOn(targetId) {
    if (dragId === targetId) return;
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
      title,
      description,
      fields,
      theme,
      isPublic,
      source: draft.source === "ai_generated" ? "ai_generated_edited" : draft.source,
      generationPrompt: draft.generationPrompt || null,
      ...overrides,
    };
  }

  async function handleSave({ publish } = {}) {
    const clientErrors = validateForm(title, fields);
    if (clientErrors.length) {
      setErrors(clientErrors);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const id = savedForm?._id || formId;
      // Save first, then publish, and update local state exactly once with the
      // final result. Doing both before calling onSaved avoids a mid-flow
      // remount that used to strand the builder on the pre-publish copy.
      let result = id ? await api.updateForm(id, buildPayload()) : await api.createForm(buildPayload());
      if (publish) {
        result = await api.publishForm(result._id);
      }
      setSavedForm(result);
      setStatus(publish ? "Form published" : "Draft saved");
      onSaved?.(result);
    } catch (err) {
      setErrors([err.message]);
    } finally {
      setSaving(false);
    }
  }

  // Toggle whether a published form is listed in the public repository. Persists
  // immediately; reverts the switch if the save fails.
  async function togglePublic(next) {
    if (!savedForm) return;
    setIsPublic(next);
    try {
      const saved = await api.updateForm(savedForm._id, buildPayload({ isPublic: next }));
      setSavedForm(saved);
      setIsPublic(!!saved.isPublic);
      setListing(saved.listingStatus || "none");
      onSaved?.(saved);
    } catch (err) {
      setErrors([err.message]);
      setIsPublic(!next);
    }
  }

  const shareUrl = api.shareUrl(savedForm?._id || "pending");

  return (
    <div className="workspace">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button onClick={() => { window.location.hash = "/"; }}>Forms</button>
        <span>/</span>
        <strong>{title || "Untitled Form"}</strong>
      </nav>
      <div className="workspace-header">
        <input
          className="form-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={readOnly}
          placeholder="Form title"
        />
        <div className="workspace-tabs">
          <button className={tab === "build" ? "active" : ""} onClick={() => setTab("build")}>Build</button>
          <button className={tab === "design" ? "active" : ""} onClick={() => setTab("design")}>Design</button>
          <button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>Preview</button>
          <button
            className={tab === "responses" ? "active" : ""}
            onClick={() => setTab("responses")}
            disabled={!savedForm}
            title={!savedForm ? "Save the form first" : ""}
          >
            Responses
          </button>
        </div>
        <div className="form-status">
          <span className={`status-pill ${savedForm?.publishedAt ? "published" : "draft"}`}>
            {savedForm?.publishedAt ? "Published" : "Draft"}
          </span>
          {savedForm?.publishedAt && isPublic && <span className="status-pill public">Public</span>}
          {status && <span className="status-toast">{status}</span>}
        </div>
        <ShareMenu
          shareUrl={shareUrl}
          published={!!savedForm?.publishedAt}
          isPublic={isPublic}
          listingStatus={listing}
          onTogglePublic={togglePublic}
          form={savedForm}
          canManage={canManage}
          onSharePeople={() => setShareOpen(true)}
        />
      </div>

      {readOnly && (
        <div className="ro-banner">View only: you can look at this form, its responses and charts, but not change it. Ask the owner for edit access.</div>
      )}

      {tab === "build" && (
        <fieldset disabled={readOnly} className="ro-fieldset">
        <div className="builder">
          <div className="builder-canvas">
            <textarea
              className="form-desc-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Form description (optional)"
              rows={2}
            />

            <div className="field-list">
              {fields.length === 0 && <p className="empty-hint">Add a field from the palette to get started.</p>}
              {fields.map((f) => (
                <div
                  key={f.id}
                  draggable={!readOnly}
                  onDragStart={() => setDragId(f.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropOn(f.id)}
                  onClick={() => setSelectedId(f.id)}
                  className={`field-card ${selectedId === f.id ? "selected" : ""}`}
                >
                  <span className="drag-handle">⠿</span>
                  <div className="field-preview">
                    <label>
                      {f.label}
                      {f.required && <span className="required-mark">*</span>}
                    </label>
                    {f.type === "text" && <input disabled placeholder={f.placeholder} />}
                    {f.type === "textarea" && <textarea disabled placeholder={f.placeholder} rows={2} />}
                    {f.type === "number" && <input disabled type="number" placeholder={f.placeholder} />}
                    {f.type === "email" && <input disabled type="email" placeholder={f.placeholder} />}
                    {f.type === "date" && <input disabled type="date" />}
                    {f.type === "checkbox" && (
                      <div className="checkbox-group">
                        {f.options.map((o) => <label key={o} className="checkbox-option"><input type="checkbox" disabled />{o}</label>)}
                      </div>
                    )}
                    {f.type === "select" && <select disabled>{f.options.map((o) => <option key={o}>{o}</option>)}</select>}
                    {f.type === "rating" && <div className="rating-group">{[1,2,3,4,5].map((n) => <span key={n} className="rating-star">★</span>)}</div>}
                    {f.type === "file" && <input type="file" disabled />}
                    {f.showIf?.fieldId && <span className="logic-badge">shown if condition met</span>}
                  </div>
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
            {errors.length > 0 && (
              <div className="error-box">
                {errors.map((e, i) => <p key={i} className="error">{e}</p>)}
              </div>
            )}
            {!readOnly && (
              <>
                <button className="secondary save-button" disabled={saving} onClick={() => handleSave({ publish: false })}>
                  {saving ? "Saving..." : "Save draft"}
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
        <fieldset disabled={readOnly} className="ro-fieldset"><DesignPanel theme={theme} onChange={setTheme} form={{ _id: savedForm?._id || "preview", title, description, fields }} /></fieldset>
      )}

      {tab === "preview" && (
        <div className="preview-tab">
          <FormRenderer form={{ _id: savedForm?._id || "preview", title, description, fields, theme }} previewOnly={!savedForm} />
        </div>
      )}

      {tab === "responses" && savedForm && <SubmissionsView form={savedForm} />}

      {shareOpen && savedForm && <SharePeopleModal form={savedForm} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
