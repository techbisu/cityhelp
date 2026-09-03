/**
 * CityHelp — in-memory rate limiter (token bucket per key).
 * For production multi-instance deploys, swap with Redis.
 *
 * Usage:
 *   const ok = rateLimit(`pin:${ip}`, { max: 5, windowMs: 15*60*1000 });
 *   if (!ok) return 429;
 *
 *   const ok = rateLimit(`bot:${tenantId}:${phone}`, { max: 30, windowMs: 60*1000 });
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

interface RateLimitOptions {
  max: number;
  windowMs: number;
}

export function rateLimit(key: string, opts: RateLimitOptions): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    const fresh: Bucket = { count: 1, resetAt: now + opts.windowMs };
    buckets.set(key, fresh);
    return { ok: true, remaining: opts.max - 1, resetAt: fresh.resetAt };
  }

  if (bucket.count >= opts.max) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count++;
  return { ok: true, remaining: opts.max - bucket.count, resetAt: bucket.resetAt };
}

/** Convenience: rate-limit by IP from a Next.js request */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;
  return "unknown";
}

/** Sweep old buckets periodically (every 5 min) — prevents memory leak */
let lastSweep = Date.now();
export function sweepIfNeeded() {
  const now = Date.now();
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}

/** Helper: apply rate limit to a request, returning a 429 Response if exceeded */
export function rateLimitOr429(req: Request, key: string, opts: RateLimitOptions): null | Response {
  sweepIfNeeded();
  const r = rateLimit(key, opts);
  if (!r.ok) {
    const retryAfter = Math.ceil((r.resetAt - Date.now()) / 1000);
    return new Response(
      JSON.stringify({ error: "rate_limited", message: "Too many requests. Try again later." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(r.resetAt),
        },
      }
    );
  }
  return null;
}
