import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import Logo from "./Logo.jsx";
import RichText from "./RichText.jsx";

// GUUT AI: one assistant beside every signed-in page. Docked on the right and open by default once an AI
// key is saved (a close button tucks it away; the launcher brings it back). Without a key it shows a small
// card asking for one. It knows the page you are on and the form that is open, so it can find forms, draft
// new ones, propose edits you apply in the builder, and explain responses.
//
// History: with "Save chat history" on (the default) every conversation is stored on the server and listed
// under History. Switched off, nothing is stored: the thread lives in this tab only and is sent along with
// each message.

const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const OPEN_KEY = "guut_assistant_open";
const LAST_KEY = "guut_assistant_chat";

const SUGGESTIONS = {
  edit: ["Suggest improvements to this form", "Add a question asking how they heard about us", "Summarise the responses so far", "Make the questions shorter and clearer"],
  new: ["Add 3 questions about customer satisfaction", "Make this form shorter", "Add a follow-up question for low ratings"],
  home: ["Find my most recent draft", "Draft an event RSVP form", "Which of my forms are published?"],
  teams: ["How do team reviewers work?", "How do I share a form with a whole team?"],
  settings: ["Where do I add my AI key?", "How do response emails work?"],
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
  const [open, setOpen] = useState(() => store.get(OPEN_KEY, window.innerWidth >= 1180 ? "1" : "0") === "1");
  const [view, setView] = useState("chat"); // chat | history
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]); // { role, content, actions? }
  const [chats, setChats] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState({}); // message index -> "applied"
  const [menu, setMenu] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const page = route.name;
  const formId = page === "edit" ? route.id : null;

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
  useEffect(() => { if (firstRender.current) firstRender.current = false; else store.set(OPEN_KEY, open ? "1" : "0"); document.documentElement.classList.toggle("assistant-docked", !!(open && status?.aiReady)); }, [open, status?.aiReady]);
  useEffect(() => () => document.documentElement.classList.remove("assistant-docked"), []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, busy]);
  // Other parts of the app can open the assistant with a question ("Ask GUUT AI").
  useEffect(() => {
    const on = (e) => { setOpen(true); setView("chat"); if (e.detail?.prompt) setInput(e.detail.prompt); setTimeout(() => inputRef.current?.focus(), 50); };
    window.addEventListener("guut:assistant-open", on);
    return () => window.removeEventListener("guut:assistant-open", on);
  }, []);

  async function openChat(id) {
    setError(null); setApplied({}); setView("chat");
    if (!id) { setChatId(null); setMessages([]); store.set(LAST_KEY, ""); return; }
    try {
      const c = await api.assistantChatGet(id);
      setChatId(c._id); setMessages(c.messages || []); store.set(LAST_KEY, c._id);
    } catch { setChatId(null); setMessages([]); store.set(LAST_KEY, ""); }
  }

  function contextNow() {
    const ctx = { page };
    if (formId) ctx.formId = formId;
    const b = builder?.current;
    if (b && (page === "new" || (formId && b.formId === formId))) ctx.draft = { title: b.title, description: b.description, fields: b.fields };
    return ctx;
  }

  async function send(text) {
    const content = String(text ?? input).trim();
    if (!content || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content }]);
    setInput(""); setBusy(true); setError(null);
    try {
      const res = await api.assistantChat({ message: content, chatId: saving ? chatId : null, history: saving ? undefined : history, context: contextNow() });
      setMessages((m) => [...m, { role: "assistant", content: res.reply, actions: res.actions }]);
      if (res.chatId) {
        if (!chatId) refreshChats();
        setChatId(res.chatId); store.set(LAST_KEY, res.chatId);
      }
    } catch (err) {
      setMessages((m) => m.slice(0, -1));
      setInput(content);
      setError(err.message);
      if (["NO_API_KEY", "CREDIT_EXHAUSTED"].includes(err.code)) loadStatus();
      if (err.code === "CHAT_NOT_FOUND") { setChatId(null); store.set(LAST_KEY, ""); refreshChats(); }
    } finally { setBusy(false); }
  }

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

  // No key: a small card that says how to switch the assistant on.
  if (!status.aiReady) {
    if (!open) return <button className="assistant-launcher" onClick={() => setOpen(true)} aria-label="Open GUUT AI"><Icon name="spark" /> GUUT AI</button>;
    return (
      <aside className="assistant-card" aria-label="GUUT AI">
        <div className="assistant-head">
          <span className="assistant-title"><Logo variant="mark" height={20} /> GUUT AI</span>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close GUUT AI"><Icon name="close" /></button>
        </div>
        <div className="assistant-activate">
          <strong>Add your AI key to activate GUUT AI</strong>
          <p>GUUT AI edits your forms as you talk to it, finds forms, explains responses and answers how-to questions. It runs on your own Claude or ChatGPT key, so you only pay your provider for what you use.</p>
          <button className="primary" onClick={() => onNavigate("/settings/ai")}>Add AI key</button>
          {status.failed && <button className="link-btn" onClick={loadStatus}>Check again</button>}
        </div>
      </aside>
    );
  }

  if (!open) return <button className="assistant-launcher" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }} aria-label="Open GUUT AI"><Icon name="spark" /> GUUT AI</button>;

  const empty = !messages.length;
  return (
    <aside className="assistant-panel" aria-label="GUUT AI">
      <div className="assistant-head">
        <span className="assistant-title"><Logo variant="mark" height={20} /> GUUT AI</span>
        <div className="assistant-head-actions">
          <button className="icon-btn" title="New chat" aria-label="New chat" onClick={() => openChat(null)}><Icon name="newChat" /></button>
          {saving && <button className={`icon-btn ${view === "history" ? "on" : ""}`} title="Chat history" aria-label="Chat history" onClick={() => { setView(view === "history" ? "chat" : "history"); refreshChats(); }}><Icon name="history" /></button>}
          <span className="assistant-menu-wrap">
            <button className="icon-btn" title="Options" aria-label="Options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="settings" /></button>
            {menu && (
              <div className="assistant-menu" role="menu">
                <label className="assistant-menu-row">
                  <input type="checkbox" checked={!!status.saveHistory} disabled={!status.canSave} onChange={(e) => toggleHistory(e.target.checked)} />
                  <span><strong>Save chat history</strong><small>{status.canSave ? "Keep conversations so you can reopen them. Off: nothing is stored." : "Available once your account is approved."}</small></span>
                </label>
                {saving && <button className="assistant-menu-item danger-text" onClick={clearAll}>Delete all chats</button>}
                <button className="assistant-menu-item" onClick={() => { setMenu(false); onNavigate("/settings/ai"); }}>AI key and model</button>
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
              <button className="assistant-history-open" onClick={() => openChat(c._id)}><strong>{c.title || "Chat"}</strong><span>{when(c.updatedAt)}</span></button>
              <button className="icon-btn" aria-label="Delete chat" title="Delete chat" onClick={() => deleteChat(c._id)}><Icon name="trash" size={16} /></button>
            </div>
          ))}
        </div>
      ) : (
        <>
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
                            <button className={done ? "secondary small" : "primary small"} disabled={done} onClick={() => runAction(a, i, k)}>{done ? "Applied. Review and save" : here ? a.label || "Apply changes" : "Open the form to apply"}</button>
                          </div>
                        );
                      }
                      return <button key={k} className="secondary small" onClick={() => runAction(a, i, k)}>{a.label}</button>;
                    })}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="assistant-msg assistant typing"><span /><span /><span /></div>}
            <div ref={endRef} />
          </div>
          {error && <p className="error assistant-error">{error}</p>}
          <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea
              ref={inputRef} rows={2} value={input} maxLength={4000} placeholder={page === "edit" ? "Ask about or change this form..." : "Ask GUUT AI..."}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              aria-label="Message GUUT AI"
            />
            <button className="primary icon-send" type="submit" disabled={busy || !input.trim()} aria-label="Send"><Icon name="send" /></button>
          </form>
          <p className="assistant-foot">{saving ? "Chats are saved to your history." : "History off: nothing is saved."} Uses your own AI key.</p>
        </>
      )}
    </aside>
  );
}
