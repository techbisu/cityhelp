/**
 * GET /api/services?tenantSlug=
 * POST /api/services — create (staff only)
 * PATCH /api/services — update (staff only)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth: staff or provider can read services
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const services = await db.service.findMany({
    where: { tenantId: tenant.id },
    orderBy: { orderIdx: "asc" },
  });
  return NextResponse.json({ services });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, key, kind, icon, labels, questions, options } = body;
  if (!tenantSlug || !key) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  const count = await db.service.count({ where: { tenantId: tenant.id } });
  const svc = await db.service.create({
    data: {
      tenantId: tenant.id,
      key,
      kind: kind || "order",
      icon: icon || "📦",
      orderIdx: count + 1,
      labels: JSON.stringify(labels || { en: key }),
      questions: JSON.stringify(questions || { en: "" }),
      options: JSON.stringify(options || {}),
    },
  });
  return NextResponse.json({ service: svc });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, icon, labels, questions, options, kind, isActive, orderIdx } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const update: Record<string, unknown> = {};
  if (icon !== undefined) update.icon = icon;
  if (labels !== undefined) update.labels = JSON.stringify(labels);
  if (questions !== undefined) update.questions = JSON.stringify(questions);
  if (options !== undefined) update.options = JSON.stringify(options);
  if (kind !== undefined) update.kind = kind;
  if (typeof isActive === "boolean") update.isActive = isActive;
  if (typeof orderIdx === "number") update.orderIdx = orderIdx;
  const svc = await db.service.update({ where: { id }, data: update });
  return NextResponse.json({ service: svc });
}
