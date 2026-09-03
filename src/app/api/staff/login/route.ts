/**
 * POST /api/staff/login — email + password for tenant staff
 * Sets a signed httpOnly session cookie on success.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { setSessionCookie, type StaffSession } from "@/lib/session";
import { rateLimitOr429, getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  // Rate limit: 10 login attempts per IP per 15 minutes
  const ip = getClientIp(req);
  const rl = rateLimitOr429(req, `staff-login:${ip}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (rl) return rl;

  const body = await req.json();
  const { tenantSlug, email, password } = body;
  if (!tenantSlug || !email || !password) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  // Check if tenant is suspended
  if (tenant.status === "suspended") {
    return NextResponse.json({ error: "tenant_suspended", message: "This account is suspended. Contact support." }, { status: 403 });
  }

  const staff = await db.staff.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
  });
  if (!staff || !verifyPassword(password, staff.passwordHash)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  await db.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });

  // Create session
  const session: StaffSession = {
    kind: "staff",
    staffId: staff.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    email: staff.email,
    role: staff.role,
    permissions: staff.permissions,
  };

  const res = NextResponse.json({
    staff: {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      permissions: staff.permissions,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      tenantAccent: tenant.accentColor,
    },
  });
  setSessionCookie(res, session);
  return res;
}
