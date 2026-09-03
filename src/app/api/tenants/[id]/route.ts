/**
 * PATCH /api/tenants/[id]
 * Super admin: update tenant (status, planId, override limits, trial extension)
 * Body: { status?, planId?, overrideCities?, overrideOrders?, overrideWhatsApp?, overrideSeats?, trialEndsAt? }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const tenant = await db.tenant.findUnique({ where: { id } });
  if (!tenant) return NextResponse.json({ error: "not found" }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (body.status) update.status = body.status;
  if (body.planId) update.planId = body.planId;
  if (body.overrideCities !== undefined) update.overrideCities = body.overrideCities;
  if (body.overrideOrders !== undefined) update.overrideOrders = body.overrideOrders;
  if (body.overrideWhatsApp !== undefined) update.overrideWhatsApp = body.overrideWhatsApp;
  if (body.overrideSeats !== undefined) update.overrideSeats = body.overrideSeats;
  if (body.trialEndsAt) update.trialEndsAt = new Date(body.trialEndsAt);
  if (body.status === "suspended") update.suspendedAt = new Date();
  if (body.status === "active") update.suspendedAt = null;

  const updated = await db.tenant.update({ where: { id }, data: update });

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: id,
      actor: "superadmin",
      action: body.status === "suspended" ? "suspend" : body.status === "active" ? "restore" : "tenant_update",
      entity: "tenant",
      entityId: id,
      detail: JSON.stringify(update),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ tenant: updated });
}
