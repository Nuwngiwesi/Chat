// LYNKO CHAT — single-file backend (Hono on Vercel). Serves the HTML shell, the JSON API
// and the Pusher channel-auth endpoint. The browser bundle (public/app.js) is built from app.tsx.
// SECURITY NOTE: messages are NOT end-to-end encrypted. They are encrypted at rest with a
// server-held key (AES-256-GCM); the server can read them. See README.md.
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { MongoClient, ObjectId, type Db, type Filter, type WithId } from "mongodb";
import { hash, verify } from "@node-rs/argon2";
import Pusher from "pusher";
import { z } from "zod";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/* ───────────────────────── configuration ───────────────────────── */

const envSchema = z.object({
  MONGODB_URI: z.string().startsWith("mongodb"),
  MONGODB_DB: z.string().min(1).default("lynko"),
  SESSION_SECRET: z.string().min(32),
  MESSAGE_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64"),
  PUSHER_APP_ID: z.string().min(1),
  PUSHER_KEY: z.string().min(1),
  PUSHER_SECRET: z.string().min(1),
  PUSHER_CLUSTER: z.string().min(1),
});
let _env: z.infer<typeof envSchema> | undefined;
function env() {
  if (_env) return _env;
  const p = envSchema.safeParse(process.env);
  if (!p.success) throw new Error("Invalid environment: " + p.error.issues.map((i) => i.path.join(".")).join(", "));
  return (_env = p.data);
}
const PROD = !!process.env.VERCEL || process.env.NODE_ENV === "production";
const DAY = 86_400_000;
const IDLE_MS = 30 * DAY;
const ABSOLUTE_MS = 90 * DAY;
const DELETE_WINDOW_MS = 2 * DAY; // policy: "delete for everyone" allowed for 48h after sending
const TOMBSTONE_MS = 30 * DAY; // deleted-for-everyone stubs are kept so offline devices learn of the deletion
const ONLINE_MS = 70_000; // online = heartbeat within 70s (heartbeat every 30s); otherwise "last seen"
const DISAPPEARING = [3600, 86400, 604800, 7776000] as const;

/* ───────────────────────── errors & helpers ───────────────────────── */

class HttpError extends Error {
  constructor(public status: ContentfulStatusCode, public code: string, message: string, public headers?: Record<string, string>) {
    super(message);
  }
}
const notFound = () => new HttpError(404, "not_found", "Not found");
const isDup = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
const hmac = (v: string, purpose: string) => createHmac("sha256", env().SESSION_SECRET).update(`${purpose}\0${v}`).digest("hex");
const oid = (s: string | undefined) => (s && /^[a-f0-9]{24}$/i.test(s) ? new ObjectId(s) : null);
const hex = (o: ObjectId) => o.toHexString();
const clientIp = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const text = await c.req.text();
  if (text.length > 16_384) throw new HttpError(413, "too_large", "Request too large");
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "invalid_json", "Malformed JSON");
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new HttpError(400, "validation_error", `${i.path.join(".") || "Request"}: ${i.message}`);
  }
  return r.data;
}

const idStr = z.string().regex(/^[a-f0-9]{24}$/i);
const RESERVED = new Set(["admin", "administrator", "root", "support", "help", "system", "security", "lynko", "lynkochat", "moderator", "staff", "official", "api"]);
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, "3–24 characters: letters, numbers, underscore").refine((v) => !RESERVED.has(v), "This username is reserved");
const passwordSchema = z.string().min(12, "Use at least 12 characters").max(128, "Use at most 128 characters");

/* ───────────────────────── database ───────────────────────── */

type UserDoc = { _id: ObjectId; username: string; displayName: string; passwordHash: string; status: "active" | "suspended"; lastSeenAt: Date; createdAt: Date };
type SessionDoc = { _id: ObjectId; tokenHash: string; userId: ObjectId; ua: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date; absoluteExpiresAt: Date };
type ConvDoc = { _id: ObjectId; participants: ObjectId[]; pairKey: string; disappearingSeconds: number | null; lastMessageAt: Date | null; createdAt: Date };
type MsgDoc = {
  _id: ObjectId; conversationId: ObjectId; senderId: ObjectId; clientMsgId: string;
  body: string; // "v1.iv.tag.ciphertext" (server-side AES-GCM); "" once deleted for everyone
  createdAt: Date; deliveredAt: Date | null; readAt: Date | null;
  deletedFor: ObjectId[]; deletedForEveryoneAt: Date | null; expiresAt?: Date;
};
type RlDoc = { _id: string; count: number; expiresAt: Date };

