import React, { useEffect, useState } from "react";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../api.js";

const BLUE = "#4f7cff";
const GOLD = "#F3BA28";
const tip = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 12 }, cursor: { fill: "rgba(120,130,160,0.12)" } };

function Columns({ data, color = BLUE, height = 200 }) {
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" interval="preserveStartEnd" tickLine={false} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip {...tip} />
          <Bar dataKey="count" name="Responses" fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Rows({ data }) {
  return (
    <div className="chart-box" style={{ height: Math.max(120, data.length * 36 + 24) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} />
          <Tooltip {...tip} formatter={(v, n, p) => [`${v} (${p.payload.pct ?? ""}%)`, "Responses"]} />
          <Bar dataKey="count" fill={BLUE} radius={[0, 4, 4, 0]} />
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

function FieldCard({ f }) {
  let body = null;
  if (!f.answered) body = <p className="empty-hint">No answers yet.</p>;
  else if (f.choices) body = (<>{f.top && <p className="chart-note">Most common: <strong>{f.top.label}</strong> ({f.top.count})</p>}<Rows data={f.choices} /></>);
  else if (f.distribution) body = (<><Stats items={[["Average", f.average ?? "-"], ["Ratings", f.answered]]} /><Columns data={f.distribution} color={GOLD} height={170} /></>);
  else if (f.histogram) body = (<><Stats items={[["Min", f.min], ["Median", f.median], ["Mean", f.mean], ["Max", f.max]]} /><Columns data={f.histogram} height={170} /></>);
  else if (f.series) body = (<><p className="chart-note">{f.earliest} to {f.latest}</p><Columns data={f.series} height={170} /></>);
  else if (f.topWords) body = (<><Stats items={[["Answers", f.answered], ["Avg length", `${f.avgLength} chars`]]} />{f.topWords.length > 0 ? <><p className="chart-note">Most used words</p><Chips items={f.topWords} /></> : <p className="empty-hint">Not enough text to find common words yet.</p>}</>);
  else if (f.topDomains) body = (<>{f.topDomains.length > 0 && <><p className="chart-note">Top email domains</p><Chips items={f.topDomains} /></>}</>);
  else body = <p className="chart-note">{f.answered} provided.</p>;
  return (
    <div className="field-chart-card">
      <div className="fcc-head">
        <h3>{f.label}</h3>
        <span>{f.type} · answered {f.answered} of {f.answered + f.skipped} ({f.answerRate}%)</span>
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

  const day = (d) => (d ? new Date(d).toLocaleDateString() : "-");
  return (
    <div className="analytics">
      <div className="analytics-top">
        <div className="mini-stats big">
          <div><strong>{data.total}</strong><span>Responses</span></div>
          <div><strong>{data.avgAnswerRate}%</strong><span>Avg. answer rate</span></div>
          <div><strong>{day(data.firstAt)}</strong><span>First response</span></div>
          <div><strong>{day(data.lastAt)}</strong><span>Latest response</span></div>
        </div>
        <button className="secondary small" disabled={loading} onClick={load}>{loading ? "Refreshing..." : "Refresh"}</button>
      </div>

      <div className="field-chart-card wide">
        <div className="fcc-head"><h3>Responses over time</h3><span>per day</span></div>
        <div className="chart-box" style={{ height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.timeline} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip {...tip} />
              <Area type="monotone" dataKey="count" name="Responses" stroke={BLUE} fill={BLUE} fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="field-chart-grid">
        {data.fields.map((f) => <FieldCard key={f.id} f={f} />)}
      </div>
      <p className="settings-hint small">Want an interpretation? Open the AI assistant tab to get insights and ask questions about these numbers.</p>
    </div>
  );
}
