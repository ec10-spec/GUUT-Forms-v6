import React, { Suspense, lazy, useEffect, useState } from "react";
import { api, assetUrl } from "../api.js";
import Icon from "./Icon.jsx";
import ImportModal from "./ImportModal.jsx";

// Charts and the AI assistant load only when someone opens those tabs.
const AnalyticsView = lazy(() => import("./AnalyticsView.jsx"));
const AiAnalyst = lazy(() => import("./AiAnalyst.jsx"));

const isFile = (v) => v && typeof v === "object" && !Array.isArray(v) && v.fileId;
/** Plain text of an answer, as shown in the table and searched by filters. */
export const answerText = (v) => (isFile(v) ? v.name : Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v));

function Cell({ field, value, expanded }) {
  if (isFile(value)) {
    const url = value.url ? assetUrl(value.url) : null;
    const isImage = /^image\//.test(value.type || "");
    return (
      <span className="file-cell">
        {isImage && url && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="file-thumb" loading="lazy" /></a>}
        {url ? <a href={url} target="_blank" rel="noreferrer">{value.name}</a> : value.name}
      </span>
    );
  }
  const text = answerText(value);
  return <span className={`cell-text ${expanded ? "" : "clamp"}`} title={text.length > 80 ? text : undefined}>{text}</span>;
}

export default function SubmissionsView({ form }) {
  const [view, setView] = useState("table"); // "table" | "charts" | "ai"
  const [seen, setSeen] = useState({ table: true });
  const [submissions, setSubmissions] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [filterField, setFilterField] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const canImport = ["owner", "admin", "editor"].includes(form.myAccess);

  const fields = [...form.fields].sort((a, b) => a.order - b.order);
  const filterF = fields.find((f) => f.id === filterField);
  const choiceFilter = filterF && ["select", "checkbox", "rating"].includes(filterF.type);
  const choiceOptions = filterF?.type === "rating" ? ["1", "2", "3", "4", "5"] : filterF?.options || [];

  async function load(query = "") {
    setLoading(true);
    try {
      setSubmissions(await api.listSubmissions(form._id, query));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try { await api.downloadCsv(form._id, form.title); } catch (err) { setError(err.message); } finally { setExporting(false); }
  }

  async function exportPdf() {
    setExportingPdf(true);
    try { await api.downloadPdf(form._id, form.title); } catch (err) { setError(err.message); } finally { setExportingPdf(false); }
  }

  // Field filter. Choice questions match an exact option (so "Not sure" doesn't match "Definitely not");
  // text questions match "contains".
  const shown = submissions.filter((s) => {
    if (!filterField || !String(filterValue).trim()) return true;
    const v = s.answers?.[filterField];
    if (choiceFilter) return Array.isArray(v) ? v.includes(filterValue) : String(v ?? "") === filterValue;
    return answerText(v).toLowerCase().includes(filterValue.trim().toLowerCase());
  });
  const filtering = !!(filterField && String(filterValue).trim());

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form._id]);

  const go = (v) => { setView(v); setSeen((s) => ({ ...s, [v]: true })); };

  return (
    <div className="submissions-view">
      <div className="resp-tabs" role="tablist">
        <button role="tab" aria-selected={view === "table"} className={view === "table" ? "active" : ""} onClick={() => go("table")}>Responses</button>
        <button role="tab" aria-selected={view === "charts"} className={view === "charts" ? "active" : ""} onClick={() => go("charts")}>Charts and analysis</button>
        <button role="tab" aria-selected={view === "ai"} className={view === "ai" ? "active" : ""} onClick={() => go("ai")}>AI assistant</button>
      </div>

      {view === "charts" && <Suspense fallback={<p className="empty-hint">Loading charts...</p>}><AnalyticsView form={form} /></Suspense>}
      {/* The assistant stays mounted after its first open, so a conversation in progress isn't lost. */}
      {seen.ai && <div hidden={view !== "ai"}><Suspense fallback={<p className="empty-hint">Loading...</p>}><AiAnalyst form={form} /></Suspense></div>}

      {view === "table" && (
        <>
          <div className="resp-toolbar">
            <div className="resp-search">
              <input className="grow" placeholder="Search all answers" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(q)} aria-label="Search all answers" />
              <button onClick={() => load(q)}>Search</button>
            </div>
            <div className="resp-filter">
              <select value={filterField} onChange={(e) => { setFilterField(e.target.value); setFilterValue(""); }} aria-label="Filter by question">
                <option value="">Filter by question</option>
                {fields.filter((f) => f.type !== "file").map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              {filterField && (choiceFilter ? (
                <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)} aria-label="Answer">
                  <option value="">Any answer</option>
                  {choiceOptions.map((o) => <option key={o} value={o}>{filterF.type === "rating" ? `${o} of 5` : o}</option>)}
                </select>
              ) : (
                <input placeholder="contains..." value={filterValue} onChange={(e) => setFilterValue(e.target.value)} aria-label="Answer contains" />
              ))}
            </div>
            <div className="resp-actions">
              {canImport && <button className="secondary btn-icon" onClick={() => setImportOpen(true)}><Icon name="upload" size={16} />Import</button>}
              <button className="secondary btn-icon" disabled={exporting} onClick={exportCsv}><Icon name="csv" size={16} />{exporting ? "Exporting..." : "CSV"}</button>
              <button className="secondary btn-icon" disabled={exportingPdf} onClick={exportPdf}><Icon name="pdf" size={16} />{exportingPdf ? "Preparing..." : "PDF"}</button>
            </div>
          </div>
          <p className="resp-count">
            {filtering ? `${shown.length} of ${submissions.length} responses` : `${submissions.length} response${submissions.length === 1 ? "" : "s"}`}
            {filtering && <> <span className="filter-chip">{filterF?.label}: {filterValue}<button onClick={() => { setFilterValue(""); setFilterField(""); }} aria-label="Clear filter">x</button></span></>}
          </p>

          {error && <p className="error">{error}</p>}
          {loading ? (
            <p>Loading...</p>
          ) : submissions.length === 0 ? (
            <p className="empty-hint">No responses yet. Share the form link to start collecting them.</p>
          ) : (
            <div className="table-scroll">
              <table className="resp-table">
                <thead>
                  <tr>
                    <th>Submitted</th>
                    {fields.map((f) => <th key={f.id} title={f.label}><span className="th-text">{f.label}</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s._id} className={expanded === s._id ? "expanded" : ""} onClick={() => setExpanded(expanded === s._id ? null : s._id)} title={expanded === s._id ? "Click to collapse" : "Click to show full answers"}>
                      <td className="nowrap">{new Date(s.createdAt).toLocaleString()}{s.imported && <span className="imported-tag">Imported</span>}</td>
                      {fields.map((f) => <td key={f.id}><Cell field={f} value={s.answers?.[f.id]} expanded={expanded === s._id} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {importOpen && <ImportModal form={form} onClose={() => setImportOpen(false)} onImported={() => load()} />}
    </div>
  );
}
