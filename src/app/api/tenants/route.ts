/**
 * GET /api/tenants — list all tenants
 * POST /api/tenants — create tenant
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const tenants = await db.tenant.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      accentColor: true,
      waBusinessName: true,
      waVerified: true,
      plan: { select: { name: true } },
      _count: { select: { cities: true, providers: true, orders: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ tenants });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, slug, planId } = body;
  if (!name || !slug) {
    return NextResponse.json({ error: "name and slug required" }, { status: 400 });
  }
  const free = await db.plan.findFirst({ where: { name: "Free" } });
  const tenant = await db.tenant.create({
    data: {
      name,
      slug,
      planId: planId || free?.id || "",
      status: "trial",
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });
  await db.notificationSetting.create({ data: { tenantId: tenant.id } });
  return NextResponse.json({ tenant });
}