type G = typeof globalThis & { _lynkoDb?: Promise<Db> };
function db(): Promise<Db> {
  const g = globalThis as G; // cached across warm serverless invocations
  if (!g._lynkoDb) {
    g._lynkoDb = (async () => {
      const e = env();
      const client = new MongoClient(e.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const d = client.db(e.MONGODB_DB);
      await ensureIndexes(d);
      return d;
    })().catch((err) => {
      g._lynkoDb = undefined;
      throw err;
    });
  }
  return g._lynkoDb;
}

async function ensureIndexes(d: Db) {
  await Promise.all([
    d.collection("users").createIndex({ username: 1 }, { unique: true }),
    d.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    d.collection("sessions").createIndex({ userId: 1, createdAt: -1 }),
    d.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // expired sessions: safe to auto-delete
    d.collection("conversations").createIndex({ pairKey: 1 }, { unique: true }), // one conversation per pair
    d.collection("conversations").createIndex({ participants: 1, lastMessageAt: -1 }),
    d.collection("messages").createIndex({ conversationId: 1, _id: -1 }), // cursor pagination
    d.collection("messages").createIndex({ conversationId: 1, senderId: 1, clientMsgId: 1 }, { unique: true }), // retry dedupe
    d.collection("messages").createIndex({ conversationId: 1, readAt: 1 }), // unread counts
    d.collection("messages").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // disappearing messages + tombstones
    d.collection("ratelimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

async function col() {
  const d = await db();
  return {
    users: d.collection<UserDoc>("users"),
    sessions: d.collection<SessionDoc>("sessions"),
    convs: d.collection<ConvDoc>("conversations"),
    msgs: d.collection<MsgDoc>("messages"),
    rl: d.collection<RlDoc>("ratelimits"),
  };
}

/* ───────────────────────── rate limiting (Mongo-backed fixed window) ───────────────────────── */

async function limit(scope: string, id: string, max: number, windowSec: number) {
  const { rl } = await col();
  const w = windowSec * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / w);
  const end = (bucket + 1) * w;
  const key = `${scope}:${hmac(id, "rl")}:${bucket}`;
  const run = () => rl.findOneAndUpdate({ _id: key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(end + 60_000) } }, { upsert: true, returnDocument: "after" });
  let doc;
  try {
    doc = await run();
  } catch (e) {
    if (!isDup(e)) throw e;
    doc = await run();
  }
  if ((doc?.count ?? 0) > max) {
    throw new HttpError(429, "rate_limited", "Too many attempts. Try again shortly.", { "Retry-After": String(Math.max(1, Math.ceil((end - now) / 1000))) });
  }
}

/* ───────────────────────── passwords ───────────────────────── */

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const; // OWASP minimum Argon2id profile
async function hashPassword(pw: string) {
  const h = await hash(pw, ARGON);
  if (!h.startsWith("$argon2id$")) throw new Error("Unexpected hash algorithm");
  return h;
}
const checkPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);
let dummy: Promise<string> | undefined;
async function burn(pw: string) {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  await checkPassword(await dummy, pw);
}

/* ───────────────────────── message encryption at rest (server-side, NOT E2EE) ───────────────────────── */

const aadOf = (m: { conversationId: ObjectId; senderId: ObjectId }) => `${hex(m.conversationId)}:${hex(m.senderId)}`;
function seal(text: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(env().MESSAGE_KEY, "base64"), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
function unseal(s: string, aad: string): string {
  const [v, iv, tag, ct] = s.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad format");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(env().MESSAGE_KEY, "base64"), Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
const readable = (m: MsgDoc) => {
  try {
    return unseal(m.body, aadOf(m));
  } catch {
    return "⚠ Unable to read this message";
  }
};

/* ───────────────────────── sessions & auth ───────────────────────── */

type Auth = { user: WithId<UserDoc>; sessionId: ObjectId };
const cookieName = () => (PROD ? "__Host-lynko_sid" : "lynko_sid"); // __Host- forces Secure, Path=/, no Domain
const cookieOpts = (maxAge: number) => ({ httpOnly: true, secure: PROD, sameSite: "Lax" as const, path: "/", maxAge });

async function startSession(c: Context, userId: ObjectId) {
  const { sessions } = await col();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await sessions.insertOne({
    tokenHash: hmac(token, "session"), userId, ua: (c.req.header("user-agent") ?? "").slice(0, 200),
    createdAt: new Date(now), lastSeenAt: new Date(now), expiresAt: new Date(now + IDLE_MS), absoluteExpiresAt: new Date(now + ABSOLUTE_MS),
  } as SessionDoc);
  const stale = await sessions.find({ userId }).sort({ createdAt: -1 }).skip(20).project<{ _id: ObjectId }>({ _id: 1 }).toArray();
  if (stale.length) await sessions.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
  setCookie(c, cookieName(), token, cookieOpts(ABSOLUTE_MS / 1000)); // only the HMAC of the token is stored
}

async function authenticate(c: Context): Promise<Auth | null> {
  const token = getCookie(c, cookieName());
  if (!token || token.length > 100) return null;
  const { sessions, users } = await col();
  const s = await sessions.findOne({ tokenHash: hmac(token, "session") });
  if (!s) return null;
  const now = new Date();
  if (s.expiresAt <= now || s.absoluteExpiresAt <= now) {
    await sessions.deleteOne({ _id: s._id });
    return null;
  }
  const user = await users.findOne({ _id: s.userId });
  if (!user || user.status !== "active") {
    await sessions.deleteOne({ _id: s._id });
    return null;
  }
  if (now.getTime() - s.lastSeenAt.getTime() > 3_600_000) {
    await sessions.updateOne({ _id: s._id }, { $set: { lastSeenAt: now, expiresAt: new Date(Math.min(now.getTime() + IDLE_MS, s.absoluteExpiresAt.getTime())) } });
  }
  if (now.getTime() - user.lastSeenAt.getTime() > 30_000) {
    await users.updateOne({ _id: user._id }, { $set: { lastSeenAt: now } });
    user.lastSeenAt = now;
  }
  return { user, sessionId: s._id };
}

const requireAuth = createMiddleware<{ Variables: { auth: Auth } }>(async (c, next) => {
  const a = await authenticate(c);
  if (!a) throw new HttpError(401, "unauthorized", "Authentication required");
  c.set("auth", a); // identity ALWAYS comes from the session, never from the request
  await next();
});

/* ───────────────────────── authorization ───────────────────────── */

/** Membership is part of the query. Non-members get 404, so conversation IDs cannot be probed or guessed into access. */
async function memberConv(id: string | undefined, me: ObjectId) {
  const _id = oid(id);
  if (!_id) throw notFound();
  const { convs } = await col();
  const conv = await convs.findOne({ _id, participants: me });
  if (!conv) throw notFound();
  return conv;
}
const visible = (me: ObjectId, now: Date): Filter<MsgDoc> => ({ deletedFor: { $ne: me }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] });

/* ───────────────────────── realtime (Pusher) ───────────────────────── */
// Events carry IDs only — never message text. Clients fetch content from the authenticated API.

let _pusher: Pusher | undefined;
const pusher = () => (_pusher ??= new Pusher({ appId: env().PUSHER_APP_ID, key: env().PUSHER_KEY, secret: env().PUSHER_SECRET, cluster: env().PUSHER_CLUSTER, useTLS: true }));
const convChannel = (id: ObjectId) => `private-conv-${hex(id)}`;
const userChannel = (id: ObjectId) => `private-user-${hex(id)}`;
async function publish(events: { channel: string; name: string; data: Record<string, unknown> }[]) {
  try {
    await pusher().triggerBatch(events);
  } catch (e) {
    console.error("pusher_error", (e as Error).name); // delivery is best-effort; clients recover via sync on reconnect
  }
}

/* ───────────────────────── DTOs ───────────────────────── */

function msgDto(m: WithId<MsgDoc>, me: ObjectId) {
  const mine = m.senderId.equals(me);
  const deleted = !!m.deletedForEveryoneAt;
  return {
    id: hex(m._id), senderId: hex(m.senderId), mine, deleted, text: deleted ? null : readable(m),
    createdAt: m.createdAt.toISOString(), deliveredAt: m.deliveredAt?.toISOString() ?? null, readAt: m.readAt?.toISOString() ?? null,
    expiresAt: !deleted && m.expiresAt ? m.expiresAt.toISOString() : null, clientMsgId: mine ? m.clientMsgId : undefined,
  };
}

/** Marks incoming messages delivered/read, and tells the sender (server sets the actor; clients cannot spoof receipts). */
async function markStates(conv: WithId<ConvDoc>, me: ObjectId, kind: "delivered" | "read") {
  const { msgs } = await col();
  const now = new Date();
  const base: Filter<MsgDoc> = { conversationId: conv._id, senderId: { $ne: me }, deletedForEveryoneAt: null, ...visible(me, now) };
  const filter: Filter<MsgDoc> = kind === "read" ? { ...base, readAt: null } : { ...base, deliveredAt: null };
  const rows = await msgs.find(filter).project<{ _id: ObjectId }>({ _id: 1 }).toArray();
  if (!rows.length) return;
  const set = kind === "read" ? { $set: { readAt: now, deliveredAt: { $ifNull: ["$deliveredAt", now] } } } : { $set: { deliveredAt: now } };
  await msgs.updateMany({ _id: { $in: rows.map((r) => r._id) } }, [set]);
  const upTo = rows.map((r) => hex(r._id)).sort().pop()!;
  const other = conv.participants.find((p) => !p.equals(me))!;
  await publish([{ channel: convChannel(conv._id), name: "receipt", data: { userId: hex(me), kind, upTo } }, { channel: userChannel(other), name: "inbox.update", data: { conversationId: hex(conv._id) } }]);
}

/* ───────────────────────── app & routes ───────────────────────── */

const app = new Hono<{ Variables: { auth: Auth } }>();

app.onError((err, c) => {
  if (err instanceof HttpError) {
    for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error("api_error", { name: err.name, code: (err as { code?: unknown }).code }); // never log bodies, tokens or messages
  return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
});
app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    let ok = false;
    try {
      const o = c.req.header("origin");
      ok = !!o && new URL(o).host === c.req.header("host");
    } catch {
      ok = false;
    }
    if (!ok) throw new HttpError(403, "bad_origin", "Cross-origin request blocked");
  }
  c.header("Cache-Control", "no-store");
  await next();
});

const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>LYNKO CHAT</title></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>`;
app.get("/", (c) => {
  c.header("Cache-Control", "no-cache");
  return c.html(SHELL);
});

/* ── auth ── */

app.post("/api/register", async (c) => {
  await limit("register:ip", clientIp(c), 10, 3600);
  const b = await readBody(c, z.object({ username: usernameSchema, displayName: z.string().trim().min(1).max(50).regex(/^[^\p{C}]+$/u, "Invalid characters"), password: passwordSchema }).strict());
  const passwordHash = await hashPassword(b.password);
  const { users } = await col();
  const now = new Date();
  let id: ObjectId;
  try {
    id = (await users.insertOne({ username: b.username, displayName: b.displayName, passwordHash, status: "active", lastSeenAt: now, createdAt: now } as UserDoc)).insertedId;
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, "username_taken", "That username is taken");
    throw e;
  }
  await startSession(c, id);
  return c.json({ ok: true }, 201);
});

app.post("/api/login", async (c) => {
  const b = await readBody(c, z.object({ username: z.string().trim().toLowerCase().min(1).max(50), password: z.string().min(1).max(128) }).strict());
  await limit("login:ip", clientIp(c), 30, 900);
  await limit("login:user", b.username, 8, 900); // can briefly lock a victim out; accepted vs. unbounded guessing
  const { users } = await col();
  const user = await users.findOne({ username: b.username });
  const ok = user ? await checkPassword(user.passwordHash, b.password) : (await burn(b.password), false);
  if (!user || !ok || user.status !== "active") throw new HttpError(401, "invalid_credentials", "Invalid username or password");
  await startSession(c, user._id);
  return c.json({ ok: true });
});

app.post("/api/logout", async (c) => {
  const b = await readBody(c, z.object({ all: z.boolean().optional() }).strict());
  const token = getCookie(c, cookieName());
  const { sessions } = await col();
  if (token) {
    const th = hmac(token, "session");
    if (b.all) {
      const s = await sessions.findOne({ tokenHash: th });
      if (s) await sessions.deleteMany({ userId: s.userId });
    }
    await sessions.deleteOne({ tokenHash: th });
  }
  setCookie(c, cookieName(), "", cookieOpts(0));
  return c.json({ ok: true });
});

app.get("/api/me", requireAuth, (c) => {
  const u = c.get("auth").user;
  // Pusher key + cluster are public by design; the secret never leaves the server.
  return c.json({ user: { id: hex(u._id), username: u.username, displayName: u.displayName }, pusher: { key: env().PUSHER_KEY, cluster: env().PUSHER_CLUSTER } });
});

app.post("/api/heartbeat", requireAuth, (c) => c.body(null, 204)); // requireAuth refreshes lastSeenAt

/* ── users & conversations ── */

app.get("/api/users/search", requireAuth, async (c) => {
  const me = c.get("auth").user;
  await limit("search", hex(me._id), 60, 60);
  const q = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,24}$/).safeParse(c.req.query("q"));
  if (!q.success) return c.json({ users: [] });
  const { users } = await col();
  // q is restricted to [a-z0-9_] above, so interpolating it into a prefix regex cannot inject operators.
  const rows = await users.find({ username: { $regex: `^${q.data}` }, _id: { $ne: me._id }, status: "active" }).limit(10).toArray();
  return c.json({ users: rows.map((u) => ({ username: u.username, displayName: u.displayName })) });
});

app.post("/api/conversations", requireAuth, async (c) => {
  const me = c.get("auth").user;
  const { username } = await readBody(c, z.object({ username: usernameSchema }).strict());
  await limit("convcreate", hex(me._id), 30, 3600);
  const { users, convs } = await col();
  const other = await users.findOne({ username, status: "active" });
  if (!other || other._id.equals(me._id)) throw new HttpError(404, "not_found", "User not found");
  const ids = [me._id, other._id].sort((a, b) => (hex(a) < hex(b) ? -1 : 1));
  const pairKey = ids.map(hex).join(":");
  let created = false;
  try {
    const r = await convs.updateOne({ pairKey }, { $setOnInsert: { participants: ids, disappearingSeconds: null, lastMessageAt: null, createdAt: new Date() } }, { upsert: true });
    created = r.upsertedCount > 0;
  } catch (e) {
    if (!isDup(e)) throw e; // concurrent create by the other user: the conversation exists
  }
  const conv = await convs.findOne({ pairKey });
  if (!conv) throw new HttpError(500, "internal", "Something went wrong");
  if (created) await publish([{ channel: userChannel(other._id), name: "conversation.new", data: { conversationId: hex(conv._id) } }]);
  return c.json({ id: hex(conv._id) });
});

app.get("/api/conversations", requireAuth, async (c) => {
  const me = c.get("auth").user._id;
  const { convs, users, msgs } = await col();
  const list = await convs.find({ participants: me }).sort({ lastMessageAt: -1, createdAt: -1 }).limit(50).toArray();
  const others = await users.find({ _id: { $in: list.map((l) => l.participants.find((p) => !p.equals(me))!) } }).toArray();
  const byId = new Map(others.map((u) => [hex(u._id), u]));
  const now = new Date();
  const unreadRows = await msgs
    .aggregate<{ _id: ObjectId; n: number }>([
      { $match: { conversationId: { $in: list.map((l) => l._id) }, senderId: { $ne: me }, readAt: null, deletedForEveryoneAt: null, ...visible(me, now) } },
      { $group: { _id: "$conversationId", n: { $sum: 1 } } },
    ])
    .toArray();
  const unread = new Map(unreadRows.map((r) => [hex(r._id), r.n]));
  const lasts = await Promise.all(list.map((cv) => msgs.find({ conversationId: cv._id, ...visible(me, now) }).sort({ _id: -1 }).limit(1).next()));
  const out = list.flatMap((cv, i) => {
    const peer = byId.get(hex(cv.participants.find((p) => !p.equals(me))!));
    if (!peer) return [];
    const lm = lasts[i];
    return [{
      id: hex(cv._id),
      peer: { id: hex(peer._id), username: peer.username, displayName: peer.displayName, online: now.getTime() - peer.lastSeenAt.getTime() < ONLINE_MS, lastSeenAt: peer.lastSeenAt.toISOString() },
      disappearingSeconds: cv.disappearingSeconds, unread: unread.get(hex(cv._id)) ?? 0, lastMessageAt: cv.lastMessageAt?.toISOString() ?? null,
      last: lm ? { text: lm.deletedForEveryoneAt ? null : readable(lm).slice(0, 80), deleted: !!lm.deletedForEveryoneAt, mine: lm.senderId.equals(me), createdAt: lm.createdAt.toISOString() } : null,
    }];
  });
  return c.json({ conversations: out });
});

app.patch("/api/conversations/:id", requireAuth, async (c) => {
  const me = c.get("auth").user._id;
  const conv = await memberConv(c.req.param("id"), me);
  const { disappearingSeconds } = await readBody(c, z.object({ disappearingSeconds: z.union([z.null(), z.literal(DISAPPEARING[0]), z.literal(DISAPPEARING[1]), z.literal(DISAPPEARING[2]), z.literal(DISAPPEARING[3])]) }).strict());
  const { convs } = await col();
  await convs.updateOne({ _id: conv._id }, { $set: { disappearingSeconds } }); // applies to messages sent afterwards
  const other = conv.participants.find((p) => !p.equals(me))!;
  await publish([{ channel: convChannel(conv._id), name: "conversation.updated", data: { conversationId: hex(conv._id) } }, { channel: userChannel(other), name: "inbox.update", data: { conversationId: hex(conv._id) } }]);
  return c.json({ ok: true });
});

/* ── messages ── */

app.get("/api/conversations/:id/messages", requireAuth, async (c) => {
  const me = c.get("auth").user._id;
  const conv = await memberConv(c.req.param("id"), me);
  const q = z.object({ before: idStr.optional(), after: idStr.optional(), limit: z.coerce.number().int().min(1).max(50).default(30) }).safeParse(c.req.query());
  if (!q.success) throw new HttpError(400, "validation_error", "Invalid query");
  const { before, after, limit: n } = q.data;
  const { msgs } = await col();
  const filter: Filter<MsgDoc> = { conversationId: conv._id, ...visible(me, new Date()) };
  if (after) filter._id = { $gt: new ObjectId(after) }; // forward sync (reconnect / new-message events)
  else if (before) filter._id = { $lt: new ObjectId(before) }; // cursor pagination of older history
  let rows = await msgs.find(filter).sort({ _id: after ? 1 : -1 }).limit(n + 1).toArray();
  const hasMore = rows.length > n;
  rows = rows.slice(0, n);
  if (!after) rows.reverse();
  if (rows.some((m) => !m.senderId.equals(me))) await markStates(conv, me, "delivered");
  return c.json({ messages: rows.map((m) => msgDto(m, me)), hasMore });
});

app.post("/api/conversations/:id/messages", requireAuth, async (c) => {
  const me = c.get("auth").user._id;
  const conv = await memberConv(c.req.param("id"), me);
  await limit("send", hex(me), 60, 60);
  const b = await readBody(c, z.object({ clientMsgId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), text: z.string().max(4000).refine((s) => s.trim().length > 0, "Message is empty") }).strict());
  const { msgs, convs } = await col();
  const now = new Date();
  const doc = {
    conversationId: conv._id, senderId: me, clientMsgId: b.clientMsgId, body: "", createdAt: now, deliveredAt: null, readAt: null, deletedFor: [], deletedForEveryoneAt: null,
    ...(conv.disappearingSeconds ? { expiresAt: new Date(now.getTime() + conv.disappearingSeconds * 1000) } : {}),
  } as unknown as MsgDoc;
  doc.body = seal(b.text, aadOf(doc));
  try {
    const r = await msgs.insertOne(doc);
    const saved = { ...doc, _id: r.insertedId };
    await convs.updateOne({ _id: conv._id }, { $set: { lastMessageAt: now } });
    const other = conv.participants.find((p) => !p.equals(me))!;
    await publish([
      { channel: convChannel(conv._id), name: "message.new", data: { conversationId: hex(conv._id), messageId: hex(saved._id), senderId: hex(me) } },
      { channel: userChannel(other), name: "inbox.update", data: { conversationId: hex(conv._id) } },
      { channel: userChannel(me), name: "inbox.update", data: { conversationId: hex(conv._id) } },
    ]);
    return c.json({ message: msgDto(saved, me) }, 201);
  } catch (e) {
    if (!isDup(e)) throw e;
    const existing = await msgs.findOne({ conversationId: conv._id, senderId: me, clientMsgId: b.clientMsgId }); // client retry: idempotent
    if (!existing) throw e;
    return c.json({ message: msgDto(existing, me) });
  }
});

app.post("/api/conversations/:id/read", requireAuth, async (c) => {
  const me = c.get("auth").user._id;
  await markStates(await memberConv(c.req.param("id"), me), me, "read");
  return c.body(null, 204);
});

app.post("/api/conversations/:id/typing", requireAuth, async (c) => {
  const me = c.get("auth").user._id;
  const conv = await memberConv(c.req.param("id"), me);
  await limit("typing", hex(me), 40, 60);
  await publish([{ channel: convChannel(conv._id), name: "typing", data: { userId: hex(me) } }]); // userId set by the server
  return c.body(null, 204);
});

app.delete("/api/messages/:id", requireAuth, async (c) => {
  const me = c.get("auth").user._id;
  const scope = z.enum(["me", "everyone"]).safeParse(c.req.query("scope"));
  if (!scope.success) throw new HttpError(400, "validation_error", "scope must be 'me' or 'everyone'");
  const id = oid(c.req.param("id"));
  if (!id) throw notFound();
  const { msgs } = await col();
  const m = await msgs.findOne({ _id: id });
  if (!m) throw notFound();
  const conv = await memberConv(hex(m.conversationId), me); // must be a participant of the message's conversation
  if (scope.data === "me") {
    await msgs.updateOne({ _id: id }, { $addToSet: { deletedFor: me } }); // hides it for this user only
    await publish([{ channel: userChannel(me), name: "message.hidden", data: { conversationId: hex(conv._id), messageId: hex(id) } }]);
    return c.body(null, 204);
  }
  if (!m.senderId.equals(me)) throw new HttpError(403, "forbidden", "Only the sender can delete for everyone");
  const now = Date.now();
  if (now - m.createdAt.getTime() > DELETE_WINDOW_MS) throw new HttpError(403, "too_old", "Messages can be deleted for everyone within 48 hours of sending");
  if (!m.deletedForEveryoneAt) {
    let tomb = new Date(now + TOMBSTONE_MS);
    if (m.expiresAt && m.expiresAt < tomb) tomb = m.expiresAt;
    await msgs.updateOne({ _id: id }, { $set: { body: "", deletedForEveryoneAt: new Date(now), expiresAt: tomb } }); // content destroyed server-side
    await publish([{ channel: convChannel(conv._id), name: "message.deleted", data: { conversationId: hex(conv._id), messageId: hex(id) } }, { channel: userChannel(conv.participants.find((p) => !p.equals(me))!), name: "inbox.update", data: { conversationId: hex(conv._id) } }]);
  }
  return c.body(null, 204);
});

/* ── Pusher private-channel authorisation ── */

app.post("/api/pusher/auth", requireAuth, async (c) => {
  const me = c.get("auth").user._id;
  await limit("pusherauth", hex(me), 120, 60);
  const form = await c.req.parseBody();
  const socketId = String(form.socket_id ?? "");
  const channel = String(form.channel_name ?? "");
  if (!/^\d+\.\d+$/.test(socketId)) throw new HttpError(400, "validation_error", "Invalid socket_id");
  const conv = /^private-conv-([a-f0-9]{24})$/.exec(channel);
  const usr = /^private-user-([a-f0-9]{24})$/.exec(channel);
  if (conv) await memberConv(conv[1], me); // only participants may subscribe
  else if (!usr || usr[1] !== hex(me)) throw new HttpError(403, "forbidden", "Forbidden channel"); // only your own user channel
  return c.json(pusher().authorizeChannel(socketId, channel));
});

export default app;

/* ───────────────────────── local development (never runs on Vercel) ───────────────────────── */
if (!process.env.VERCEL) {
  const { serve } = await import("@hono/node-server");
  const { serveStatic } = await import("@hono/node-server/serve-static");
  app.get("/app.js", serveStatic({ path: "./public/app.js" }));
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
  console.log("LYNKO CHAT dev server: http://localhost:" + Number(process.env.PORT ?? 3000));
}
