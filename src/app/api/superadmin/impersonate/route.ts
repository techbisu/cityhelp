/**
 * POST /api/superadmin/impersonate
 * Body: { tenantId, action: "start" | "end" }
 * Auth: requires super-admin session
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = requireSuperSession(req);
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const { tenantId, action } = body;
  if (!tenantId || !action) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  await db.auditLog.create({
    data: {
      tenantId,
      actor: `superadmin:${auth.session.superAdminId}`,
      action: action === "start" ? "impersonation_start" : "impersonation_end",
      entity: "tenant",
      entityId: tenantId,
      detail: `${action === "start" ? "Started" : "Ended"} impersonation of ${tenant.name}`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ ok: true });
}
