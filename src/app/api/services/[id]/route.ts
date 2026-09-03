/**
 * PATCH /api/services/[id]
 * Update a service's settings (charges, labels, icon, etc.)
 * Auth: requires staff session + tenant isolation
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSession } from "@/lib/session";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const existing = await db.service.findUnique({ where: { id }, select: { tenantId: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.tenantId !== staffSession.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { icon, labels, questions, options, kind, isActive, orderIdx, defaultDeliveryCharge, defaultServiceCharge } = body;

  const update: Record<string, unknown> = {};
  if (icon !== undefined) update.icon = icon;
  if (labels !== undefined) update.labels = JSON.stringify(labels);
  if (questions !== undefined) update.questions = JSON.stringify(questions);
  if (options !== undefined) update.options = JSON.stringify(options);
  if (kind !== undefined) update.kind = kind;
  if (typeof isActive === "boolean") update.isActive = isActive;
  if (typeof orderIdx === "number") update.orderIdx = orderIdx;
  if (defaultDeliveryCharge !== undefined) {
    // Convert rupees to paise
    update.defaultDeliveryCharge = defaultDeliveryCharge ? Math.round(parseFloat(defaultDeliveryCharge) * 100) : 0;
  }
  if (defaultServiceCharge !== undefined) {
    update.defaultServiceCharge = defaultServiceCharge ? Math.round(parseFloat(defaultServiceCharge) * 100) : 0;
  }

  const svc = await db.service.update({ where: { id }, data: update });
  return NextResponse.json({ service: svc });
}
