/**
 * GET /api/providers/[id]/incoming
 * Returns broadcast orders pending for this specific provider (via OrderBroadcast table).
 *
 * Auth: requires provider session (self only).
 * Replaces the old polling approach that fetched ALL broadcast orders in the city.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProviderSession } from "@/lib/session";
import { safeParse } from "@/lib/utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Auth: provider session, self only
  const session = getProviderSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.providerId !== id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Query OrderBroadcast where providerId = me AND status = "pending"
  const broadcasts = await db.orderBroadcast.findMany({
    where: { providerId: id, status: "pending" },
    include: {
      order: {
        include: {
          customer: { select: { name: true, phone: true } },
          service: { select: { icon: true, key: true, labels: true } },
          city: { select: { name: true } },
        },
      },
    },
    orderBy: { sentAt: "desc" },
    take: 10,
  });

  const incomingJobs = broadcasts.map((b) => {
    const labels = b.order.service ? safeParse<Record<string, string>>(b.order.service.labels, {}) : {};
    const svcName = b.order.service ? `${b.order.service.icon} ${labels.en || b.order.service.key}` : "Order";
    return {
      id: b.order.id,
      code: b.order.code,
      status: b.order.status,
      kind: b.order.kind,
      items: b.order.items,
      description: b.order.description,
      timing: b.order.timing,
      addressText: b.order.addressText,
      addressArea: b.order.addressArea,
      addressLat: b.order.addressLat,
      addressLng: b.order.addressLng,
      customer: b.order.customer,
      service: b.order.service,
      city: b.order.city,
      svcName,
      broadcastId: b.id,
      sentAt: b.sentAt,
      createdAt: b.order.createdAt,
    };
  });

  return NextResponse.json({ jobs: incomingJobs });
}
