/**
 * GET /api/providers/[id] — full provider detail with active & past jobs
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParse } from "@/lib/utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const includeJobs = searchParams.get("jobs") === "true";

  const provider = await db.provider.findUnique({
    where: { id },
    include: {
      city: true,
      tenant: { select: { slug: true, name: true, accentColor: true } },
    },
  });
  if (!provider) return NextResponse.json({ error: "not found" }, { status: 404 });

  let activeJobs: unknown[] = [];
  let pastJobs: unknown[] = [];
  let customRequests: unknown[] = [];

  if (includeJobs) {
    activeJobs = await db.order.findMany({
      where: {
        tenantId: provider.tenantId,
        cityId: provider.cityId,
        status: { in: ["accepted", "picked"] },
        acceptedById: provider.id,
      },
      include: {
        customer: { select: { name: true, phone: true, language: true } },
        service: { select: { icon: true, key: true, labels: true } },
        city: { select: { name: true } },
      },
      orderBy: { acceptedAt: "desc" },
    });

    pastJobs = await db.order.findMany({
      where: {
        tenantId: provider.tenantId,
        acceptedById: provider.id,
        status: { in: ["delivered", "cancelled"] },
      },
      include: {
        customer: { select: { name: true, phone: true } },
        service: { select: { icon: true, key: true } },
        city: { select: { name: true } },
      },
      orderBy: { deliveredAt: "desc" },
      take: 30,
    });

    customRequests = await db.order.findMany({
      where: {
        tenantId: provider.tenantId,
        cityId: provider.cityId,
        status: "new",
        kind: "custom",
      },
      include: {
        customer: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  const services = await db.service.findMany({
    where: { tenantId: provider.tenantId },
    select: { id: true, key: true, icon: true, labels: true },
  });
  const svcMap = new Map(services.map((s) => [s.id, s]));

  return NextResponse.json({
    provider: {
      ...provider,
      serviceIds: safeParse<string[]>(provider.serviceIds, []),
      services: safeParse<string[]>(provider.serviceIds, []).map((id) => svcMap.get(id)).filter(Boolean),
    },
    activeJobs,
    pastJobs,
    customRequests,
  });
}
