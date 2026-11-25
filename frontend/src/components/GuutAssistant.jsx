import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import Logo from "./Logo.jsx";
import RichText from "./RichText.jsx";
import { ANALYSES } from "../lib/guutAi.js";

// GUUT AI: one assistant beside every signed-in page. With an AI key it is docked on the right on wide screens
// and open by default (the X tucks it away, the launcher or Ctrl/Cmd+J brings it back); on smaller screens it
// opens as a sheet only when asked. Without a key there is only the launcher; clicking it explains how to switch
// GUUT AI on. It knows the page and the open form, so it can find forms, draft new ones, propose edits you apply
// in the builder (with Undo), and explain responses.
//
// History: with "Save chat history" on (the default) every conversation is stored on the server and listed
// under History. Switched off, nothing is stored: the thread lives in this tab only and is sent along with
// each message.

const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const OPEN_KEY = "guut_assistant_open";
const DOCK_MIN = 1024; // docks beside the page from this width; below it, a sheet that never opens by itself
const LAST_KEY = "guut_assistant_chat";
const LENGTH_KEY = "guut_assistant_length";
const LENGTHS = [["brief", "Brief"], ["standard", "Standard"], ["detailed", "Detailed"]];


const SUGGESTIONS = {
  edit: ["Summarise the responses so far", "Suggest improvements to this form", "Add a question asking how they heard about us", "Make the questions shorter and clearer"],
  new: ["Add 3 questions about customer satisfaction", "Make this form shorter", "Add a follow-up question for low ratings"],
  home: ["Find my most recent draft", "Draft an event RSVP form", "Which of my forms are published?"],
  teams: ["How do team reviewers work?", "How do I share a form with a whole team?"],
  settings: ["How do response emails work?", "How do I connect Google sign-in?", "How do team reviewers work?"],
  other: ["How do I share a form?", "Draft a customer feedback form", "What can you help me with?"],
};
const suggestionsFor = (page) => SUGGESTIONS[page === "edit" ? "edit" : page === "new" ? "new" : page === "home" ? "home" : page === "teams" ? "teams" : page === "settings" ? "settings" : "other"];

const when = (d) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * builder: the latest state the open builder reported ({ formId, title, description, fields }), so edits
 * build on what is on screen, including unsaved changes.
 */
