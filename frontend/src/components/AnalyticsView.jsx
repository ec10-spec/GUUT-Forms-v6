import React, { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { api } from "../api.js";

const BLUE = "#4f7cff";
const GOLD = "#F3BA28";
const GREY = "#a3a9b8";
const tip = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 12 }, cursor: { fill: "rgba(120,130,160,0.12)" } };

/** Splits a label into lines of whole words (keeping the spaces between them), at most 3 lines. */
function wrapWords(text, max = 16) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > max) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  if (lines.length > 3) { lines.length = 3; lines[2] = `${lines[2].slice(0, max - 3)}...`; }
  return lines;
}

/** Y-axis label for horizontal bars: wrapped by word, right-aligned, vertically centred. */
function WrappedTick({ x, y, payload }) {
  const lines = wrapWords(payload.value);
  return (
    <text x={x} y={y} textAnchor="end" className="recharts-cartesian-axis-tick-value" fontSize={12}>
      <title>{payload.value}</title>
      {lines.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? `${0.35 - (lines.length - 1) * 0.6}em` : "1.2em"}>{l}</tspan>)}
    </text>
  );
}

function Columns({ data, color = BLUE, height = 200, xKey = "label", name = "Responses", tickFormatter }) {
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} interval="preserveStartEnd" tickLine={false} minTickGap={16} tickFormatter={tickFormatter} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip {...tip} labelFormatter={tickFormatter} />
          <Bar dataKey="count" name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Rows({ data }) {
  const rowH = Math.max(...data.map((d) => wrapWords(d.label).length), 1) > 1 ? 46 : 36;
  return (
    <div className="chart-box" style={{ height: Math.max(120, data.length * rowH + 24) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={130} tickLine={false} axisLine={false} tick={<WrappedTick />} interval={0} />
          <Tooltip {...tip} formatter={(v, n, p) => [`${v} (${p.payload.pct ?? ""}%)`, p.payload.invalid ? "Invalid values" : "Responses"]} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((d) => <Cell key={d.label} fill={d.invalid ? GREY : BLUE} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Chips({ items }) {
  return <div className="chips">{items.map((w) => <span key={w.label} className="chip">{w.label} <b>{w.count}</b></span>)}</div>;
}

function Stats({ items }) {
  return <div className="mini-stats">{items.map(([k, v]) => <div key={k}><strong>{v}</strong><span>{k}</span></div>)}</div>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-27" -> "Oct 27", "2026-10" -> "Oct 2026" (dates are already in the viewer's zone). */
function fmtDay(key, unit = "day") {
  if (!key) return "-";
  const [y, m, d] = String(key).split("-").map(Number);
  if (unit === "month" || !d) return `${MONTHS[m - 1]} ${y}`;
  return `${unit === "week" ? "Week of " : ""}${MONTHS[m - 1]} ${d}${unit === "week" ? "" : `, ${y}`}`;
}
const shortDay = (unit) => (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  return unit === "month" || !d ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : `${MONTHS[m - 1]} ${d}`;
};

function FieldCard({ f }) {
  let body = null;
  const invalidNote = f.invalid > 0 && <p className="chart-note warn">{f.invalid} stored value{f.invalid === 1 ? " is" : "s are"} invalid (from before answers were checked, or an import) and {f.invalid === 1 ? "is" : "are"} left out.</p>;
  if (!f.answered) body = <><p className="empty-hint">{f.shown ? "No valid answers yet." : "Not shown to anyone yet."}</p>{invalidNote}</>;
  else if (f.choices) body = (<>{f.top && <p className="chart-note">Most common: <strong>{f.top.label}</strong> ({f.top.count})</p>}<Rows data={f.choices} />{invalidNote}</>);
  else if (f.distribution) body = (<><Stats items={[["Average", f.average ?? "-"], ["Ratings", f.answered]]} /><Columns data={f.distribution} color={GOLD} height={170} name="Ratings" />{invalidNote}</>);
  else if (f.histogram) body = (<><Stats items={[["Min", f.min], ["Median", f.median], ["Mean", f.mean], ["Max", f.max]]} /><Columns data={f.histogram} height={170} />{invalidNote}</>);
  else if (f.series) body = (<><p className="chart-note">{fmtDay(f.earliest)} to {fmtDay(f.latest)}</p><Columns data={f.series} height={170} tickFormatter={shortDay(f.seriesUnit)} />{invalidNote}</>);
  else if (f.nameLike) body = (<><Stats items={[["Answers", f.answered]]} /><p className="chart-note">Names and contact details aren't summarised.</p></>);
  else if (f.topWords) body = (<><Stats items={[["Answers", f.answered], ["Avg length", `${f.avgLength} chars`]]} />{f.topWords.length > 0 ? <><p className="chart-note">Most used words</p><Chips items={f.topWords} /></> : <p className="empty-hint">Not enough text to find common words yet.</p>}</>);
  else if (f.topDomains) body = (<>{f.topDomains.length > 0 && <><p className="chart-note">Top email domains</p><Chips items={f.topDomains} /></>}{invalidNote}</>);
  else body = <p className="chart-note">{f.answered} file{f.answered === 1 ? "" : "s"} provided.</p>;
  return (
    <div className="field-chart-card">
      <div className="fcc-head">
        <h3>{f.label}</h3>
        <span>
          {f.type} · answered {f.answered} of {f.shown} ({f.answerRate}%)
          {f.conditional && <> · <span title="Only counted over responses where this question was shown">conditional</span></>}
        </span>
      </div>
      {body}
    </div>
  );
}

export default function AnalyticsView({ form }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setData(await api.analysisSummary(form._id)); setError(null); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [form._id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="empty-hint">Loading...</p>;
  if (data.total === 0) return <p className="empty-hint">No responses yet. Charts appear as soon as people start answering.</p>;

  const unit = data.timeline?.unit || "day";
  const points = data.timeline?.points || [];
  return (
    <div className="analytics">
      <div className="analytics-top">
        <div className="mini-stats big">
          <div><strong>{data.total}</strong><span>Responses{data.imported ? ` (${data.imported} imported)` : ""}</span></div>
          <div><strong>{data.avgAnswerRate}%</strong><span title="Each question counted only where it was shown">Avg. answer rate</span></div>
          <div><strong>{fmtDay(data.firstDay)}</strong><span>First response</span></div>
          <div><strong>{fmtDay(data.lastDay)}</strong><span>Latest response</span></div>
        </div>
        <button className="secondary small" disabled={loading} onClick={load}>{loading ? "Refreshing..." : "Refresh"}</button>
      </div>

      <div className="field-chart-card wide">
        <div className="fcc-head"><h3>Responses over time</h3><span>per {unit}, {data.timeZone?.replace(/_/g, " ")} time</span></div>
        <Columns data={points} xKey="date" height={210} tickFormatter={shortDay(unit)} />
      </div>

      <div className="field-chart-grid">
        {data.fields.map((f) => <FieldCard key={f.id} f={f} />)}
      </div>
      <p className="settings-hint small">Want an interpretation? Open the AI assistant tab to get insights and ask questions about these numbers.</p>
    </div>
  );
}
