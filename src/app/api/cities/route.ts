/**
 * GET /api/cities?tenantSlug=
 * POST /api/cities — add city (staff only, plan-enforced)
 * PATCH /api/cities — activate/deactivate (staff only)
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

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const cities = await db.city.findMany({
    where: { tenantId: tenant.id },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ cities });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, name, state } = body;
  if (!tenantSlug || !name) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    include: { plan: true, _count: { select: { cities: true } } },
  });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  const limit = tenant.overrideCities ?? tenant.plan.limitCities;
  if (tenant._count.cities >= limit) {
    return NextResponse.json(
      { error: "limit_reached", message: `Plan limit: ${limit} cities. Upgrade to add more.` },
      { status: 403 }
    );
  }
  const city = await db.city.create({ data: { tenantId: tenant.id, name, state: state || null } });
  return NextResponse.json({ city });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, isActive } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const existing = await db.city.findUnique({ where: { id }, select: { tenantId: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.tenantId !== staffSession.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const city = await db.city.update({ where: { id }, data: { isActive: typeof isActive === "boolean" ? isActive : true } });
  return NextResponse.json({ city });
}
