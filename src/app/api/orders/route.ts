/**
 * GET /api/orders?tenantSlug=&cityId=&status=&view=
 * POST /api/orders — create new order (from bot or manual)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParse, reverseGeocodeStub } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const cityId = searchParams.get("cityId");
  const status = searchParams.get("status");
  const providerId = searchParams.get("providerId");

  if (!tenantSlug) {
    return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });
  }

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  const where: Record<string, unknown> = { tenantId: tenant.id };
  if (cityId && cityId !== "all") where.cityId = cityId;
  if (status && status !== "all") where.status = status;
  if (providerId) where.acceptedById = providerId;

  const orders = await db.order.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true, language: true, addresses: true } },
      service: { select: { id: true, key: true, icon: true, labels: true } },
      city: { select: { id: true, name: true } },
      acceptedBy: { select: { id: true, name: true, phone: true, zone: true } },
      broadcasts: { include: { provider: { select: { id: true, name: true, phone: true } } } },
      activity: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    tenantSlug,
    phone,
    customerName,
    serviceId,
    kind = "order",
    items = [],
    description,
    preferredShop,
    timing,
    addressText,
    addressLat,
    addressLng,
    mediaUrls = [],
    voiceTranscript,
    source = "bot",
    manualProviderId, // for manual job creation by provider
  } = body;

  if (!tenantSlug || !phone) {
    return NextResponse.json({ error: "tenantSlug and phone required" }, { status: 400 });
  }

  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    include: { cities: { where: { isActive: true } } },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  // Find or create customer
  let customer = await db.customer.findUnique({
    where: { tenantId_phone: { tenantId: tenant.id, phone } },
  });
  if (!customer) {
    customer = await db.customer.create({
      data: {
        tenantId: tenant.id,
        phone,
        name: customerName,
        language: body.language || "en",
      },
    });
  }

  // Determine city — use customer's first saved address area, or tenant's first city
  let cityId: string | undefined;
  if (body.cityId) {
    cityId = body.cityId;
  } else {
    const addresses = safeParse(customer.addresses, [] as Array<{ area?: string; lat?: number; lng?: number }>);
    if (addressLat && addressLng) {
      const area = reverseGeocodeStub(addressLat, addressLng);
      const city = tenant.cities.find((c) => area.toLowerCase().includes(c.name.toLowerCase().split(" ")[0])) || tenant.cities[0];
      cityId = city?.id;
      // Save this address
      const newAddr = { label: area, text: addressText || area, lat: addressLat, lng: addressLng, area };
      const updated = [...addresses.filter((a) => a.area !== area), newAddr];
      await db.customer.update({ where: { id: customer.id }, data: { addresses: JSON.stringify(updated) } });
    } else if (addresses.length > 0 && addresses[0].area) {
      // Try to match saved address to a city
      cityId = tenant.cities[0]?.id;
    } else {
      cityId = tenant.cities[0]?.id;
    }
  }

  if (!cityId) {
    return NextResponse.json({ error: "no active city for tenant" }, { status: 400 });
  }

  // Generate next order code
  const lastOrder = await db.order.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { code: "desc" },
  });
  const nextCode = lastOrder ? String(parseInt(lastOrder.code, 10) + 1) : "1001";

  // Determine area from lat/lng or text
  let area = body.addressArea;
  if (!area && addressLat && addressLng) {
    area = reverseGeocodeStub(addressLat, addressLng);
  }

  // Create the order
  const order = await db.order.create({
    data: {
      tenantId: tenant.id,
      cityId,
      customerId: customer.id,
      serviceId: serviceId || null,
      code: nextCode,
      status: manualProviderId ? "accepted" : "new",
      kind,
      items: JSON.stringify(items),
      description: description || null,
      preferredShop: preferredShop || null,
      timing: timing || null,
      addressText: addressText || null,
      addressArea: area || null,
      addressLat: addressLat || null,
      addressLng: addressLng || null,
      mediaUrls: JSON.stringify(mediaUrls),
      voiceTranscript: voiceTranscript || null,
      source,
      acceptedById: manualProviderId || null,
      acceptedAt: manualProviderId ? new Date() : null,
      activity: {
        create: [
          {
            tenantId: tenant.id,
            actor: source === "bot" ? "bot" : `provider:${manualProviderId || "manual"}`,
            action: "created",
            detail: source === "bot" ? "Created via WhatsApp" : "Manual job created",
          },
        ],
      },
    },
    include: {
      customer: true,
      service: true,
      city: true,
      acceptedBy: true,
    },
  });

  // If manual job, increment provider stats
  if (manualProviderId) {
    await db.provider.update({
      where: { id: manualProviderId },
      data: { jobsDone: { increment: 1 } },
    });
  } else {
    // Broadcast to matching online providers in that city
    const matchingProviders = await db.provider.findMany({
      where: {
        tenantId: tenant.id,
        cityId,
        isOnline: true,
        isActive: true,
      },
    });
    // Filter by serviceIds if serviceId given
    const toBroadcast = serviceId
      ? matchingProviders.filter((p) => {
          const sids = safeParse<string[]>(p.serviceIds, []);
          return sids.length === 0 || sids.includes(serviceId);
        })
      : matchingProviders;

    if (toBroadcast.length > 0) {
      await db.order.update({
        where: { id: order.id },
        data: { status: "broadcast" },
      });
      await db.orderBroadcast.createMany({
        data: toBroadcast.map((p) => ({ orderId: order.id, providerId: p.id, status: "pending" })),
      });
      await db.activity.create({
        data: {
          tenantId: tenant.id,
          orderId: order.id,
          actor: "system",
          action: "broadcast",
          detail: `Broadcast to ${toBroadcast.length} provider(s)`,
        },
      });
    }
  }

  return NextResponse.json({ order });
}
