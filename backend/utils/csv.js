/** Minimal CSV writer. Also neutralises spreadsheet formula injection. */
export class Parser {
  constructor(columns) {
    this.columns = columns; // [{ id, label }]
  }

  escape(value) {
    let s = value === undefined || value === null ? "" : Array.isArray(value) ? value.join("; ") : String(value);
    // A cell starting with = + - @ would run as a formula when opened in Excel.
    // Plain negative numbers are left alone.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  toCsv(submissions) {
    const lines = [["Submitted At", ...this.columns.map((c) => c.label)].map((h) => this.escape(h)).join(",")];
    for (const s of submissions) {
      lines.push(
        [s.createdAt?.toISOString?.() || "", ...this.columns.map((c) => s.answers?.[c.id])]
          .map((v) => this.escape(v))
          .join(",")
      );
    }
    return lines.join("\n");
  }
}
