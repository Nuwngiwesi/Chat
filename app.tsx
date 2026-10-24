// LYNKO CHAT — browser client (React). Bundled by esbuild into public/app.js.
// All styling lives in the CSS string below. Message text is rendered as plain text (React escapes it).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import Pusher from "pusher-js";

/* ───────────── styles ───────────── */
const CSS = `
:root{--bg:#ECEFF3;--panel:#fff;--panel2:#F5F6F8;--line:#DADFE7;--text:#161B26;--muted:#626D80;--accent:#E2A53A;--accent-ink:#1B1405;--in:#fff;--tick:rgba(27,20,5,.5);--read:#0A57A8;--danger:#B42318;--focus:#1D5FD1}
@media (prefers-color-scheme:dark){:root{--bg:#0D1016;--panel:#151A23;--panel2:#1A202B;--line:#262E3B;--text:#E8EBF1;--muted:#8D97AA;--in:#1F2632;--danger:#F97066;--focus:#7AA7FF}}
*{box-sizing:border-box}html,body,#root{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:15px/1.45 "Avenir Next","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.brand{display:flex;align-items:center;gap:8px;font-weight:800;letter-spacing:.14em;font-size:15px}
.brand svg{width:26px;height:26px;color:var(--accent)}
.auth{min-height:100%;display:grid;place-items:center;padding:20px}
.card{width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:26px}
.card h1{font-size:22px;margin:18px 0 4px}.card p{margin:0 0 16px;color:var(--muted);font-size:14px}
.field{display:block;margin-bottom:12px;font-size:13px;color:var(--muted)}
.field input{display:block;width:100%;margin-top:4px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)}
.btn{border:0;border-radius:10px;padding:10px 14px;font-weight:700;background:var(--accent);color:var(--accent-ink)}
.btn:disabled{opacity:.55;cursor:default}
.btn.block{width:100%}.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--text);font-weight:600}.btn.danger{background:transparent;border:1px solid var(--danger);color:var(--danger)}
.link{background:none;border:0;color:var(--focus);padding:0;text-decoration:underline}
.err{color:var(--danger);font-size:13px;margin:0 0 10px}
.note{margin:12px auto;max-width:440px;text-align:center;font-size:12px;color:var(--muted);background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px 12px}
.shell{display:grid;grid-template-columns:340px 1fr;height:100%;max-width:1400px;margin:0 auto;background:var(--panel)}
.side{display:flex;flex-direction:column;border-right:1px solid var(--line);min-height:0}
.side header,.chat header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);min-height:60px}
.grow{flex:1;min-width:0}
.icon{background:none;border:0;border-radius:8px;padding:6px 9px;font-size:18px;color:var(--muted)}.icon:hover{background:var(--panel2)}
.search{padding:10px 14px}.search input{width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)}
.list{overflow:auto;flex:1;min-height:0}
.sect{padding:10px 16px 4px;font-size:12px;color:var(--muted);font-weight:600}
.row{display:flex;gap:12px;align-items:center;width:100%;text-align:left;border:0;background:none;padding:10px 16px;border-bottom:1px solid transparent}
.row:hover,.row[aria-current=true]{background:var(--panel2)}
.avatar{width:42px;height:42px;flex:none;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;position:relative}
.dot{position:absolute;right:-1px;bottom:-1px;width:12px;height:12px;border-radius:50%;background:#2E9F5B;border:2px solid var(--panel)}
.name{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:12px;color:var(--muted)}
.badge{background:var(--accent);color:var(--accent-ink);border-radius:999px;font-weight:700;font-size:12px;min-width:20px;padding:1px 6px;text-align:center}
.chat{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg)}
.chat header{background:var(--panel)}
.back{display:none}
.msgs{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:3px}
.day{align-self:center;font-size:12px;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:2px 10px;margin:10px 0}
.msg{display:flex;align-items:flex-end;gap:4px;max-width:78%;position:relative}.msg.mine{align-self:flex-end;flex-direction:row-reverse}
.bubble{padding:7px 11px 5px;border-radius:14px;background:var(--in);border:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
.mine .bubble{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.bubble.gone{font-style:italic;color:var(--muted);background:transparent;border-style:dashed}
.stamp{display:block;text-align:right;font-size:11px;opacity:.7;margin-top:1px;white-space:nowrap}
.tick{color:var(--tick);margin-left:4px}.tick.read{color:var(--read);opacity:1}
.more{opacity:0;border:0;background:none;color:var(--muted);padding:2px 6px;border-radius:6px}.msg:hover .more,.more:focus-visible,.more[aria-expanded=true]{opacity:1}
@media (hover:none){.more{opacity:.7}}
.menu{position:absolute;z-index:5;bottom:100%;margin-bottom:4px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px;min-width:190px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.mine .menu{right:0}.menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 10px;border-radius:8px}.menu button:hover{background:var(--panel2)}.menu .d{color:var(--danger)}
.compose{display:flex;gap:8px;align-items:flex-end;padding:10px 12px;background:var(--panel);border-top:1px solid var(--line);padding-bottom:max(10px,env(safe-area-inset-bottom))}
.compose textarea{flex:1;resize:none;max-height:140px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}
.empty{margin:auto;text-align:center;color:var(--muted);padding:30px;max-width:320px}
.spin{width:22px;height:22px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:sp .8s linear infinite;margin:24px auto}
@keyframes sp{to{transform:rotate(360deg)}}
.toasts{position:fixed;left:12px;right:12px;bottom:12px;display:flex;flex-direction:column;gap:8px;align-items:center;z-index:50;pointer-events:none}
.toast{background:#262B36;color:#fff;border-radius:10px;padding:10px 14px;font-size:14px;max-width:420px;box-shadow:0 6px 20px rgba(0,0,0,.3)}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px;z-index:40}
.modal{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px;max-width:420px;width:100%}
.modal h2{margin:0 0 10px;font-size:18px}.modal .stack{display:flex;flex-direction:column;gap:10px;margin-top:14px}
select{padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--panel2)}
@media (max-width:759px){.shell{grid-template-columns:1fr}.shell[data-view=list] .chat{display:none}.shell[data-view=chat] .side{display:none}.back{display:inline-block}.msg{max-width:88%}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:2s}}
`;

