/**
 * GET /api/providers?tenantSlug=&cityId=&online=
 * POST /api/providers — create provider
 * PATCH /api/providers — update (online toggle, activate, reset PIN)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/crypto";
import { safeParse } from "@/lib/utils";
import { getProviderSession, getStaffSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const cityId = searchParams.get("cityId");
  const online = searchParams.get("online");

  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth: require staff or provider session
  const staffSession = getStaffSession(req);
  const providerSession = getProviderSession(req);
  if (!staffSession && !providerSession) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  // Tenant isolation
  const callerTenantId = staffSession?.tenantId || providerSession?.tenantId;
  if (callerTenantId !== tenant.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const where: Record<string, unknown> = { tenantId: tenant.id };
  if (cityId && cityId !== "all") where.cityId = cityId;
  if (online === "true") where.isOnline = true;

  const providers = await db.provider.findMany({
    where,
    include: {
      city: { select: { id: true, name: true } },
      _count: { select: { acceptedOrders: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  // Enrich with service names
  const services = await db.service.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, key: true, icon: true, labels: true },
  });
  const svcMap = new Map(services.map((s) => [s.id, s]));

  const enriched = providers.map((p) => ({
    ...p,
    serviceIds: safeParse<string[]>(p.serviceIds, []),
    services: safeParse<string[]>(p.serviceIds, []).map((id) => svcMap.get(id)).filter(Boolean),
  }));

  return NextResponse.json({ providers: enriched });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, phone, pin, cityId, serviceIds, zone } = body;
  if (!name || !phone || !pin || !cityId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Auth: require staff session
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({ where: { slug: staffSession.tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  const provider = await db.provider.create({
    data: {
      tenantId: tenant.id,
      cityId,
      name,
      phone,
      pinHash: hashPin(pin),
      serviceIds: JSON.stringify(serviceIds || []),
      zone: zone || null,
    },
  });
  return NextResponse.json({ provider });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, isOnline, isActive, pin, serviceIds, zone, cityId } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Auth: allow either provider session (self-update) or staff session (admin update)
  // Provider can only update isOnline for themselves; staff can update everything
  const providerSession = getProviderSession(req);
  const staffSession = getStaffSession(req);

  if (!providerSession && !staffSession) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fetch the provider to check tenant
  const targetProvider = await db.provider.findUnique({ where: { id }, select: { tenantId: true } });
  if (!targetProvider) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Tenant isolation
  const callerTenantId = providerSession?.tenantId || staffSession?.tenantId;
  if (targetProvider.tenantId !== callerTenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // If provider session, can only update self + only isOnline
  if (providerSession && providerSession.providerId !== id) {
    return NextResponse.json({ error: "forbidden", message: "Can only update your own profile" }, { status: 403 });
  }

  const update: Record<string, unknown> = {};
  if (typeof isOnline === "boolean") {
    update.isOnline = isOnline;
    update.lastSeenAt = new Date();
  }
  // Only staff can update these fields (not providers themselves)
  if (staffSession) {
    if (typeof isActive === "boolean") update.isActive = isActive;
    if (pin) update.pinHash = hashPin(pin);
    if (serviceIds) update.serviceIds = JSON.stringify(serviceIds);
    if (zone !== undefined) update.zone = zone;
    if (cityId) update.cityId = cityId;
  }

  const provider = await db.provider.update({ where: { id }, data: update });
  return NextResponse.json({ provider });
}
