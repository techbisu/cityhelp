/**
 * GET /api/audit?tenantSlug=&super=true
 * POST /api/audit — log entry
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const isGlobal = searchParams.get("super") === "true";
  const action = searchParams.get("action");
  const limit = parseInt(searchParams.get("limit") || "100", 10);

  const where: Record<string, unknown> = {};
  if (!isGlobal && tenantSlug) {
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
    where.tenantId = tenant.id;
  }
  if (action) where.action = action;

  const logs = await db.auditLog.findMany({
    where,
    include: { tenant: { select: { name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ logs });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantId, actor, action, entity, entityId, detail } = body;
  if (!actor || !action) return NextResponse.json({ error: "actor and action required" }, { status: 400 });
  const log = await db.auditLog.create({
    data: {
      tenantId: tenantId || null,
      actor,
      action,
      entity: entity || null,
      entityId: entityId || null,
      detail: detail || null,
    },
  });
  return NextResponse.json({ log });
}
