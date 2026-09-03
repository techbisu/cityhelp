/**
 * CityHelp — Upstash Redis cache layer
 *
 * Caches frequently-accessed data that the bot reads on every message:
 *   - Tenant config (WhatsApp credentials, services, cities)
 *   - Service list (rarely changes)
 *   - City list (rarely changes)
 *   - Bot session state (updated frequently — short TTL)
 *   - Provider matching (online providers in a city — short TTL)
 *   - Plan limits (rarely changes)
 *
 * Cache is OPTIONAL — if UPSTASH_REDIS_REST_URL is not set, all functions
 * fall back to direct DB queries (no caching). Nothing breaks.
 *
 * Upstash free tier: 10k commands/day, 256MB — more than enough.
 *
 * Env vars:
 *   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN=xxx
 */
import { Redis } from "@upstash/redis";
import { db } from "./db";
import { safeParse } from "./utils";

// ── Redis client (null if not configured) ──
let redis: Redis | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export function isCacheConfigured(): boolean {
  return redis !== null;
}

// ── Cache helpers ──

async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const val = await redis.get<T>(key);
    return val;
  } catch {
    return null;
  }
}

async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
  } catch {
    // silent fail — cache is optional
  }
}

async function cacheDel(key: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // silent
  }
}

// ── Cached data accessors ──

/**
 * Get tenant with services + cities (cached for 5 minutes).
 * This is called on every bot message.
 */
export async function getTenantWithServices(tenantId: string) {
  const cacheKey = `tenant:${tenantId}:config`;
  const cached = await cacheGet<{
    id: string;
    slug: string;
    name: string;
    waBusinessName: string | null;
    waConfigured: boolean;
    accentColor: string;
    upiId: string | null;
    upiName: string | null;
    services: Array<{ id: string; key: string; kind: string; icon: string; labels: string; isActive: boolean; defaultDeliveryCharge: number | null; defaultServiceCharge: number | null }>;
    cities: Array<{ id: string; name: string; state: string | null; isActive: boolean }>;
  }>(cacheKey);

  if (cached) return cached;

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    include: {
      services: { where: { isActive: true }, orderBy: { orderIdx: "asc" } },
      cities: { where: { isActive: true }, orderBy: { name: "asc" } },
    },
  });

  if (!tenant) return null;

  const result = {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    waBusinessName: tenant.waBusinessName,
    waConfigured: tenant.waConfigured,
    accentColor: tenant.accentColor,
    upiId: tenant.upiId,
    upiName: tenant.upiName,
    services: tenant.services.map((s) => ({
      id: s.id, key: s.key, kind: s.kind, icon: s.icon,
      labels: s.labels, isActive: s.isActive,
      defaultDeliveryCharge: s.defaultDeliveryCharge,
      defaultServiceCharge: s.defaultServiceCharge,
    })),
    cities: tenant.cities.map((c) => ({
      id: c.id, name: c.name, state: c.state, isActive: c.isActive,
    })),
  };

  await cacheSet(cacheKey, result, 300); // 5 minutes
  return result;
}

/**
 * Invalidate tenant cache (call when tenant config changes).
 */
export async function invalidateTenantCache(tenantId: string): Promise<void> {
  await cacheDel(`tenant:${tenantId}:config`);
  await cacheDel(`tenant:${tenantId}:matching_providers`);
}

/**
 * Get online providers matching a service + city (cached for 30 seconds).
 * Called when a new order is broadcast.
 */
export async function getMatchingProviders(tenantId: string, cityId: string, serviceId?: string) {
  const cacheKey = `tenant:${tenantId}:matching_providers:${cityId}:${serviceId || "all"}`;
  const cached = await cacheGet<Array<{
    id: string;
    name: string;
    phone: string;
    serviceIds: string;
    pushSubscription: string | null;
  }>>(cacheKey);

  if (cached) return cached;

  const providers = await db.provider.findMany({
    where: {
      tenantId,
      cityId,
      isOnline: true,
      isActive: true,
    },
    select: {
      id: true, name: true, phone: true,
      serviceIds: true, pushSubscription: true,
    },
  });

  const result = serviceId
    ? providers.filter((p) => {
        const sids = safeParse<string[]>(p.serviceIds, []);
        return sids.length === 0 || sids.includes(serviceId);
      })
    : providers;

  await cacheSet(cacheKey, result, 30); // 30 seconds — short TTL because online status changes
  return result;
}

/**
 * Get bot session (cached for 10 seconds — short TTL since it changes frequently).
 */
export async function getBotSession(tenantId: string, phone: string) {
  const cacheKey = `bot_session:${tenantId}:${phone}`;
  const cached = await cacheGet<{
    id: string;
    state: string;
    draftService: string | null;
    draftItems: string;
    draftTiming: string | null;
    draftShop: string | null;
    draftAddress: string | null;
    draftLat: number | null;
    draftLng: number | null;
  }>(cacheKey);

  if (cached) return cached;

  const session = await db.botSession.findUnique({
    where: { tenantId_phone: { tenantId, phone } },
    select: {
      id: true, state: true, draftService: true, draftItems: true,
      draftTiming: true, draftShop: true, draftAddress: true,
      draftLat: true, draftLng: true,
    },
  });

  if (session) {
    await cacheSet(cacheKey, session, 10); // 10 seconds
  }
  return session;
}

/**
 * Invalidate bot session cache (call when session state changes).
 */
export async function invalidateBotSessionCache(tenantId: string, phone: string): Promise<void> {
  await cacheDel(`bot_session:${tenantId}:${phone}`);
}

/**
 * Get plan limits (cached for 1 hour — rarely changes).
 */
export async function getPlanLimits(tenantId: string) {
  const cacheKey = `tenant:${tenantId}:plan_limits`;
  const cached = await cacheGet<{
    cities: number;
    orders: number;
    whatsapp: number;
    seats: number;
  }>(cacheKey);

  if (cached) return cached;

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    include: { plan: true },
  });
  if (!tenant) return null;

  const result = {
    cities: tenant.overrideCities ?? tenant.plan.limitCities,
    orders: tenant.overrideOrders ?? tenant.plan.limitOrders,
    whatsapp: tenant.overrideWhatsApp ?? tenant.plan.limitWhatsApp,
    seats: tenant.overrideSeats ?? tenant.plan.limitSeats,
  };

  await cacheSet(cacheKey, result, 3600); // 1 hour
  return result;
}

/**
 * Invalidate plan limits cache (call when plan changes).
 */
export async function invalidatePlanCache(tenantId: string): Promise<void> {
  await cacheDel(`tenant:${tenantId}:plan_limits`);
}
