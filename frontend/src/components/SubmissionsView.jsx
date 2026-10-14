import React, { Suspense, lazy, useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import ImportModal from "./ImportModal.jsx";

// Charts and the AI assistant load only when someone opens those tabs.
const AnalyticsView = lazy(() => import("./AnalyticsView.jsx"));
const AiAnalyst = lazy(() => import("./AiAnalyst.jsx"));

export default function SubmissionsView({ form }) {
  const [view, setView] = useState("table"); // "table" | "charts" | "ai"
  const [submissions, setSubmissions] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [filterField, setFilterField] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [error, setError] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const canImport = ["owner", "admin", "editor"].includes(form.myAccess);

  const fields = [...form.fields].sort((a, b) => a.order - b.order);

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
    try {
      await api.downloadCsv(form._id, form.title);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    setExportingPdf(true);
    try { await api.downloadPdf(form._id, form.title); } catch (err) { setError(err.message); } finally { setExportingPdf(false); }
  }

  // Field filter: narrows the loaded responses to one field containing some text.
  const shown = submissions.filter((s) => {
    if (!filterField || !filterValue.trim()) return true;
    const v = s.answers?.[filterField];
    const text = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    return text.toLowerCase().includes(filterValue.trim().toLowerCase());
  });
  const filtering = !!(filterField && filterValue.trim());

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form._id]);

  return (
    <div className="submissions-view">
      <div className="resp-tabs">
        <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Responses</button>
        <button className={view === "charts" ? "active" : ""} onClick={() => setView("charts")}>Charts and analysis</button>
        <button className={view === "ai" ? "active" : ""} onClick={() => setView("ai")}>AI assistant</button>
      </div>

      {view === "charts" && <Suspense fallback={<p className="empty-hint">Loading charts...</p>}><AnalyticsView form={form} /></Suspense>}
      {view === "ai" && <Suspense fallback={<p className="empty-hint">Loading...</p>}><AiAnalyst form={form} /></Suspense>}

      {view === "table" && (
        <>
          <div className="resp-toolbar">
            <input className="grow" placeholder="Search all answers" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(q)} />
            <button onClick={() => load(q)}>Search</button>
            <select value={filterField} onChange={(e) => setFilterField(e.target.value)} aria-label="Filter by field">
              <option value="">Filter by field</option>
              {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            {filterField && <input placeholder="contains..." value={filterValue} onChange={(e) => setFilterValue(e.target.value)} />}
            <span className="spacer" />
            {canImport && <button className="secondary btn-icon" onClick={() => setImportOpen(true)}><Icon name="upload" size={16} />Import</button>}
            <button className="secondary btn-icon" disabled={exporting} onClick={exportCsv}><Icon name="csv" size={16} />{exporting ? "Exporting..." : "CSV"}</button>
            <button className="secondary btn-icon" disabled={exportingPdf} onClick={exportPdf}><Icon name="pdf" size={16} />{exportingPdf ? "Preparing..." : "PDF"}</button>
          </div>
          <p className="resp-count">
            {filtering ? `${shown.length} of ${submissions.length} responses` : `${submissions.length} response${submissions.length === 1 ? "" : "s"}`}
            {filtering && <> <span className="filter-chip">{fields.find((f) => f.id === filterField)?.label}: {filterValue}<button onClick={() => { setFilterValue(""); setFilterField(""); }} aria-label="Clear filter">x</button></span></>}
          </p>

          {error && <p className="error">{error}</p>}
          {loading ? (
            <p>Loading...</p>
          ) : submissions.length === 0 ? (
            <p className="empty-hint">No responses yet. Share the form link to start collecting them.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Submitted</th>
                    {fields.map((f) => (
                      <th key={f.id}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s._id}>
                      <td>{new Date(s.createdAt).toLocaleString()}</td>
                      {fields.map((f) => (
                        <td key={f.id}>{String(s.answers?.[f.id] ?? "")}</td>
                      ))}
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
