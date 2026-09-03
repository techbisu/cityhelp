/**
 * GET /api/providers?tenantSlug=&cityId=&online=
 * POST /api/providers — create provider
 * PATCH /api/providers — update (online toggle, activate, reset PIN)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/crypto";
import { safeParse } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const cityId = searchParams.get("cityId");
  const online = searchParams.get("online");

  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

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
  const { tenantSlug, name, phone, pin, cityId, serviceIds, zone } = body;
  if (!tenantSlug || !name || !phone || !pin || !cityId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
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

  const update: Record<string, unknown> = {};
  if (typeof isOnline === "boolean") {
    update.isOnline = isOnline;
    update.lastSeenAt = new Date();
  }
  if (typeof isActive === "boolean") update.isActive = isActive;
  if (pin) update.pinHash = hashPin(pin);
  if (serviceIds) update.serviceIds = JSON.stringify(serviceIds);
  if (zone !== undefined) update.zone = zone;
  if (cityId) update.cityId = cityId;

  const provider = await db.provider.update({ where: { id }, data: update });
  return NextResponse.json({ provider });
}
