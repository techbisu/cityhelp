/**
 * GET /api/customers?tenantSlug=&q=&cursor=
 * PATCH /api/customers — block/unblock (staff only)
 *
 * Auth: requires staff session + tenant isolation
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const q = searchParams.get("q");
  const cursor = searchParams.get("cursor");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
    take: 50,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
  return NextResponse.json({
    customers,
    nextCursor: customers.length === 50 ? customers[customers.length - 1].id : null,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, isBlocked } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const customer = await db.customer.findUnique({ where: { id }, select: { tenantId: true } });
  if (!customer) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (customer.tenantId !== staffSession.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const c = await db.customer.update({ where: { id }, data: { isBlocked: typeof isBlocked === "boolean" ? isBlocked : false } });

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: customer.tenantId,
      actor: `staff:${staffSession.staffId}`,
      action: isBlocked ? "customer_blocked" : "customer_unblocked",
      entity: "customer",
      entityId: id,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ customer: c });
}
