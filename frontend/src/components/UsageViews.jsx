import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export const fmtTokens = (n) => (n || 0).toLocaleString();
export const fmtBytes = (n) => {
  n = n || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
};
const fmtWhen = (d) => (d ? new Date(d).toLocaleString() : "-");
const FEATURE = { ai_generate_form: "Form generation", ai_analysis_chat: "Response analysis chat", ai_test: "Connection test" };

export function DaysSelect({ days, onChange }) {
  return (
    <label className="days-select">
      Period
      <select value={days} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
        <option value={365}>Last 12 months</option>
      </select>
    </label>
  );
}

export function UsageTotals({ data }) {
  const calls = data.totalCalls ?? data.calls;
  const tokens = data.totalTokens ?? data.tokens;
  return (
    <div className="stat-row">
      {[["AI calls", fmtTokens(calls)], ["Tokens used", fmtTokens(tokens)], ["Est. cost", `$${data.estimatedCostUsd}`]].map(([k, v]) => (
        <div key={k} className="stat"><strong>{v}</strong><span>{k}</span></div>
      ))}
    </div>
  );
}

/** Per-user usage table. Used by company admins (their team) and the platform team (everyone). */
export function UsageTable({ rows, showCompany }) {
  if (!rows.length) return <p className="empty-hint">No users.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>User</th>{showCompany && <th>Company</th>}<th>Calls</th><th>Tokens</th><th>Today</th><th>Est. cost</th><th>Last used</th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.userId} className={u.active === false ? "row-muted" : ""}>
              <td><strong>{u.name || u.email}</strong>{u.name && <div className="admin-meta">{u.email}</div>}</td>
              {showCompany && <td>{u.companyName || "-"}</td>}
              <td>{u.calls}</td>
              <td>{fmtTokens(u.tokens)}</td>
              <td>{fmtTokens(u.today)}</td>
              <td>${u.estimatedCostUsd}</td>
              <td className="nowrap">{fmtWhen(u.lastAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Company admin: usage for their own team (the server always uses the caller's own company). */
export function TeamUsage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setData(null); api.usageTeam(days).then(setData).catch((e) => setError(e.message)); }, [days]);
  if (error) return <p className="error">{error}</p>;
  return (
    <div>
      <p className="settings-hint">Estimated AI token use across your team. Each person uses their own provider key, so costs are billed to them directly. Figures are estimates.</p>
      <DaysSelect days={days} onChange={setDays} />
      {!data ? <p className="empty-hint">Loading...</p> : (<><UsageTotals data={data} /><UsageTable rows={data.rows} /></>)}
    </div>
  );
}

/** Settings > Usage: storage first, then AI tokens. */
export function MyUsage() {
  return <><StorageUsage /><AiUsage /></>;
}

/** Stored forms and responses: the whole workspace for individuals and admins, own forms for members. */
function StorageUsage() {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.usageStorage().then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="settings-panel"><h2>Storage</h2><p className="error">{error}</p></div>;
  if (!d) return null;
  const pct = d.limitBytes ? Math.min(100, Math.round((d.bytes / d.limitBytes) * 100)) : null;
  return (
    <div className="settings-panel">
      <h2>Storage</h2>
      <p className="settings-hint">
        {d.scope === "mine" ? "Space used by the forms you own." : "Space used by every form and response in your workspace."}{" "}
        {d.mode === "custom" ? "Your data is in your own database, so there is no cap here." : ""}
      </p>
      {pct !== null ? (
        <>
          <div className="budget-meter" title={`${fmtBytes(d.bytes)} of ${fmtBytes(d.limitBytes)}`}>
            <div className="budget-meter-fill" style={{ width: `${pct}%`, background: pct >= 90 ? "#c0392b" : undefined }} />
          </div>
          <p className="settings-hint small">{fmtBytes(d.bytes)} of {fmtBytes(d.limitBytes)} used ({pct}%). New forms and responses stop being accepted when it is full.</p>
        </>
      ) : (
        <p className="settings-hint small">{fmtBytes(d.bytes)} used. {d.mode === "custom" ? "" : "There is no storage limit on your account right now."}</p>
      )}
      <div className="stat-row">
        <div className="stat"><strong>{d.forms}</strong><span>Forms</span></div>
        <div className="stat"><strong>{fmtTokens(d.responses)}</strong><span>Responses</span></div>
      </div>
      {d.topForms.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Largest forms</th><th>Responses</th><th>Size</th></tr></thead>
            <tbody>{d.topForms.map((f) => <tr key={f._id}><td>{f.title}</td><td>{f.responses}</td><td>{fmtBytes(f.bytes)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A person's own AI token usage. */
function AiUsage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setData(null); api.usageMe(days).then(setData).catch((e) => setError(e.message)); }, [days]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="empty-hint">Loading...</p>;
  const b = data.budget;
  const pct = Math.min(100, Math.round((b.used / b.limit) * 100));
  const peak = Math.max(1, ...data.byDay.map((d) => d.tokens));
  return (
    <div className="settings-panel">
      <h2>AI usage</h2>
      <p className="settings-hint">Tokens used by your AI features, through your own provider key. Costs are estimates; your provider's dashboard is the source of truth.</p>
      <div className="budget-meter" title={`${b.used} of ${b.limit} tokens used today`}>
        <div className="budget-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="settings-hint small">Today: {fmtTokens(b.used)} of {fmtTokens(b.limit)} tokens ({fmtTokens(b.remaining)} left).</p>
      <DaysSelect days={days} onChange={setDays} />
      <UsageTotals data={data} />
      {data.byEndpoint.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Feature</th><th>Calls</th><th>Tokens</th></tr></thead>
            <tbody>{data.byEndpoint.map((e) => <tr key={e.endpoint}><td>{FEATURE[e.endpoint] || e.endpoint}</td><td>{e.calls}</td><td>{fmtTokens(e.tokens)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {data.byDay.length > 0 && (
        <>
          <h3 className="usage-subhead">Tokens per day</h3>
          <div className="day-bars">
            {data.byDay.slice(-45).map((d) => (
              <div key={d.date} className="day-bar" title={`${d.date}: ${fmtTokens(d.tokens)} tokens, ${d.calls} call(s)`}>
                <div style={{ height: `${Math.max(4, (d.tokens / peak) * 100)}%` }} />
              </div>
            ))}
          </div>
        </>
      )}
      {data.calls === 0 && <p className="empty-hint">No AI usage in this period.</p>}
    </div>
  );
}
