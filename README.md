# LYNKO CHAT

A private, real-time one-to-one messaging web app: **Hono on Vercel** (backend + HTML shell), **React** (browser client, bundled by esbuild), **MongoDB Atlas**, **Pusher Channels**.

> ## ⚠ End-to-end encryption: NOT IMPLEMENTED
> LYNKO CHAT is **not** end-to-end encrypted. Message text is encrypted **at rest** in MongoDB with AES-256-GCM using `MESSAGE_KEY`, but that key lives on the server, so the server operator (and anyone who obtains both the database and the key) can read messages. This protects against a database-only leak. It does not protect against the operator, a server compromise, or legal process.
>
> Genuine E2EE needs a vetted protocol (Olm/Double Ratchet or MLS), per-device identity keys, one-time prekeys, secure on-device key storage, key-change warnings, safety-number verification and a multi-device strategy. That cannot be built correctly inside these eight files, and inventing a scheme would be unsafe. The UI states this plainly.

## Why this layout works with exactly eight files

A Next.js app needs `app/` or `pages/` route files, so these eight files cannot form one. Instead:

| File | Role |
|---|---|
| `index.ts` | Hono app, Vercel's zero-config Hono entry: serves the HTML shell at `/`, the JSON API under `/api/*`, and the Pusher auth endpoint |
| `app.tsx` | React client. `npm run build` bundles it with esbuild into `public/app.js` (generated at build time, not a project file). Vercel serves `public/**` from its CDN |
| `middleware.ts` | Vercel Routing Middleware: rejects cross-origin state-changing `/api` requests (CSRF defence in depth) |
| `vercel.json` | Security headers incl. a strict CSP (`script-src 'self'`, no inline scripts), build command |
| `package.json`, `tsconfig.json`, `.env.example`, `README.md` | Tooling, configuration, docs |

Unavoidable consequences: one large backend file and one large client file; no component split; styles live in a CSS string inside `app.tsx`.

**Not verified:** nothing here has been built, run, type-checked or deployed by the author. Run `npm install && npm run typecheck` first and fix any version or typing differences. In particular, confirm on your first deploy that Vercel runs `npm run build` before packaging the Hono function and serves `public/app.js` (see Troubleshooting).

## Feature status

| Feature | Status |
|---|---|
| Register, login, logout, logout-all, Argon2id, server-side sessions, HttpOnly cookies | Implemented |
| Username search, start 1:1 chat, send/receive, history, cursor pagination | Implemented |
| Real-time delivery, typing, read/delivered receipts (Pusher private channels) | Implemented |
| Presence (online / last seen) | Implemented, heartbeat-based (see below) |
| Delete for me, delete for everyone (sender only, 48 h window) | Implemented |
| Disappearing messages (1 h, 1 d, 7 d, 90 d) | Implemented |
| Unread counts, optimistic send with retry, reconnect recovery | Implemented |
| Light/dark theme | Automatic via `prefers-color-scheme` (no manual toggle) |
| **End-to-end encryption, device verification, key rotation** | **NOT IMPLEMENTED** |
| Email, email verification, password reset | **NOT IMPLEMENTED** (no email provider is wired; accounts have no email) |
| Profile photos, attachments, group chats | **NOT IMPLEMENTED** |

## Security model

- **Passwords:** Argon2id (19 MiB, 2 passes, 1 lane), 12–128 characters. Timing is equalised for unknown usernames. No breached-password check.
- **Sessions:** 256-bit random token in an HttpOnly, SameSite=Lax cookie (`__Host-` prefix and Secure in production). Only an HMAC of the token (keyed by `SESSION_SECRET`) is stored. 30-day idle expiry, 90-day hard cap, max 20 per user, TTL index cleanup, instant revocation on logout.
- **Authorization:** identity always comes from the session. Conversation membership is part of the database query; non-members get 404. Only the sender can delete for everyone. Pusher subscriptions are authorised server-side: a conversation channel only for its participants, a user channel only for its owner.
- **CSRF:** SameSite=Lax + Origin/host check in `middleware.ts` and again in `index.ts` + JSON-only bodies.
- **Injection / XSS:** all input is validated with Zod; usernames are restricted to `[a-z0-9_]` before any query; no user-supplied operators reach MongoDB. Message text is rendered as text only; CSP forbids inline and third-party scripts.
- **Rate limits** (MongoDB-backed, fixed window): register 10/h/IP, login 30/15 min/IP and 8/15 min/username, send 60/min/user, search, typing and channel-auth limits. A per-username login limit can temporarily lock a victim out; that is a deliberate trade-off.
- **Pusher privacy:** events carry IDs only, never message text. Pusher still learns metadata: channel names (which contain conversation and user IDs), timing and IP addresses.
- **Logging:** only error class and code are logged, never bodies, tokens or messages.

## Deletion and expiry semantics

- **Delete for me:** adds you to the message's `deletedFor`; the other participant is unaffected; your other sessions update in real time.
- **Delete for everyone:** policy is **sender only, within 48 hours**. The server wipes the stored ciphertext and leaves a tombstone for 30 days so offline devices learn of it on next load; everyone currently connected updates immediately. A client that is offline longer than 30 days simply never sees the message again. Devices cannot be forced to erase text they already received, or screenshots.
- **Disappearing messages:** set per conversation; applies to messages sent afterwards. Enforced on the server in two ways: reads filter out expired messages immediately, and a MongoDB TTL index physically deletes them (the TTL monitor runs roughly once a minute). Clients also hide them locally. Notifications, screenshots, copies and exports cannot be recalled.
- **Safe to auto-delete:** `sessions`, `ratelimits` (TTL), and expired/tombstoned `messages` (TTL). Users and conversations are never auto-deleted.

