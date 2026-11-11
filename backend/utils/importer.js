import XLSX from "xlsx";
import { httpError } from "./http.js";
import { validateValue, visibleFieldIds, isEmpty } from "./answers.js";

// Importing older responses from a CSV or Excel file. Each column is matched to one of the form's fields
// and every value is converted to the shape the form itself stores, so imported rows look exactly like
// responses collected through the form. That keeps charts, filters and the AI analysis consistent.

export const MAX_IMPORT_ROWS = 5000;
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Reads the first sheet of a CSV/XLSX/XLS file into { headers, rows } (rows are arrays aligned with headers). */
export function parseWorkbook(base64, filename = "") {
  if (typeof base64 !== "string" || !base64) throw httpError(400, "Choose a file to import.");
  let wb;
  try {
    wb = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer", cellDates: true, raw: false, dateNF: "yyyy-mm-dd" });
  } catch {
    throw httpError(400, "Couldn't read that file. Use a .csv, .xlsx or .xls file.");
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw httpError(400, "That file has no data.");
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  if (grid.length < 2) throw httpError(400, "The file needs a header row and at least one row of data.");
  const seen = new Map();
  const headers = grid[0].map((h, i) => {
    let name = String(h ?? "").trim() || `Column ${i + 1}`;
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name} (${n})` : name;
  });
  const rows = grid.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (rows.length > MAX_IMPORT_ROWS) throw httpError(400, `That file has ${rows.length} rows. The limit is ${MAX_IMPORT_ROWS} per import; split it into smaller files.`);
  return { headers, rows: rows.map((r) => headers.map((_, i) => String(r[i] ?? "").trim())) };
}

/** Best guess of which column belongs to which field: exact label, then contains, each column used once. */
export function suggestMapping(headers, fields) {
  const used = new Set();
  const mapping = {};
  const nh = headers.map(norm);
  const pick = (test) => {
    for (const f of fields) {
      if (mapping[f.id]) continue;
      const nf = norm(f.label);
      const i = nh.findIndex((h, k) => !used.has(k) && h && test(h, nf));
      if (i >= 0) { mapping[f.id] = headers[i]; used.add(i); }
    }
  };
  pick((h, f) => h === f);
  pick((h, f) => h.includes(f) || f.includes(h));
  const tsIdx = nh.findIndex((h, k) => !used.has(k) && /^(timestamp|submitted( at| on)?|date submitted|created( at)?|response date|date|time)$/.test(h));
  return { mapping, timestampColumn: tsIdx >= 0 ? headers[tsIdx] : null };
}

const TRUE = /^(1|true|yes|y|checked|x)$/i;
/** Reads the date formats people put in spreadsheets: ISO, M/D/YYYY, and anything Date can parse. */
export function toDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // A date with no time is stored at noon UTC, so it shows as the same calendar day in every time zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(`${s}T12:00:00Z`); return Number.isNaN(d.getTime()) ? null : d; }
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(.*)$/);
  if (us) {
    const [, a, b, c, rest] = us;
    const iso = `${c.length === 2 ? "20" + c : c}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
    const d = rest.trim() ? new Date(`${iso} ${rest.trim()}`) : new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const matchOption = (value, options) => options.find((o) => norm(o) === norm(value)) ?? null;

/**
 * Converts one raw cell to the stored value for a field, then runs the same validator live submissions use.
 * Spreadsheet leniency (currency signs, "4 stars", case-insensitive options, M/D/YYYY dates) happens here;
 * anything still invalid is left blank and reported. Returns { value, issue }.
 */
export function cleanValue(field, raw) {
  let s = String(raw ?? "").trim();
  if (!s) return { value: field.type === "checkbox" ? [] : "", issue: null };
  let candidate = s;
  switch (field.type) {
    case "number": candidate = s.replace(/[,$\s]/g, "").replace(/%$/, ""); break;
    case "rating": { const m = s.match(/^\s*(\d+(?:\.0+)?)\s*(?:\/\s*5|stars?|out of 5)?\s*$/i); candidate = m ? m[1] : s; break; }
    case "date": { const d = toDate(s); candidate = d ? d.toISOString().slice(0, 10) : s; break; }
    case "select": candidate = matchOption(s, field.options || []) ?? s; break;
    case "checkbox": {
      const parts = s.split(/[;,|\n]/).map((x) => x.trim()).filter(Boolean);
      if ((field.options || []).length === 1 && parts.length <= 1 && TRUE.test(s)) candidate = [field.options[0]];
      else candidate = parts.map((p) => matchOption(p, field.options || []) ?? p);
      break;
    }
    case "file": return { value: "", issue: null }; // files can't be imported from a spreadsheet
    default: break;
  }
  const { value, error } = validateValue(field, candidate);
  return error ? { value: field.type === "checkbox" ? [] : "", issue: `"${s.slice(0, 30)}" ${error}, left blank` } : { value, issue: null };
}

/**
 * Applies a mapping ({ fieldId: headerName }) to every row.
 * A cell that fails validation is left blank (with a note). A row is skipped (with a note) when nothing in it
 * maps to a field, or when a required question that was shown has no valid answer. A timestamp that can't
 * be read falls back to the import time and is flagged.
 * Returns { rows:[{answers, createdAt}], issues:[{row, field, message}], skipped, skippedEmpty, skippedMissing, badTimestamps }.
 */
export function cleanRows({ fields, headers, rows, mapping, timestampColumn }) {
  const col = (name) => (name ? headers.indexOf(name) : -1);
  const plan = fields.map((f) => ({ f, i: col(mapping?.[f.id]) })).filter((p) => p.i >= 0);
  if (!plan.length) throw httpError(400, "Match at least one column to a field.");
  const tsI = col(timestampColumn);
  const out = [];
  const issues = [];
  let skippedEmpty = 0, skippedMissing = 0, badTimestamps = 0;
  rows.forEach((row, n) => {
    const rowNo = n + 2;
    const answers = {};
    const rowIssues = [];
    let any = false;
    for (const f of fields) answers[f.id] = f.type === "checkbox" ? [] : "";
    for (const { f, i } of plan) {
      if (String(row[i] ?? "").trim()) any = true;
      const { value, issue } = cleanValue(f, row[i]);
      answers[f.id] = value;
      if (issue) rowIssues.push({ row: rowNo, field: f.label, message: issue });
    }
    if (!any) { skippedEmpty++; return; }
    const visible = visibleFieldIds(fields, answers);
    for (const f of fields) if (!visible.has(f.id)) answers[f.id] = f.type === "checkbox" ? [] : "";
    const missing = fields.filter((f) => f.required && f.type !== "file" && visible.has(f.id) && isEmpty(answers[f.id]));
    if (missing.length) {
      skippedMissing++;
      issues.push(...rowIssues, { row: rowNo, field: missing.map((f) => f.label).join(", "), message: `Row skipped: required answer${missing.length > 1 ? "s" : ""} missing or invalid` });
      return;
    }
    issues.push(...rowIssues);
    let createdAt = null;
    if (tsI >= 0) {
      const rawTs = String(row[tsI] ?? "").trim();
      createdAt = toDate(rawTs);
      if (rawTs && !createdAt) { badTimestamps++; issues.push({ row: rowNo, field: timestampColumn, message: `"${rawTs.slice(0, 30)}" is not a date, so the import time was used` }); }
    }
    out.push({ answers, createdAt });
  });
  return { rows: out, issues, skipped: skippedEmpty + skippedMissing, skippedEmpty, skippedMissing, badTimestamps };
}
