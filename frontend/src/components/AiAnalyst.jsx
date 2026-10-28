import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const LENGTHS = [
  ["brief", "Brief", "A few lines"],
  ["standard", "Standard", "A short analysis"],
  ["detailed", "Detailed", "Full write-up"],
];

const QUICK = [
  ["Key insights", "Give me the key insights from these responses. Lead with the most important finding."],
  ["Trends and outliers", "What trends, patterns or outliers stand out in this data? Tell me how confident we can be given the sample size."],
  ["Recommended actions", "Based on these responses, what should we do next? Give business-context suggestions in priority order."],
  ["Improve this form", "How could I improve this form's questions, options or length based on how people answered and skipped?"],
  ["Free-text themes", "What themes come up in the free-text answers? Group them and say how common each seems."],
];

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

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

const when = (d) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * AI assistant for one form. Conversations are saved on the server (per form and person), so they survive
 * switching tabs and reloading. "New chat" starts another; past chats are listed; "Delete chat" removes one.
 */
export default function AiAnalyst({ form }) {
  const lengthKey = `guut_ai_length_${form._id}`;
  const lastKey = `guut_ai_chat_${form._id}`;
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]); // { role, content, inputTokens?, outputTokens?, truncated? }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingChat, setLoadingChat] = useState(true);
  const [error, setError] = useState(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [length, setLength] = useState(() => store.get(lengthKey, "standard"));
  const [includeRaw, setIncludeRaw] = useState(false);
  const [budget, setBudget] = useState(null);
  const endRef = useRef(null);

  const refreshList = () => api.analysisChats(form._id).then(setChats).catch(() => {});

  async function openChat(id) {
    setError(null);
    if (!id) { setChatId(null); setMessages([]); store.set(lastKey, ""); return; }
    setLoadingChat(true);
    try {
      const c = await api.analysisChatGet(form._id, id);
      setChatId(c._id); setMessages(c.messages || []); if (c.length) setLength(c.length);
      store.set(lastKey, c._id);
    } catch { setChatId(null); setMessages([]); store.set(lastKey, ""); }
    finally { setLoadingChat(false); }
  }

  useEffect(() => {
    api.getAiBudget().then(setBudget).catch(() => {});
    (async () => {
      const list = await api.analysisChats(form._id).catch(() => []);
      setChats(list);
      const last = store.get(lastKey, "");
      if (last && list.some((c) => c._id === last)) await openChat(last);
      else setLoadingChat(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form._id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, busy]);
  useEffect(() => { store.set(lengthKey, length); }, [length, lengthKey]);

  const aiReady = budget ? budget.aiReady !== false : true;

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy || !aiReady) return;
    setMessages((m) => [...m, { role: "user", content }]);
    setInput(""); setBusy(true); setError(null); setNeedsKey(false);
    try {
      const res = await api.analysisChat(form._id, { message: content, chatId, includeRaw, length });
      setChatId(res.chatId);
      setMessages(res.chat.messages);
      store.set(lastKey, res.chatId);
      setBudget(res.tokenBudget);
      if (!chatId) refreshList();
    } catch (err) {
      setMessages((m) => m.slice(0, -1));
      setInput(content);
      setError(err.message);
      setNeedsKey(["NO_API_KEY", "BAD_API_KEY", "CREDIT_EXHAUSTED"].includes(err.code));
      if (err.code === "CHAT_NOT_FOUND") { setChatId(null); refreshList(); }
    } finally { setBusy(false); }
  }

  async function deleteChat() {
    if (!chatId || !confirm("Delete this chat? This can't be undone.")) return;
    try { await api.analysisChatDelete(form._id, chatId); } catch { /* already gone */ }
    openChat(null);
    refreshList();
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="ai-analyst">
      <div className="ai-intro">
        <h2>AI assistant</h2>
        <p className="settings-hint">
          Ask about these responses: insights, trends, outliers and next steps. By default it is sent the counts, averages and charts for each
          question only. Free-text answers, and the words in them, are sent only if you tick "share a sample" below. Names, emails and files are never sent.
        </p>
      </div>

      <div className="chat-bar">
        <select value={chatId || ""} onChange={(e) => openChat(e.target.value || null)} aria-label="Saved chats" disabled={busy}>
          <option value="">{chatId ? "New chat" : chats.length ? "New chat (or open a saved one)" : "New chat"}</option>
          {chats.map((c) => <option key={c._id} value={c._id}>{c.title} ({when(c.updatedAt)})</option>)}
        </select>
        <button className="secondary small" disabled={busy || (!chatId && messages.length === 0)} onClick={() => openChat(null)}>New chat</button>
        {chatId && <button className="link-btn danger-link" disabled={busy} onClick={deleteChat}>Delete chat</button>}
      </div>

      {!aiReady && (
        <div className="notice-box">
          <strong>Add your AI key to use the assistant.</strong> It uses your own Claude or ChatGPT key, billed by your provider.{" "}
          <button className="link-btn" onClick={() => { window.location.hash = "/settings/ai"; }}>Open Settings, AI</button>
        </div>
      )}

      <div className="quick-row">
        {QUICK.map(([label, prompt]) => (
          <button key={label} className="template-chip" disabled={busy || !aiReady} onClick={() => send(prompt)}>{label}</button>
        ))}
      </div>

      <div className="chat-box">
        {loadingChat ? <p className="empty-hint">Loading...</p> : messages.length === 0 && <p className="empty-hint">Pick a quick analysis above or type your own question below. Chats are saved, so you can come back to them.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">{m.role === "assistant" ? <RichText text={m.content} /> : m.content}</div>
            {m.role === "assistant" && (m.inputTokens || m.outputTokens) ? (
              <span className="chat-meta">
                {(m.inputTokens + m.outputTokens).toLocaleString()} tokens ({m.inputTokens.toLocaleString()} in, {m.outputTokens.toLocaleString()} out)
                {m.truncated && ". Cut short: choose a longer answer length and ask again"}
              </span>
            ) : null}
          </div>
        ))}
        {busy && <div className="chat-msg assistant"><div className="chat-bubble thinking">Analysing...</div></div>}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="error">
          {error}{" "}
          {needsKey && <button className="link-btn" onClick={() => { window.location.hash = "/settings/ai"; }}>Add your API key</button>}
        </p>
      )}

      <div className="chat-input-row">
        <textarea
          rows={2} value={input} placeholder={aiReady ? "Ask about these responses..." : "Add your AI key in Settings to ask questions"}
          onChange={(e) => setInput(e.target.value)} disabled={!aiReady} aria-label="Your question"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="primary" disabled={busy || !input.trim() || !aiReady} onClick={() => send()}>Send</button>
      </div>

      <div className="chat-controls">
        <div className="length-picker" role="radiogroup" aria-label="Answer length">
          <span className="length-label">Answer length</span>
          {LENGTHS.map(([id, label, hint]) => (
            <button key={id} type="button" role="radio" aria-checked={length === id} title={hint} className={`seg ${length === id ? "active" : ""}`} onClick={() => setLength(id)}>{label}</button>
          ))}
        </div>
        <span className="spacer" />
        {aiReady && budget?.source === "platform_credit" && <span className="budget-display">Free AI credit: ${budget.credit.remainingUsd.toFixed(2)} left</span>}
        {aiReady && budget && <span className="budget-display">{budget.remaining.toLocaleString()} tokens left today</span>}
        {lastAssistant?.truncated && <span className="budget-display">Last answer was cut short</span>}
      </div>

      <label className="check-row raw-toggle">
        <input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} />
        <span>
          Also share a sample of recent answers (up to 150) so the AI can read free-text comments.
          Names, emails and files are never sent. They go to your own AI provider account.
        </span>
      </label>
    </div>
  );
}
