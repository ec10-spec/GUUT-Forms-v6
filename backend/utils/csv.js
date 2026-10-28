import { localDateTime } from "./time.js";

/** Minimal CSV writer. Also neutralises spreadsheet formula injection. */
export class Parser {
  constructor(columns, { tz = "UTC" } = {}) {
    this.columns = columns; // [{ id, label, type }]
    this.tz = tz;
  }

  escape(value) {
    let s = value === undefined || value === null ? "" : Array.isArray(value) ? value.join("; ") : String(value);
    // A cell starting with = + - @ would run as a formula when opened in Excel.
    // Plain negative numbers are left alone.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  cell(col, v) {
    if (col.type === "file" && v && typeof v === "object" && !Array.isArray(v)) return v.url ? `${v.name} (${v.url})` : v.name;
    return v;
  }

  toCsv(submissions) {
    const head = [`Submitted (${this.tz})`, "Submitted (UTC)", ...this.columns.map((c) => c.label), "Source"];
    const lines = [head.map((h) => this.escape(h)).join(",")];
    for (const s of submissions) {
      const at = s.createdAt ? new Date(s.createdAt) : null;
      lines.push(
        [at ? localDateTime(at, this.tz) : "", at ? at.toISOString() : "", ...this.columns.map((c) => this.cell(c, s.answers?.[c.id])), s.imported ? "Imported" : "Form"]
          .map((v) => this.escape(v))
          .join(",")
      );
    }
    return lines.join("\n");
  }
}