/* ───────────── types & helpers ───────────── */
type Me = { id: string; username: string; displayName: string };
type Peer = { id: string; username: string; displayName: string; online: boolean; lastSeenAt: string };
type Conv = { id: string; peer: Peer; disappearingSeconds: number | null; unread: number; lastMessageAt: string | null; last: { text: string | null; deleted: boolean; mine: boolean; createdAt: string } | null };
type Msg = { id: string; senderId: string; mine: boolean; text: string | null; deleted: boolean; createdAt: string; deliveredAt: string | null; readAt: string | null; expiresAt: string | null; clientMsgId?: string; pending?: boolean; failed?: boolean };
type Page = { messages: Msg[]; hasMore: boolean };

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? "GET", credentials: "same-origin", headers: hasBody ? { "Content-Type": "application/json" } : undefined, body: hasBody ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, "Network problem. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("lynko:unauth"));
    throw new ApiError(res.status, data?.error?.message ?? "Something went wrong");
  }
  return data as T;
}

const uid = () => crypto.randomUUID().replace(/-/g, "");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => {
  const d = new Date(iso), t = new Date();
  if (d.toDateString() === t.toDateString()) return "Today";
  t.setDate(t.getDate() - 1);
  return d.toDateString() === t.toDateString() ? "Yesterday" : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
};
const DUR: [number | null, string][] = [[null, "Off"], [3600, "1 hour"], [86400, "1 day"], [604800, "7 days"], [7776000, "90 days"]];
const isTmp = (m: Msg) => m.id.startsWith("tmp-");
const cmp = (x: Msg, y: Msg) => (isTmp(x) !== isTmp(y) ? (isTmp(x) ? 1 : -1) : isTmp(x) ? x.createdAt.localeCompare(y.createdAt) : x.id.localeCompare(y.id));
function merge(a: Msg[], b: Msg[]): Msg[] {
  const cids = new Set(b.map((m) => m.clientMsgId).filter(Boolean));
  const map = new Map<string, Msg>();
  for (const m of a) if (!(isTmp(m) && cids.has(m.clientMsgId))) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return [...map.values()].sort(cmp);
}
function lastSeen(p: Peer) {
  if (p.online) return "Online";
  const d = new Date(p.lastSeenAt);
  return `Last seen ${d.toDateString() === new Date().toDateString() ? fmtTime(p.lastSeenAt) : d.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

function Avatar({ name, online }: { name: string; online?: boolean }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="avatar" style={{ background: `hsl(${h} 30% 40%)` }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
      {online && <span className="dot" />}
    </span>
  );
}
const Brand = () => (
  <span className="brand">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 21V4l6 6 3-4 3 4 6-6v17z" /></svg>
    LYNKO CHAT
  </span>
);

/* ───────────── auth screen ───────────── */
function AuthScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ username: "", displayName: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api(mode === "login" ? "/api/login" : "/api/register", { method: "POST", body: mode === "login" ? { username: f.username, password: f.password } : f });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <form className="card" onSubmit={submit}>
        <Brand />
        <h1>{mode === "login" ? "Log in" : "Create your account"}</h1>
        <p>{mode === "login" ? "Pick up your private conversations." : "Choose a username people can find you by."}</p>
        <label className="field">Username<input value={f.username} onChange={set("username")} autoComplete="username" autoCapitalize="none" required /></label>
        {mode === "register" && <label className="field">Display name<input value={f.displayName} onChange={set("displayName")} autoComplete="name" maxLength={50} required /></label>}
        <label className="field">Password{mode === "register" && " (12+ characters)"}<input type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn block" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
        <p style={{ marginTop: 14, textAlign: "center" }}>
          {mode === "login" ? "New here? " : "Have an account? "}
          <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>{mode === "login" ? "Create an account" : "Log in"}</button>
        </p>
        <p className="note" style={{ margin: 0 }}>Not end-to-end encrypted. Messages are encrypted at rest with a server-held key.</p>
      </form>
    </main>
  );
}

/* ───────────── settings ───────────── */
function Settings({ me, onClose, onLogout }: { me: Me; onClose: () => void; onLogout: (all: boolean) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="st" onClick={(e) => e.stopPropagation()}>
        <h2 id="st">Settings</h2>
        <div className="row" style={{ padding: 0 }}><Avatar name={me.displayName} /><div><div className="name">{me.displayName}</div><div className="sub">@{me.username}</div></div></div>
        <p className="note" style={{ maxWidth: "none", textAlign: "left" }}><b>Not end-to-end encrypted.</b> Message text is encrypted at rest in the database with a key held by the server, so the service operator can read messages. Pusher only receives IDs, never message text.</p>
        <div className="stack">
          <button className="btn ghost" onClick={() => onLogout(false)}>Log out of this device</button>
          <button className="btn danger" onClick={() => onLogout(true)}>Log out of all devices</button>
          <button className="btn ghost" onClick={onClose} autoFocus>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── sidebar ───────────── */
function Sidebar({ me, convs, activeId, onOpen, onStart, onSettings }: { me: Me; convs: Conv[] | null; activeId: string | null; onOpen: (id: string) => void; onStart: (username: string) => void; onSettings: () => void }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<{ username: string; displayName: string }[]>([]);
  const term = q.trim().toLowerCase();
  useEffect(() => {
    if (!/^[a-z0-9_]{2,24}$/.test(term)) { setPeople([]); return; }
    let live = true;
    const t = setTimeout(() => api<{ users: typeof people }>(`/api/users/search?q=${encodeURIComponent(term)}`).then((r) => live && setPeople(r.users)).catch(() => {}), 250);
    return () => { live = false; clearTimeout(t); };
  }, [term]);
  const shown = (convs ?? []).filter((c) => !term || c.peer.username.includes(term) || c.peer.displayName.toLowerCase().includes(term));
  return (
    <nav className="side" aria-label="Conversations">
      <header><div className="grow"><Brand /></div><button className="icon" onClick={onSettings} aria-label={`Settings for ${me.displayName}`}>⚙</button></header>
      <div className="search"><label className="sr" htmlFor="q">Search chats or find people</label><input id="q" type="search" placeholder="Search chats or find a username" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></div>
      <div className="list">
        {convs === null && <div className="spin" role="status" aria-label="Loading conversations" />}
        {convs && shown.length === 0 && !term && <div className="empty">No chats yet. Search for a username above to start one.</div>}
        {shown.map((c) => (
          <button key={c.id} className="row" aria-current={c.id === activeId} onClick={() => { onOpen(c.id); setQ(""); }}>
            <Avatar name={c.peer.displayName} online={c.peer.online} />
            <span className="grow"><span className="name" style={{ display: "block" }}>{c.peer.displayName}</span>
              <span className="sub" style={{ display: "block" }}>{c.last ? (c.last.deleted ? "Message deleted" : `${c.last.mine ? "You: " : ""}${c.last.text}`) : "No messages yet"}</span></span>
            <span className="meta">{c.lastMessageAt && <span>{fmtTime(c.lastMessageAt)}</span>}{c.unread > 0 && <span className="badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}</span>
          </button>
        ))}
        {term && convs && shown.length === 0 && people.length === 0 && <div className="empty">No matches for “{q.trim()}”.</div>}
        {people.length > 0 && <div className="sect">People</div>}
        {people.map((p) => (
          <button key={p.username} className="row" onClick={() => { onStart(p.username); setQ(""); }}>
            <Avatar name={p.displayName} /><span className="grow"><span className="name" style={{ display: "block" }}>{p.displayName}</span><span className="sub">@{p.username} · Start chat</span></span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ───────────── chat ───────────── */
function ChatView({ conv, me, pusher, onBack, onChanged, notify }: { conv: Conv; me: Me; pusher: Pusher | null; onBack: () => void; onChanged: () => void; notify: (m: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [typingUntil, setTypingUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const msgsRef = useRef<Msg[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevH = useRef(0);
  const lastTyping = useRef(0);
  msgsRef.current = msgs;

  const loadLatest = useCallback(async () => {
    try {
      const r = await api<Page>(`/api/conversations/${conv.id}/messages?limit=30`);
      setMsgs((p) => merge(p, r.messages));
      setHasMore((h) => (msgsRef.current.length ? h : r.hasMore));
      setLoadErr("");
    } catch (e) {
      setLoadErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [conv.id]);

  const syncNew = useCallback(async () => {
    const last = [...msgsRef.current].reverse().find((m) => !isTmp(m));
    if (!last) return loadLatest();
    let cursor = last.id;
    try {
      for (let i = 0; i < 5; i++) {
        const r = await api<Page>(`/api/conversations/${conv.id}/messages?after=${cursor}&limit=50`);
        if (!r.messages.length) break;
        setMsgs((p) => merge(p, r.messages));
        cursor = r.messages[r.messages.length - 1].id;
        if (!r.hasMore) break;
      }
    } catch { /* the next event, poll or reconnect retries */ }
  }, [conv.id, loadLatest]);

  useEffect(() => { setMsgs([]); setLoading(true); setLoadErr(""); setText(""); stick.current = true; void loadLatest(); }, [conv.id, loadLatest]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!pusher) return;
    const chName = `private-conv-${conv.id}`, usName = `private-user-${me.id}`;
    const ch = pusher.subscribe(chName), us = pusher.subscribe(usName);
    const onNew = () => void syncNew();
    const onDel = (d: { messageId: string }) => setMsgs((p) => p.map((m) => (m.id === d.messageId ? { ...m, text: null, deleted: true } : m)));
    const onReceipt = (d: { userId: string; kind: "delivered" | "read"; upTo: string }) => {
      if (d.userId === me.id) return;
      const t = new Date().toISOString();
      setMsgs((p) => p.map((m) => (m.mine && !isTmp(m) && m.id <= d.upTo ? { ...m, deliveredAt: m.deliveredAt ?? t, readAt: d.kind === "read" ? m.readAt ?? t : m.readAt } : m)));
    };
    const onTyping = (d: { userId: string }) => { if (d.userId !== me.id) { setTypingUntil(Date.now() + 4000); setTimeout(() => setNow(Date.now()), 4100); } };
    const onConv = () => onChanged();
    const onHidden = (d: { messageId: string }) => setMsgs((p) => p.filter((m) => m.id !== d.messageId));
    const onState = (s: { current: string }) => { if (s.current === "connected") void loadLatest(); }; // recover anything missed while offline
    ch.bind("message.new", onNew); ch.bind("message.deleted", onDel); ch.bind("receipt", onReceipt); ch.bind("typing", onTyping); ch.bind("conversation.updated", onConv);
    us.bind("message.hidden", onHidden);
    pusher.connection.bind("state_change", onState);
    const poll = setInterval(() => { if (pusher.connection.state !== "connected") void syncNew(); }, 15000);
    return () => {
      ch.unbind("message.new", onNew); ch.unbind("message.deleted", onDel); ch.unbind("receipt", onReceipt); ch.unbind("typing", onTyping); ch.unbind("conversation.updated", onConv);
      us.unbind("message.hidden", onHidden);
      pusher.connection.unbind("state_change", onState);
      pusher.unsubscribe(chName);
      clearInterval(poll);
    };
  }, [pusher, conv.id, me.id, syncNew, loadLatest, onChanged]);

  // mark incoming messages read while this chat is visible
  useEffect(() => {
    if (!msgs.some((m) => !m.mine && !m.readAt && !m.deleted && !isTmp(m)) || document.visibilityState !== "visible") return;
    const t = setTimeout(() => {
      api(`/api/conversations/${conv.id}/read`, { method: "POST" }).then(() => {
        const iso = new Date().toISOString();
        setMsgs((p) => p.map((m) => (!m.mine && !m.readAt ? { ...m, readAt: iso, deliveredAt: m.deliveredAt ?? iso } : m)));
        onChanged();
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [msgs, conv.id, onChanged]);
  useEffect(() => {
    const v = () => document.visibilityState === "visible" && setMsgs((p) => [...p]);
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, []);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close); window.addEventListener("keydown", k);
    return () => { document.removeEventListener("click", close); window.removeEventListener("keydown", k); };
  }, [menuFor]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prevH.current) { el.scrollTop += el.scrollHeight - prevH.current; prevH.current = 0; }
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, loading]);

  async function older() {
    const first = msgs.find((m) => !isTmp(m));
    if (!first) return;
    prevH.current = listRef.current?.scrollHeight ?? 0;
    try {
      const r = await api<Page>(`/api/conversations/${conv.id}/messages?before=${first.id}&limit=30`);
      setMsgs((p) => merge(p, r.messages));
      setHasMore(r.hasMore);
    } catch (e) { prevH.current = 0; notify((e as Error).message); }
  }

  async function send(retry?: Msg) {
    const body = (retry?.text ?? text).trim();
    if (!body) return;
    const clientMsgId = retry?.clientMsgId ?? uid();
    const tmp: Msg = { id: `tmp-${clientMsgId}`, senderId: me.id, mine: true, text: body, deleted: false, createdAt: new Date().toISOString(), deliveredAt: null, readAt: null, expiresAt: null, clientMsgId, pending: true };
    setMsgs((p) => [...p.filter((m) => m.id !== tmp.id), tmp].sort(cmp));
    if (!retry) setText("");
    stick.current = true;
    try {
      const r = await api<{ message: Msg }>(`/api/conversations/${conv.id}/messages`, { method: "POST", body: { clientMsgId, text: body } });
      setMsgs((p) => merge(p, [r.message]));
      onChanged();
    } catch (e) {
      setMsgs((p) => p.map((m) => (m.id === tmp.id ? { ...m, pending: false, failed: true } : m)));
      notify((e as Error).message);
    }
  }

  async function del(m: Msg, scope: "me" | "everyone") {
    setMenuFor(null);
    if (isTmp(m)) { setMsgs((p) => p.filter((x) => x.id !== m.id)); return; }
    if (scope === "everyone" && !window.confirm("Delete this message for everyone in this chat?")) return;
    try {
      await api(`/api/messages/${m.id}?scope=${scope}`, { method: "DELETE" });
      setMsgs((p) => (scope === "me" ? p.filter((x) => x.id !== m.id) : p.map((x) => (x.id === m.id ? { ...x, text: null, deleted: true } : x))));
      onChanged();
    } catch (e) { notify((e as Error).message); }
  }

  function onType(v: string) {
    setText(v);
    if (v.trim() && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); api(`/api/conversations/${conv.id}/typing`, { method: "POST" }).catch(() => {}); }
  }
  async function setDisappearing(v: string) {
    try { await api(`/api/conversations/${conv.id}`, { method: "PATCH", body: { disappearingSeconds: v ? Number(v) : null } }); onChanged(); notify(v ? "Disappearing messages on for new messages." : "Disappearing messages off."); }
    catch (e) { notify((e as Error).message); }
  }

  const live = msgs.filter((m) => m.deleted || !m.expiresAt || new Date(m.expiresAt).getTime() > now);
  const typing = typingUntil > now;
  let prevDay = "";
  return (
    <section className="chat" aria-label={`Chat with ${conv.peer.displayName}`}>
      <header>
        <button className="icon back" onClick={onBack} aria-label="Back to conversations">←</button>
        <Avatar name={conv.peer.displayName} online={conv.peer.online} />
        <div className="grow"><div className="name">{conv.peer.displayName}</div><div className="sub" aria-live="polite">{typing ? "typing…" : lastSeen(conv.peer)}</div></div>
        <label className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>Disappearing
          <select value={conv.disappearingSeconds ?? ""} onChange={(e) => setDisappearing(e.target.value)} aria-label="Disappearing messages timer">
            {DUR.map(([v, l]) => <option key={l} value={v ?? ""}>{l}</option>)}
          </select>
        </label>
      </header>
      <div className="msgs" ref={listRef} role="log" aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <p className="note">Not end-to-end encrypted. Message text is encrypted at rest with a server-held key. Disappearing messages and deletions cannot remove screenshots or copies.</p>
        {loading && <div className="spin" role="status" aria-label="Loading messages" />}
        {loadErr && <div className="empty"><p className="err">{loadErr}</p><button className="btn ghost" onClick={() => { setLoading(true); void loadLatest(); }}>Try again</button></div>}
        {hasMore && <button className="btn ghost" style={{ alignSelf: "center" }} onClick={older}>Load older messages</button>}
        {!loading && !loadErr && live.length === 0 && <div className="empty">No messages yet. Say hello to {conv.peer.displayName}.</div>}
        {live.map((m) => {
          const day = fmtDay(m.createdAt);
          const sep = day !== prevDay ? <div className="day" key={`d-${m.id}`}>{day}</div> : null;
          prevDay = day;
          const age = Date.now() - new Date(m.createdAt).getTime();
          return [sep,
            <div key={m.id} className={`msg${m.mine ? " mine" : ""}`}>
              <div className={`bubble${m.deleted ? " gone" : ""}`}>
                {m.deleted ? (m.mine ? "You deleted this message" : "This message was deleted") : m.text}
                <span className="stamp">{fmtTime(m.createdAt)}{m.expiresAt && !m.deleted ? " ⏱" : ""}
                  {m.mine && !m.deleted && (m.failed ? <span className="tick" style={{ color: "var(--danger)" }}> Failed</span> : m.pending ? <span className="tick"> …</span> : <span className={`tick${m.readAt ? " read" : ""}`} aria-label={m.readAt ? "Read" : m.deliveredAt ? "Delivered" : "Sent"}>{m.readAt || m.deliveredAt ? "✓✓" : "✓"}</span>)}
                </span>
              </div>
              {m.failed && <button className="more" style={{ opacity: 1 }} onClick={() => send(m)}>Retry</button>}
              {!m.deleted && !m.pending && (
                <>
                  <button className="more" aria-label="Message options" aria-expanded={menuFor === m.id} onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}>⋯</button>
                  {menuFor === m.id && (
                    <div className="menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <button role="menuitem" onClick={() => del(m, "me")}>Delete for me</button>
                      {m.mine && age < 2 * 86400000 && <button role="menuitem" className="d" onClick={() => del(m, "everyone")}>Delete for everyone</button>}
                    </div>
                  )}
                </>
              )}
              {m.failed && <button className="more" style={{ opacity: 1 }} onClick={() => del(m, "me")}>Discard</button>}
            </div>];
        })}
      </div>
      <form className="compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="sr" htmlFor="composer">Message</label>
        <textarea id="composer" rows={1} value={text} placeholder="Write a message" maxLength={4000} onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="btn" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}

/* ───────────── app ───────────── */
function App() {
  const [boot, setBoot] = useState<"loading" | "anon" | "ready">("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [cfg, setCfg] = useState<{ key: string; cluster: string } | null>(null);
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pusher, setPusher] = useState<Pusher | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const notify = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const loadConvs = useCallback(async () => {
    try { setConvs((await api<{ conversations: Conv[] }>("/api/conversations")).conversations); }
    catch (e) { if ((e as ApiError).status !== 401) notify((e as Error).message); setConvs((c) => c ?? []); }
  }, [notify]);
  const refreshMe = useCallback(async () => {
    try {
      const r = await api<{ user: Me; pusher: { key: string; cluster: string } }>("/api/me");
      setMe(r.user); setCfg(r.pusher); setBoot("ready");
    } catch { setBoot("anon"); }
  }, []);

  useEffect(() => { void refreshMe(); }, [refreshMe]);
  useEffect(() => {
    const h = () => { if (meRef.current) { setMe(null); setCfg(null); setConvs(null); setActiveId(null); setBoot("anon"); notify("Your session expired. Please log in again."); } };
    window.addEventListener("lynko:unauth", h);
    return () => window.removeEventListener("lynko:unauth", h);
  }, [notify]);

  useEffect(() => { if (me) void loadConvs(); }, [me, loadConvs]);
  useEffect(() => {
    if (!cfg || !me) return;
    const p = new Pusher(cfg.key, { cluster: cfg.cluster, channelAuthorization: { endpoint: "/api/pusher/auth", transport: "ajax" } });
    const ch = p.subscribe(`private-user-${me.id}`);
    const reload = () => void loadConvs();
    ch.bind("inbox.update", reload); ch.bind("conversation.new", reload);
    setPusher(p);
    return () => { p.disconnect(); setPusher(null); };
  }, [cfg, me, loadConvs]);

  // presence heartbeat + list refresh (also keeps "online" from going stale)
  useEffect(() => {
    if (!me) return;
    const tick = () => { if (document.visibilityState === "visible") { api("/api/heartbeat", { method: "POST" }).catch(() => {}); void loadConvs(); } };
    const t = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [me, loadConvs]);

  async function start(username: string) {
    try { const r = await api<{ id: string }>("/api/conversations", { method: "POST", body: { username } }); await loadConvs(); setActiveId(r.id); }
    catch (e) { notify((e as Error).message); }
  }
  async function logout(all: boolean) {
    try { await api("/api/logout", { method: "POST", body: all ? { all: true } : {} }); } catch { /* cookie is cleared server-side when reachable */ }
    setShowSettings(false); setMe(null); setCfg(null); setConvs(null); setActiveId(null); setBoot("anon");
  }

  const active = convs?.find((c) => c.id === activeId) ?? null;
  return (
    <>
      {boot === "loading" && <div className="spin" role="status" aria-label="Loading" style={{ marginTop: "40vh" }} />}
      {boot === "anon" && <AuthScreen onDone={() => { setBoot("loading"); void refreshMe(); }} />}
      {boot === "ready" && me && (
        <div className="shell" data-view={active ? "chat" : "list"}>
          <Sidebar me={me} convs={convs} activeId={activeId} onOpen={setActiveId} onStart={start} onSettings={() => setShowSettings(true)} />
          {active ? <ChatView key={active.id} conv={active} me={me} pusher={pusher} onBack={() => setActiveId(null)} onChanged={loadConvs} notify={notify} />
            : <div className="chat"><div className="empty"><Brand /><p style={{ marginTop: 14 }}>Select a conversation, or search for a username to start a new private chat.</p></div></div>}
        </div>
      )}
      {showSettings && me && <Settings me={me} onClose={() => setShowSettings(false)} onLogout={logout} />}
      <div className="toasts" aria-live="assertive">{toasts.map((t) => <div key={t.id} className="toast" role="status">{t.msg}</div>)}</div>
    </>
  );
}

const style = document.createElement("style");
style.textContent = CSS;
document.head.append(style);
createRoot(document.getElementById("root")!).render(<App />);