## Presence

`online` means the user's heartbeat arrived within the last 70 seconds (the client heartbeats every 30 s while visible). A closed tab or lost connection therefore turns "Online" into "Last seen …" within about a minute; it never claims to be online indefinitely. Last-seen is shown to anyone you share a conversation with, and there is no way to hide it yet. An "online" signal does not prove a message was delivered or read; those are explicit receipts.

## Reconnect behaviour

On Pusher reconnect the open chat reloads the latest page and merges by message ID (no duplicates); while disconnected it polls every 15 s; sends carry an idempotency key (`clientMsgId`) so retries never duplicate. Limitation: a deletion or expiry of an *older* message that happened while offline is only picked up once that message's page is reloaded.

## Limits and costs

- **Pusher:** the free plan has caps on daily messages and concurrent connections (check current numbers on pusher.com/pricing). Each event on each channel counts; typing indicators and receipts use messages, so a busy chat consumes quota quickly. Heartbeats go to the API, not Pusher.
- **MongoDB Atlas:** the free M0 tier has storage, connection and throughput limits. The conversation list issues one small query per conversation (max 50) on each refresh; fine for small deployments, not for large ones.
- **Vercel:** function invocations, duration and bandwidth are plan-limited.
- **Network access:** Vercel functions use changing IP addresses, so Atlas usually needs `0.0.0.0/0` in its IP access list. That weakens the network layer: use a strong database password and a least-privilege user.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in every value
npm run typecheck
npm run dev                    # builds public/app.js and serves http://localhost:3000
```

1. **MongoDB Atlas:** create a free cluster → Database Access → add a user with *readWrite* on the `lynko` database only → Network Access → allow your IP (and `0.0.0.0/0` for Vercel) → Connect → Drivers → copy the URI into `MONGODB_URI`. Indexes are created automatically on first connection.
2. **Pusher:** dashboard.pusher.com → Channels → Create app (pick the cluster nearest your users) → App Keys → copy `app_id`, `key`, `secret`, `cluster` into `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`. Client events are not needed; leave them disabled.
3. **Secrets:** `SESSION_SECRET` = `openssl rand -base64 48`; `MESSAGE_KEY` = `openssl rand -base64 32`. Back up `MESSAGE_KEY`: losing it makes stored messages unreadable.

## Deploy to GitHub and Vercel

```bash
git init
printf "node_modules\n.env.local\n.vercel\npublic\n" >> .git/info/exclude   # local-only ignore, no extra file needed
git add package.json tsconfig.json .env.example middleware.ts app.tsx index.ts README.md vercel.json
git commit -m "LYNKO CHAT" && git branch -M main
git remote add origin https://github.com/<you>/lynko-chat.git && git push -u origin main
```

Commit the lockfile (`package-lock.json`) after your first `npm install` so builds are reproducible. In Vercel: **Add New → Project →** import the repo (framework should auto-detect as Hono; `vercel.json` also sets it) → add all eight environment variables for Production (and Preview if you use it) → Deploy → Domains → add your domain. Vercel provides HTTPS.

## Test checklist

Register two accounts in two browsers · search the other username and start a chat · messages arrive instantly · reload keeps history · in MongoDB the `body` field starts with `v1.` and contains no readable text · open a conversation ID from another user's account via the API and confirm 404 · try to subscribe to a foreign `private-conv-…` channel and confirm the auth endpoint returns 403 · delete for me hides it only for you · delete for everyone updates both sides and survives reload · set a 1-hour timer and confirm expiry · toggle airplane mode, send, restore and confirm exactly one copy · log out, then confirm `/api/me` returns 401 · log out of all devices and confirm the other browser is signed out · search the built bundle and repository for your secrets (there should be none).

## Troubleshooting

- **`/app.js` returns 404 or the page is blank:** Vercel did not run the build or did not serve `public/`. Check the deployment's build log for `npm run build`. If your project settings override the build command, clear the override. As a last resort, switch to a Next.js layout (outside this eight-file constraint).
- **500 on every API call:** an environment variable is missing or invalid (the log names the variable). `MESSAGE_KEY` must decode to exactly 32 bytes.
- **`MongoServerSelectionError`:** Atlas IP access list does not allow Vercel, or the URI/password is wrong (special characters in the password must be URL-encoded).
- **403 `bad_origin`:** a request was sent from a different origin or without an `Origin` header (e.g. curl). Browsers on your own domain are fine.
- **Pusher auth 403 / no realtime:** wrong cluster or key, or you are not a participant of that conversation. Check the browser console and the `/api/pusher/auth` response. Check also that your CSP `connect-src` covers your Pusher cluster (`*.pusher.com`).
- **Cookie not set locally on Safari:** Safari ignores `Secure` cookies on http://localhost. Use Chrome/Firefox locally or `vercel dev` over HTTPS.

## Known limitations

No E2EE (see top). No email verification or password recovery: **a forgotten password cannot be recovered**. Username enumeration is possible by design (usernames are searchable). Fixed-window rate limits allow short bursts at window edges. No admin or moderation tools, no account deletion, no abuse reporting, no blocking. Dependency versions are ranges and have not been audited. The code has not been independently reviewed or penetration tested.
