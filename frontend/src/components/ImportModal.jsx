import React, { useRef, useState } from "react";
import { api } from "../api.js";

const MAX_BYTES = 6 * 1024 * 1024;

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

/** Upload older responses (CSV or Excel). Columns are matched to the form's fields; check, then import. */
export default function ImportModal({ form, onClose, onImported }) {
  const [step, setStep] = useState("pick"); // pick | map | done
  const [file, setFile] = useState(null);
  const [b64, setB64] = useState("");
  const [info, setInfo] = useState(null);
  const [mapping, setMapping] = useState({});
  const [ts, setTs] = useState("");
  const [check, setCheck] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  async function pick(f) {
    if (!f) return;
    if (f.size > MAX_BYTES) { setError("That file is over 6 MB. Split it into smaller files."); return; }
    setBusy(true); setError(null);
    try {
      const data = await toBase64(f);
      const p = await api.importPreview(form._id, { base64: data, filename: f.name });
      setFile(f); setB64(data); setInfo(p); setMapping(p.mapping || {}); setTs(p.timestampColumn || ""); setCheck(null); setStep("map");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const body = (dryRun) => ({ base64: b64, filename: file.name, mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), timestampColumn: ts || null, dryRun });

  async function runCheck() {
    setBusy(true); setError(null);
    try { setCheck(await api.importResponses(form._id, body(true))); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function doImport() {
    setBusy(true); setError(null);
    try { const r = await api.importResponses(form._id, body(false)); setResult(r); setStep("done"); onImported?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function setMap(fieldId, header) { setMapping((m) => ({ ...m, [fieldId]: header })); setCheck(null); }

  function template() {
    const cols = ["Submitted", ...info?.fields?.map((f) => f.label) || form.fields.map((f) => f.label)];
    const csv = cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",") + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${form.title.replace(/[^\w-]+/g, "_")}_import_template.csv`;
    a.click();
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const fieldsOf = info?.fields || [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card wide" role="dialog" aria-label="Import responses">
        <div className="modal-head">
          <h2>Import responses</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error && <p className="error">{error}</p>}

        {step === "pick" && (
          <>
            <p className="settings-hint">Upload older responses as a CSV or Excel file. Each column is matched to a question on this form so your old and new responses sit in one table and can be analysed together. Imported rows are marked as imported.</p>
            <div className="drop-zone" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
              <strong>{busy ? "Reading file..." : "Choose a file or drop it here"}</strong>
              <span>.csv, .xlsx or .xls, up to 6 MB and 5,000 rows</span>
              <input ref={input} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => pick(e.target.files?.[0])} />
            </div>
            <button className="link-btn" onClick={template}>Download a template with this form's columns</button>
          </>
        )}

        {step === "map" && info && (
          <>
            <p className="settings-hint"><strong>{file.name}</strong>: {info.rowCount} rows. Check how its columns match this form. Fields set to "Skip" stay empty.</p>
            <div className="map-table">
              {fieldsOf.map((f) => (
                <div key={f.id} className="map-row">
                  <div><strong>{f.label}</strong><span>{f.type}{f.required ? ", required" : ""}</span></div>
                  <select value={mapping[f.id] || ""} onChange={(e) => setMap(f.id, e.target.value)} aria-label={`Column for ${f.label}`}>
                    <option value="">Skip</option>
                    {info.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
              <div className="map-row">
                <div><strong>Submitted date</strong><span>Optional. Keeps the original date</span></div>
                <select value={ts} onChange={(e) => { setTs(e.target.value); setCheck(null); }} aria-label="Date column">
                  <option value="">Use the import time</option>
                  {info.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            {check && (
              <div className="import-check">
                <p><strong>{check.importable}</strong> of {check.total} rows can be imported.</p>
                {(check.skippedMissing > 0 || check.skippedEmpty > 0 || check.badTimestamps > 0) && (
                  <ul className="import-counts">
                    {check.skippedMissing > 0 && <li><strong>{check.skippedMissing}</strong> row{check.skippedMissing === 1 ? "" : "s"} skipped: a required answer is missing or invalid.</li>}
                    {check.skippedEmpty > 0 && <li><strong>{check.skippedEmpty}</strong> empty row{check.skippedEmpty === 1 ? "" : "s"} skipped.</li>}
                    {check.badTimestamps > 0 && <li><strong>{check.badTimestamps}</strong> row{check.badTimestamps === 1 ? " has a date" : "s have dates"} that couldn't be read, so the import time is used.</li>}
                  </ul>
                )}
                <p className="settings-hint small">Answers that don't fit a question (for example a rating of 9, or a choice that isn't an option) are left blank.</p>
                {check.issues?.length > 0 && (
                  <details><summary>{check.issueCount} note{check.issueCount === 1 ? "" : "s"}</summary><ul>{check.issues.map((i, k) => <li key={k}>{`Row ${i.row}, ${i.field}: ${i.message}`}</li>)}</ul></details>
                )}
              </div>
            )}
            <div className="api-key-actions">
              <button className="secondary" disabled={busy || mappedCount === 0} onClick={runCheck}>{busy && !check ? "Checking..." : "Check rows"}</button>
              <button className="primary" disabled={busy || !check || check.importable === 0} onClick={doImport}>{busy && check ? "Importing..." : `Import ${check ? check.importable : ""} rows`}</button>
              <button className="link-btn" onClick={() => setStep("pick")}>Choose another file</button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <p><strong>{result.imported}</strong> responses imported{result.skipped ? `, ${result.skipped} row${result.skipped === 1 ? "" : "s"} skipped` : ""}.</p>
            <button className="primary" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
