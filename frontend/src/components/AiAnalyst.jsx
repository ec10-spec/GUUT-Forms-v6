import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const LENGTHS = [
  ["brief", "Brief", 700, "A few lines"],
  ["standard", "Standard", 1500, "A short analysis"],
  ["detailed", "Detailed", 3000, "Full write-up"],
];

const QUICK = [
  ["Key insights", "Give me the key insights from these responses. Lead with the most important finding."],
  ["Trends and outliers", "What trends, patterns or outliers stand out in this data? Tell me how confident we can be given the sample size."],
  ["Recommended actions", "Based on these responses, what should we do next? Give business-context suggestions in priority order."],
  ["Improve this form", "How could I improve this form's questions, options or length based on how people answered and skipped?"],
  ["Free-text themes", "What themes come up in the free-text answers? Group them and say how common each seems."],
];

// Renders the assistant's plain text safely: "- " lines become bullets, **bold** is honoured.
function RichText({ text }) {
  const bold = (line) => line.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  const blocks = [];
  let list = null;
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { (list ||= []).push(<li key={i}>{bold(m[1])}</li>); return; }
    if (list) { blocks.push(<ul key={`u${i}`}>{list}</ul>); list = null; }
    if (line.trim()) blocks.push(<p key={i}>{bold(line)}</p>);
  });
  if (list) blocks.push(<ul key="uend">{list}</ul>);
  return <>{blocks}</>;
}

export default function AiAnalyst({ form }) {
  const [messages, setMessages] = useState([]); // { role, content, meta? }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [length, setLength] = useState("standard");
  const [includeRaw, setIncludeRaw] = useState(false);
  const [budget, setBudget] = useState(null);
  const endRef = useRef(null);

  useEffect(() => { api.getAiBudget().then(setBudget).catch(() => {}); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, busy]);

  const ceiling = budget?.maxPerAnalysisCeiling || 4000;
  const maxTokens = Math.min(LENGTHS.find((l) => l[0] === length)[2], ceiling);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next); setInput(""); setBusy(true); setError(null); setNeedsKey(false);
    try {
      const res = await api.analysisChat(form._id, {
        messages: next.map(({ role, content: c }) => ({ role, content: c })),
        includeRaw, maxTokens,
      });
      setMessages([...next, { role: "assistant", content: res.reply, meta: { ...res.usage, truncated: res.truncated } }]);
      setBudget(res.tokenBudget);
    } catch (err) {
      setError(err.message);
      setNeedsKey(["NO_API_KEY", "BAD_API_KEY", "CREDIT_EXHAUSTED"].includes(err.code));
    } finally { setBusy(false); }
  }

  return (
    <div className="ai-analyst">
      <div className="ai-intro">
        <h2>AI assistant</h2>
        <p className="settings-hint">
          Ask about these responses: insights, trends, outliers and next steps. It sees summary numbers only, unless you choose to share a sample of answers below.
        </p>
      </div>

      <div className="quick-row">
        {QUICK.map(([label, prompt]) => (
          <button key={label} className="template-chip" disabled={busy} onClick={() => send(prompt)}>{label}</button>
        ))}
      </div>

      <div className="chat-box">
        {messages.length === 0 && <p className="empty-hint">Pick a quick analysis above or type your own question below.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">{m.role === "assistant" ? <RichText text={m.content} /> : m.content}</div>
            {m.meta && (
              <span className="chat-meta">
                {(m.meta.input + m.meta.output).toLocaleString()} tokens ({m.meta.input.toLocaleString()} in, {m.meta.output.toLocaleString()} out)
                {m.meta.truncated && " · cut short: choose a longer answer length and ask again"}
              </span>
            )}
          </div>
        ))}
        {busy && <div className="chat-msg assistant"><div className="chat-bubble thinking">Analysing...</div></div>}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="error">
          {error}{" "}
          {needsKey && <button className="link-btn" onClick={() => { window.location.hash = "/settings"; }}>Add your API key</button>}
        </p>
      )}

      <div className="chat-input-row">
        <textarea
          rows={2} value={input} placeholder="Ask about these responses..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="primary" disabled={busy || !input.trim()} onClick={() => send()}>Send</button>
      </div>

      <div className="chat-controls">
        <div className="length-picker" role="radiogroup" aria-label="Answer length">
          <span className="length-label">Answer length</span>
          {LENGTHS.map(([id, label, , hint]) => (
            <button key={id} type="button" role="radio" aria-checked={length === id} title={hint} className={`seg ${length === id ? "active" : ""}`} onClick={() => setLength(id)}>{label}</button>
          ))}
        </div>
        <span className="spacer" />
        {budget?.credit?.available && <span className="budget-display">Free AI credit: ${budget.credit.remainingUsd.toFixed(2)} left</span>}
        {budget && <span className="budget-display">{budget.remaining.toLocaleString()} tokens left today</span>}
        {messages.length > 0 && <button className="link-btn" onClick={() => { setMessages([]); setError(null); }}>Clear chat</button>}
      </div>

      <label className="check-row raw-toggle">
        <input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} />
        <span>
          Also share a sample of recent answers (up to 150) so the AI can read free-text comments.
          Emails and files are never sent. They go to your own AI provider account.
        </span>
      </label>
    </div>
  );
}
