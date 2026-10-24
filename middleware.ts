// Vercel Routing Middleware (platform-level, runs before /api/* is invoked).
// CSRF defence in depth on top of SameSite=Lax cookies: every state-changing
// API request must carry an Origin header whose host equals the request host.
// index.ts repeats this check, so the app stays safe if this layer is bypassed.
import { next } from "@vercel/functions";

export const config = { matcher: ["/api/:path*"] };

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export default function middleware(request: Request) {
  if (!SAFE.has(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    let ok = false;
    try {
      ok = !!origin && new URL(origin).host === host;
    } catch {
      ok = false;
    }
    if (!ok) {
      return new Response(JSON.stringify({ error: { code: "bad_origin", message: "Cross-origin request blocked" } }), {
        status: 403,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
  }
  return next();
}
