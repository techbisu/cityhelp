/**
 * PATCH /api/tenants/[id]
 * Super admin only: update tenant (status, planId, override limits, trial extension)
 * REQUIRES super-admin session.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperSession } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireSuperSession(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json();
  const tenant = await db.tenant.findUnique({ where: { id } });
  if (!tenant) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Whitelist allowed fields — never blindly copy from body
  const update: Record<string, unknown> = {};
  const validStatuses = ["trial", "active", "suspended", "cancelled"];
  if (body.status && validStatuses.includes(body.status)) update.status = body.status;
  if (body.planId) {
    const plan = await db.plan.findUnique({ where: { id: body.planId } });
    if (!plan) return NextResponse.json({ error: "invalid planId" }, { status: 400 });
    update.planId = body.planId;
  }
  if (typeof body.overrideCities === "number") update.overrideCities = body.overrideCities;
  if (typeof body.overrideOrders === "number") update.overrideOrders = body.overrideOrders;
  if (typeof body.overrideWhatsApp === "number") update.overrideWhatsApp = body.overrideWhatsApp;
  if (typeof body.overrideSeats === "number") update.overrideSeats = body.overrideSeats;
  if (body.trialEndsAt) update.trialEndsAt = new Date(body.trialEndsAt);
  if (body.status === "suspended") update.suspendedAt = new Date();
  if (body.status === "active") update.suspendedAt = null;

  const updated = await db.tenant.update({ where: { id }, data: update });

  await db.auditLog.create({
    data: {
      tenantId: id,
      actor: `superadmin:${auth.session.superAdminId}`,
      action: body.status === "suspended" ? "suspend" : body.status === "active" ? "restore" : "tenant_update",
      entity: "tenant",
      entityId: id,
      detail: JSON.stringify(update),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ tenant: updated });
}
