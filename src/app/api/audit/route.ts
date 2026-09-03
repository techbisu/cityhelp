/**
 * GET /api/audit?tenantSlug=&super=true
 *   - If super=true: requires super-admin session, returns all audit logs
 *   - If tenantSlug: requires staff session for that tenant, returns tenant-scoped logs
 *
 * POST /api/audit — REMOVED (internal only, no public endpoint)
 *   Audit logs are written server-side by other routes, never by public API calls.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSession, getSuperSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const isGlobal = searchParams.get("super") === "true";
  const action = searchParams.get("action");
  const limit = parseInt(searchParams.get("limit") || "100", 10);

  const where: Record<string, unknown> = {};

  if (isGlobal) {
    // Global audit log requires super-admin session
    const superSession = getSuperSession(req);
    if (!superSession) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (tenantSlug) {
    // Tenant-scoped audit log requires staff session
    const staffSession = getStaffSession(req);
    if (!staffSession) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
    if (staffSession.tenantId !== tenant.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    where.tenantId = tenant.id;
  } else {
    return NextResponse.json({ error: "tenantSlug or super=true required" }, { status: 400 });
  }

  if (action) where.action = action;

  const logs = await db.auditLog.findMany({
    where,
    include: { tenant: { select: { name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 500),
  });
  return NextResponse.json({ logs });
}

// POST removed — audit logs are only written server-side by other API routes.
// This prevents anyone from forging audit log entries.
