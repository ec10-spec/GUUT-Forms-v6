import XLSX from "xlsx";
import { httpError } from "./http.js";

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
function toDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s) : new Date(s.replace(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, (_, a, b, c) => `${c.length === 2 ? "20" + c : c}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`));
  return Number.isNaN(d.getTime()) ? null : d;
}
const matchOption = (value, options) => options.find((o) => norm(o) === norm(value)) ?? null;

/** Converts one raw cell to the stored value for a field. Returns { value, issue } (issue = a short note or null). */
export function cleanValue(field, raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { value: "", issue: null };
  switch (field.type) {
    case "number": {
      const n = Number(s.replace(/[,$\s]/g, "").replace(/%$/, ""));
      return Number.isFinite(n) ? { value: n, issue: null } : { value: "", issue: `"${s.slice(0, 30)}" is not a number` };
    }
    case "rating": {
      const n = Math.round(Number(s.replace(/[^\d.]/g, "")));
      return n >= 1 && n <= 5 ? { value: n, issue: null } : { value: "", issue: `"${s.slice(0, 30)}" is not a 1 to 5 rating` };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s.toLowerCase(), issue: null } : { value: "", issue: `"${s.slice(0, 30)}" is not an email` };
    case "date": {
      const d = toDate(s);
      return d ? { value: d.toISOString().slice(0, 10), issue: null } : { value: "", issue: `"${s.slice(0, 30)}" is not a date` };
    }
    case "select": {
      const hit = matchOption(s, field.options || []);
      return hit ? { value: hit, issue: null } : { value: s.slice(0, 1000), issue: `"${s.slice(0, 30)}" is not one of the options` };
    }
    case "checkbox": {
      const parts = s.split(/[;,|\n]/).map((x) => x.trim()).filter(Boolean);
      if ((field.options || []).length === 0 && parts.length <= 1 && TRUE.test(s)) return { value: [field.label], issue: null };
      let issue = null;
      const out = parts.slice(0, 100).map((p) => {
        const hit = matchOption(p, field.options || []);
        if (!hit && !issue) issue = `"${p.slice(0, 30)}" is not one of the options`;
        return hit ?? p.slice(0, 1000);
      });
      return { value: [...new Set(out)], issue };
    }
    case "file":
      return { value: "", issue: null };
    default:
      return { value: s.slice(0, 10000), issue: null };
  }
}

/**
 * Applies a mapping ({ fieldId: headerName }) to every row.
 * Returns { answers, createdAt, issues:[{row,message}], skipped } per row set; rows with nothing mapped are skipped.
 */
export function cleanRows({ fields, headers, rows, mapping, timestampColumn }) {
  const col = (name) => (name ? headers.indexOf(name) : -1);
  const plan = fields.map((f) => ({ f, i: col(mapping?.[f.id]) })).filter((p) => p.i >= 0);
  if (!plan.length) throw httpError(400, "Match at least one column to a field.");
  const tsI = col(timestampColumn);
  const out = [];
  const issues = [];
  let skipped = 0;
  rows.forEach((row, n) => {
    const answers = {};
    let any = false;
    for (const f of fields) answers[f.id] = f.type === "checkbox" ? [] : "";
    for (const { f, i } of plan) {
      const { value, issue } = cleanValue(f, row[i]);
      answers[f.id] = value;
      if (value !== "" && !(Array.isArray(value) && !value.length)) any = true;
      if (issue) issues.push({ row: n + 2, field: f.label, message: issue });
    }
    if (!any) { skipped++; return; }
    const createdAt = tsI >= 0 ? toDate(row[tsI]) : null;
    out.push({ answers, createdAt });
  });
  return { rows: out, issues, skipped };
}
