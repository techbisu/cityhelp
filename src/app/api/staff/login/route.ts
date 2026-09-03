/**
 * POST /api/staff/login — email + password for tenant staff
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, email, password } = body;
  if (!tenantSlug || !email || !password) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  const staff = await db.staff.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
  });
  if (!staff || !verifyPassword(password, staff.passwordHash)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  await db.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
  return NextResponse.json({
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
}