export default function GuutAssistant({ user, route, builder, onNavigate, onOpenDraft }) {
  const [status, setStatus] = useState(null); // { aiReady, saveHistory, canSave }
  // Open by default where it can sit beside the page; on phones it waits behind the launcher.
  const [open, setOpen] = useState(() => window.innerWidth >= DOCK_MIN && store.get(OPEN_KEY, "1") === "1");
  const [cardOpen, setCardOpen] = useState(false); // no key: the "how to switch it on" card, only when asked
  const [failedText, setFailedText] = useState(null); // last message that failed, for Try again
  const [copied, setCopied] = useState(null);
  const abortRef = useRef(null);
  const [view, setView] = useState("chat"); // chat | history
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]); // { role, content, actions? }
  const [chats, setChats] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState({}); // message index -> "applied"
  const [menu, setMenu] = useState(false);
  const [length, setLength] = useState(() => store.get(LENGTH_KEY, "standard"));
  const [includeRaw, setIncludeRaw] = useState(false); // share a sample of answers for the open form
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const sendRef = useRef(null);

  // The options menu closes on any click outside it, and on Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    const onKey = (e) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);
  useEffect(() => { store.set(LENGTH_KEY, length); }, [length]);

  const page = route.name;
  const formId = page === "edit" ? route.id : null;
  useEffect(() => { setIncludeRaw(false); }, [formId]); // sharing answers is a choice per form, per visit
  const [formTitle, setFormTitle] = useState(null);
  useEffect(() => {
    const on = (e) => setFormTitle(e.detail?.formId && e.detail.formId === formId ? e.detail.title : null);
    window.addEventListener("guut:builder-state", on);
    return () => window.removeEventListener("guut:builder-state", on);
  }, [formId]);

  const loadStatus = useCallback(() => api.assistantStatus().then(setStatus).catch(() => setStatus({ aiReady: false, saveHistory: false, canSave: false, failed: true })), []);
  useEffect(() => { loadStatus(); }, [loadStatus, user?._id, user?.hasAiApiKey, user?.ai?.provider]);
  // Settings saves a key: check again when the person comes back to the tab.
  useEffect(() => { const f = () => document.visibilityState === "visible" && loadStatus(); document.addEventListener("visibilitychange", f); return () => document.removeEventListener("visibilitychange", f); }, [loadStatus]);

  const saving = !!(status?.saveHistory && status?.canSave);
  const refreshChats = useCallback(() => { if (saving) api.assistantChats().then(setChats).catch(() => {}); }, [saving]);

  // Reopen the last saved conversation.
  useEffect(() => {
    if (!status?.aiReady || !saving) return;
    const last = store.get(LAST_KEY, "");
    api.assistantChats().then((list) => {
      setChats(list);
      if (last && list.some((c) => c._id === last) && !messages.length) openChat(last);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.aiReady, saving]);

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) firstRender.current = false;
    else if (window.innerWidth >= DOCK_MIN) store.set(OPEN_KEY, open ? "1" : "0");
    document.documentElement.classList.toggle("assistant-docked", !!(open && status?.aiReady));
  }, [open, status?.aiReady]);
  // Ctrl/Cmd+J opens or closes GUUT AI from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (!status?.aiReady) { setCardOpen((o) => !o); return; }
        setOpen((o) => { if (!o) setTimeout(() => inputRef.current?.focus(), 50); return !o; });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status?.aiReady]);
  // Phones: the launcher steps aside while someone is typing in the page.
  useEffect(() => {
    const isField = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const onIn = (e) => { if (isField(e.target) && !e.target.closest?.(".assistant-panel")) document.documentElement.classList.add("page-typing"); };
    const onOut = () => document.documentElement.classList.remove("page-typing");
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => { document.removeEventListener("focusin", onIn); document.removeEventListener("focusout", onOut); document.documentElement.classList.remove("page-typing"); };
  }, []);
  useEffect(() => () => document.documentElement.classList.remove("assistant-docked"), []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, busy]);
  // Other parts of the app can open the assistant with a question ("Ask GUUT AI").
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      setOpen(true); setCardOpen(true); setView("chat"); setMenu(false);
      if (typeof d.includeRaw === "boolean") setIncludeRaw(d.includeRaw);
      if (d.prompt && d.send) setTimeout(() => sendRef.current?.(d.prompt, { includeRaw: d.includeRaw }), 0);
      else { if (d.prompt) setInput(d.prompt); setTimeout(() => inputRef.current?.focus(), 50); }
    };
    window.addEventListener("guut:assistant-open", on);
    return () => window.removeEventListener("guut:assistant-open", on);
  }, []);

  async function openChat(id) {
    setError(null); setApplied({}); setView("chat");
    if (!id) { setChatId(null); setMessages([]); store.set(LAST_KEY, ""); return; }
    try {
      const c = await api.assistantChatGet(id);
      setChatId(c._id); setMessages((c.messages || []).map((m) => ({ ...m, earlier: true }))); store.set(LAST_KEY, c._id);
    } catch { setChatId(null); setMessages([]); store.set(LAST_KEY, ""); }
  }

  function contextNow() {
    const ctx = { page };
    if (formId) ctx.formId = formId;
    const b = builder?.current;
    if (b && !b.readOnly && (page === "new" || (formId && b.formId === formId))) ctx.draft = { title: b.title, description: b.description, fields: b.fields };
    return ctx;
  }

  async function send(text, opts = {}) {
    const content = String(text ?? input).trim();
    if (!content || busy || !status?.aiReady) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content, formId }]);
    setInput(""); setBusy(true); setError(null); setFailedText(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const raw = typeof opts.includeRaw === "boolean" ? opts.includeRaw : includeRaw;
      const res = await api.assistantChat({ message: content, chatId: saving ? chatId : null, history: saving ? undefined : history, context: contextNow(), length, includeRaw: !!(formId && raw) }, ctrl.signal);
      setMessages((m) => [...m, { role: "assistant", content: res.reply, actions: res.actions, truncated: res.truncated, formId }]);
      if (res.chatId) {
        if (!chatId) refreshChats();
        setChatId(res.chatId); store.set(LAST_KEY, res.chatId);
      }
    } catch (err) {
      setMessages((m) => m.slice(0, -1));
      if (err.name === "AbortError") { setInput(content); return; }
      setError(err.message);
      setFailedText(content);
      if (["NO_API_KEY", "CREDIT_EXHAUSTED"].includes(err.code)) loadStatus();
      if (err.code === "CHAT_NOT_FOUND") { setChatId(null); store.set(LAST_KEY, ""); refreshChats(); }
    } finally { setBusy(false); abortRef.current = null; }
  }
  const stop = () => abortRef.current?.abort();
  function copyReply(i, text) {
    try { navigator.clipboard?.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
  }

  sendRef.current = send;

  function runAction(a, i, k) {
    if (a.type === "open_form") onNavigate(`/edit/${a.formId}`);
    else if (a.type === "navigate") onNavigate(a.to);
    else if (a.type === "create_form") onOpenDraft(a.draft);
    else if (a.type === "edit_form") {
      const onScreen = (a.formId && formId === a.formId) || (!a.formId && page === "new");
      if (!onScreen) { if (a.formId) onNavigate(`/edit/${a.formId}`); return; }
      window.dispatchEvent(new CustomEvent("guut:assistant-apply", { detail: { formId: a.formId, title: a.title, description: a.description, fields: a.fields } }));
      setApplied((x) => ({ ...x, [`${i}.${k}`]: true }));
    }
  }

  async function toggleHistory(next) {
    setMenu(false);
    try { await api.assistantSettings(next); setStatus((s) => ({ ...s, saveHistory: next })); if (!next) { setChatId(null); store.set(LAST_KEY, ""); } else refreshChats(); }
    catch (err) { setError(err.message); }
  }
  async function deleteChat(id) {
    if (!confirm("Delete this chat? This can't be undone.")) return;
    try { await api.assistantChatDelete(id); } catch { /* already gone */ }
    if (id === chatId) openChat(null);
    refreshChats();
  }
  async function clearAll() {
    setMenu(false);
    if (!confirm("Delete all your saved GUUT AI chats? This can't be undone.")) return;
    try { await api.assistantClearHistory(); setChats([]); openChat(null); } catch (err) { setError(err.message); }
  }

  if (!user || !status) return null;

  const launcher = (onClick) => (
    <button className="assistant-launcher" onClick={onClick} aria-label="Open GUUT AI" title="GUUT AI (Ctrl+J)">
      <Icon name="spark" /><span className="assistant-launcher-label">GUUT AI</span>
    </button>
  );

  // No key: only the launcher; the card explains how to switch GUUT AI on when someone asks.
  if (!status.aiReady) {
    if (!cardOpen) return launcher(() => setCardOpen(true));
    return (
      <aside className="assistant-card" aria-label="GUUT AI">
        <div className="assistant-head">
          <span className="assistant-title"><Logo variant="mark" height={20} /> GUUT AI</span>
          <button className="icon-btn" onClick={() => setCardOpen(false)} aria-label="Close GUUT AI"><Icon name="close" /></button>
        </div>
        <div className="assistant-activate">
          <strong>Add your AI key to switch on GUUT AI</strong>
          <p>GUUT AI drafts and edits your forms as you talk to it, finds forms, explains responses and answers how-to questions. It runs on your own Claude or ChatGPT key, so you only pay your provider for what you use.</p>
          <button className="primary" onClick={() => { setCardOpen(false); onNavigate("/settings/ai"); }}>Add AI key</button>
          {status.failed && <button className="link-btn" onClick={loadStatus}>Check again</button>}
        </div>
      </aside>
    );
  }

  if (!open) return launcher(() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); });

  const empty = !messages.length;
  return (
    <aside className="assistant-panel" aria-label="GUUT AI">
      <div className="assistant-head">
        <span className="assistant-title"><Logo variant="mark" height={20} /> GUUT AI</span>
        <div className="assistant-head-actions">
          <button className="icon-btn" title="New chat" aria-label="New chat" onClick={() => openChat(null)}><Icon name="newChat" /></button>
          {saving && <button className={`icon-btn ${view === "history" ? "on" : ""}`} title="Chat history" aria-label="Chat history" onClick={() => { setView(view === "history" ? "chat" : "history"); refreshChats(); }}><Icon name="history" /></button>}
          <span className="assistant-menu-wrap" ref={menuRef}>
            <button className="icon-btn" title="Options" aria-label="Options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="settings" /></button>
            {menu && (
              <div className="assistant-menu" role="menu">
                <label className="assistant-menu-row">
                  <input type="checkbox" checked={!!status.saveHistory} disabled={!status.canSave} onChange={(e) => toggleHistory(e.target.checked)} />
                  <span><strong>Save chat history</strong><small>{status.canSave ? "Keep conversations so you can reopen them. Off: nothing is stored." : "Available once your account is approved."}</small></span>
                </label>
                <div className="assistant-menu-row column">
                  <strong>Answer length</strong>
                  <div className="seg-row" role="radiogroup" aria-label="Answer length">
                    {LENGTHS.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={length === id} className={`seg ${length === id ? "active" : ""}`} onClick={() => setLength(id)}>{label}</button>)}
                  </div>
                </div>
                {saving && <button className="assistant-menu-item danger-text" onClick={clearAll}>Delete all chats</button>}
                <button className="assistant-menu-item" onClick={() => { setMenu(false); onNavigate("/settings/ai"); }}>AI key and model</button>
                <button className="assistant-menu-item" onClick={() => { setMenu(false); onNavigate("/settings/usage"); }}>AI usage</button>
                <button className="assistant-menu-item" onClick={() => { setMenu(false); window.dispatchEvent(new Event("guut:report-open")); }}>Report a problem</button>
              </div>
            )}
          </span>
          <button className="icon-btn" title="Close" aria-label="Close GUUT AI" onClick={() => { setOpen(false); setMenu(false); }}><Icon name="close" /></button>
        </div>
      </div>

      {view === "history" ? (
        <div className="assistant-history">
          {!chats.length ? <p className="empty-hint">No saved chats yet.</p> : chats.map((c) => (
            <div key={c._id} className={`assistant-history-row ${c._id === chatId ? "current" : ""}`}>
              <button className="assistant-history-open" onClick={() => openChat(c._id)}><strong>{c.title || "Chat"}</strong><span>{c.kind === "analysis" ? "Form analysis, " : ""}{when(c.updatedAt)}</span></button>
              <button className="icon-btn" aria-label="Delete chat" title="Delete chat" onClick={() => deleteChat(c._id)}><Icon name="trash" size={16} /></button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="assistant-context">
            {formId ? (
              <>
                <span title="GUUT AI can see this form's questions and response statistics">Looking at <strong>{formTitle || (builder?.current?.formId === formId && builder.current.title) || "this form"}</strong></span>
                <label title="Lets GUUT AI read up to 150 recent answers for themes. Names, emails and files are never sent.">
                  <input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} /> Read sample answers
                </label>
              </>
            ) : page === "new" ? (
              <span>Looking at <strong>your new form</strong> (not saved yet)</span>
            ) : (
              <span>Can see <strong>your forms list</strong> and how GUUT Forms works</span>
            )}
          </div>
          <div className="assistant-body">
            {empty && (
              <div className="assistant-welcome">
                <p><strong>Hi{user.name ? ` ${user.name.split(" ")[0]}` : ""}.</strong> {page === "edit" ? "Ask me to change this form, explain its responses, or anything else." : page === "new" ? "Tell me what to add or change in this form." : "I can find your forms, draft new ones, and answer how-to questions."}</p>
                <div className="assistant-chips">{suggestionsFor(page).map((q) => <button key={q} className="chip" onClick={() => send(q)}>{q}</button>)}</div>
                {!saving && <p className="assistant-note">Chat history is off. This conversation is not saved.</p>}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.role}`}>
                {m.role === "assistant" ? <RichText text={m.content} /> : <p>{m.content}</p>}
                {m.role === "assistant" && <button className="assistant-copy" onClick={() => copyReply(i, m.content)} aria-label="Copy reply">{copied === i ? "Copied" : "Copy"}</button>}
                {m.truncated && <p className="assistant-cut">This answer was cut short. Choose a longer answer length in the options and ask again.</p>}
                {m.role === "assistant" && !!m.actions?.length && (
                  <div className="assistant-actions">
                    {m.actions.map((a, k) => {
                      if (a.type === "edit_form") {
                        const here = (a.formId && formId === a.formId) || (!a.formId && page === "new");
                        const done = applied[`${i}.${k}`];
                        return (
                          <div key={k} className="assistant-proposal">
                            {a.summary && <p>{a.summary}</p>}
                            <span className="assistant-proposal-meta">{a.fields.length} question{a.fields.length === 1 ? "" : "s"} after the change</span>
                            {m.earlier ? (
                              <span className="assistant-proposal-meta">From an earlier session, so the form may have changed since. Ask again for an up-to-date version.</span>
                            ) : (
                              <button className={done ? "secondary small" : "primary small"} disabled={done} onClick={() => runAction(a, i, k)}>{done ? "Applied. Check it and save" : here ? a.label || "Apply changes" : "Open the form to apply"}</button>
                            )}
                          </div>
                        );
                      }
                      return <button key={k} className="secondary small" onClick={() => runAction(a, i, k)}>{a.label}</button>;
                    })}
                  </div>
                )}
              </div>
            ))}
            {!busy && messages.length > 0 && (() => {
              const last = [...messages].reverse().find((m) => m.formId !== undefined);
              if (!last || (last.formId || null) === (formId || null)) return null;
              return (
                <div className="assistant-shift">
                  <span>{formId ? "You are now on a different form than this chat was about." : "This chat was about a form. You are now elsewhere."}</span>
                  <button className="link-btn" onClick={() => openChat(null)}>Start a new chat here</button>
                </div>
              );
            })()}
            {busy && <div className="assistant-msg assistant typing"><span /><span /><span /></div>}
            <div ref={endRef} />
          </div>
          {error && (
            <div className="error assistant-error" role="alert">
              <span>{error}</span>
              {failedText && <button className="link-btn" onClick={() => { const t = failedText; setInput(""); send(t); }}>Try again</button>}
            </div>
          )}
          <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea
              ref={inputRef} rows={2} value={input} maxLength={4000} placeholder={page === "edit" ? "Ask about or change this form..." : "Ask GUUT AI..."}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              aria-label="Message GUUT AI"
            />
            {busy
              ? <button className="icon-send stop" type="button" onClick={stop} aria-label="Stop"><span className="stop-square" /></button>
              : <button className="primary icon-send" type="submit" disabled={!input.trim()} aria-label="Send"><Icon name="send" /></button>}
          </form>
          <p className="assistant-foot">{saving ? "Saved to your history." : "History off: nothing is saved."} Enter to send, Shift+Enter for a new line.</p>
        </>
      )}
    </aside>
  );
}
