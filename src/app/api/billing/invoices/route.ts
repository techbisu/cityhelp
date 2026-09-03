/**
 * GET /api/billing/invoices?tenantSlug=
 * Returns all invoices for a tenant.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    include: { plan: true },
  });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const invoices = await db.invoice.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    invoices,
    currentPlan: tenant.plan,
    currentPeriodEnd: tenant.currentPeriodEnd,
    status: tenant.status,
    dunningStartedAt: tenant.dunningStartedAt,
  });
}
