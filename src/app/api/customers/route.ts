/**
 * GET /api/customers?tenantSlug=&q=
 * PATCH /api/customers — block/unblock
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const q = searchParams.get("q");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  const where: Record<string, unknown> = { tenantId: tenant.id };
  if (q) {
    where.OR = [
      { phone: { contains: q } },
      { name: { contains: q } },
    ];
  }
  const customers = await db.customer.findMany({
    where,
    include: { _count: { select: { orders: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ customers });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, isBlocked } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const c = await db.customer.update({ where: { id }, data: { isBlocked: typeof isBlocked === "boolean" ? isBlocked : false } });
  return NextResponse.json({ customer: c });
}
