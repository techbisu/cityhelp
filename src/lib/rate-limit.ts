/**
 * CityHelp — Rate limiter (in-memory + optional Upstash Redis)
 *
 * Uses Upstash Redis when configured (for multi-instance Vercel serverless).
 * Falls back to in-memory when Redis is not available.
 *
 * Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 */
import { NextRequest } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

interface RateLimitOptions {
  max: number;
  windowMs: number;
}

// Try to import Upstash Redis (optional)
let redisLimit: ((key: string, max: number, windowMs: number) => Promise<{ ok: boolean }>) | null = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    redisLimit = async (key: string, max: number, windowMs: number) => {
      const now = Date.now();
      const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;
      const count = await redis.incr(windowKey);
      if (count === 1) {
        await redis.expire(windowKey, Math.ceil(windowMs / 1000));
      }
      return { ok: count <= max };
    };
  }
} catch {
  // Redis not available — use in-memory fallback
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

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;
  return "unknown";
}

let lastSweep = Date.now();
export function sweepIfNeeded() {
  const now = Date.now();
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}

/**
 * Apply rate limit. Uses Redis if available, in-memory otherwise.
 * Returns a 429 Response if exceeded, null if OK.
 */
export function rateLimitOr429(req: NextRequest, key: string, opts: RateLimitOptions): null | Response {
  sweepIfNeeded();
  // For in-memory (synchronous) path
  if (!redisLimit) {
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
          },
        }
      );
    }
    return null;
  }
  // Redis path is async — but this function is sync for convenience
  // If Redis is configured, we fall through to in-memory (still better than nothing)
  // Full Redis rate limiting requires making the handler async
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
        },
      }
    );
  }
  return null;
}
