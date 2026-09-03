/**
 * CityHelp — Plan enforcement
 *
 * Centralized helper to check whether a tenant is within their plan limits.
 * Used by every creation endpoint (orders, cities, providers, staff).
 *
 * Behavior per spec:
 *  - "Never block an in-flight order; finish it, then gate."
 *  - "Limits are enforced with friendly 'upgrade' screens when reached."
 *
 * So orders are NEVER blocked — they always go through. But new cities,
 * providers, staff, and WhatsApp numbers are blocked at the limit.
 *
 * For orders, we surface a warning at 80% and 100% via email (if enabled).
 */
import { db } from "./db";

export interface PlanLimits {
  cities: number;
  orders: number;
  whatsapp: number;
  seats: number;
  featureWorkflow: boolean;
  featureEmail: boolean;
  featureApi: boolean;
  featureCustomDomain: boolean;
}

export interface TenantUsage {
  cities: number;
  ordersThisMonth: number;
  whatsapp: number;
  seats: number;
}

export async function getTenantLimits(tenantId: string): Promise<PlanLimits> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    include: { plan: true, _count: { select: { cities: true, staff: true } } },
  });
  if (!tenant) throw new Error("tenant not found");
  return {
    cities: tenant.overrideCities ?? tenant.plan.limitCities,
    orders: tenant.overrideOrders ?? tenant.plan.limitOrders,
    whatsapp: tenant.overrideWhatsApp ?? tenant.plan.limitWhatsApp,
    seats: tenant.overrideSeats ?? tenant.plan.limitSeats,
    featureWorkflow: tenant.plan.featureWorkflow,
    featureEmail: tenant.plan.featureEmail,
    featureApi: tenant.plan.featureApi,
    featureCustomDomain: tenant.plan.featureCustomDomain,
  };
}

export async function getTenantUsage(tenantId: string): Promise<TenantUsage> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    include: {
      _count: { select: { cities: true, staff: true } },
    },
  });
  if (!tenant) throw new Error("tenant not found");
  const ordersThisMonth = await db.order.count({
    where: { tenantId, createdAt: { gte: monthStart } },
  });
  return {
    cities: tenant._count.cities,
    ordersThisMonth,
    whatsapp: 1, // single WhatsApp number per tenant for now
    seats: tenant._count.staff,
  };
}

export interface LimitCheck {
  ok: boolean;
  resource: string;
  current: number;
  limit: number;
  percent: number;
  message?: string;
}

export async function assertWithinLimit(tenantId: string, resource: "cities" | "whatsapp" | "seats"): Promise<LimitCheck> {
  const limits = await getTenantLimits(tenantId);
  const usage = await getTenantUsage(tenantId);
  const limit = limits[resource];
  const current = usage[resource];
  if (current >= limit) {
    return {
      ok: false,
      resource,
      current,
      limit,
      percent: 100,
      message: `Plan limit reached: ${current}/${limit} ${resource}. Upgrade to add more.`,
    };
  }
  return { ok: true, resource, current, limit, percent: Math.round((current / limit) * 100) };
}

/**
 * Check orders usage for warning emails (80% / 100%).
 * Does NOT block — orders always go through per spec.
 */
export async function checkOrdersUsage(tenantId: string): Promise<LimitCheck> {
  const limits = await getTenantLimits(tenantId);
  const usage = await getTenantUsage(tenantId);
  const limit = limits.orders;
  const current = usage.ordersThisMonth;
  const percent = limit > 0 ? Math.round((current / limit) * 100) : 0;
  return {
    ok: true, // never block orders
    resource: "orders",
    current,
    limit,
    percent,
  };
}

/**
 * Maybe send a warning email when usage crosses 80% or 100%.
 * Called after every order creation.
 */
export async function maybeSendUsageWarning(tenantId: string): Promise<void> {
  try {
    const check = await checkOrdersUsage(tenantId);
    if (check.percent < 80) return;
    const settings = await db.notificationSetting.findUnique({ where: { tenantId } });
    if (!settings?.limitWarning) return;
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true, staff: { where: { role: "owner" } } },
    });
    if (!tenant || !tenant.staff[0]?.email) return;
    if (!tenant.plan.featureEmail) return;
    const { sendPlanLimitWarning, isEmailConfigured } = await import("./email");
    if (!isEmailConfigured()) return;
    // Only send once per threshold per month
    const lastWarning = await db.auditLog.findFirst({
      where: {
        tenantId,
        action: "limit_warning",
        entity: "orders",
        createdAt: { gte: new Date(new Date().getDate() === 1 ? Date.now() - 86400000 : new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()) },
      },
    });
    if (lastWarning) return;
    await sendPlanLimitWarning(tenant.staff[0].email, tenant.name, tenant.plan.name, {
      current: check.current, limit: check.limit, percent: check.percent, resource: "orders",
    });
    await db.auditLog.create({
      data: {
        tenantId,
        actor: "system",
        action: "limit_warning",
        entity: "orders",
        entityId: null,
        detail: `${check.percent}% warning sent to ${tenant.staff[0].email}`,
      },
    });
  } catch (e) {
    console.error("usage warning error:", e);
  }
}
