/**
 * GET /api/billing/plan?tenantSlug=
 * Returns the tenant's current plan + limits + usage.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTenantLimits, getTenantUsage } from "@/lib/plan";
import { getStaffSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, include: { plan: true } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [limits, usage] = await Promise.all([
    getTenantLimits(tenant.id),
    getTenantUsage(tenant.id),
  ]);

  const allPlans = await db.plan.findMany({ orderBy: { priceMonthly: "asc" } });

  return NextResponse.json({
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      trialEndsAt: tenant.trialEndsAt,
      currentPeriodEnd: tenant.currentPeriodEnd,
      dunningStartedAt: tenant.dunningStartedAt,
    },
    currentPlan: tenant.plan,
    limits,
    usage,
    availablePlans: allPlans,
  });
}
