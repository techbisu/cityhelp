/**
 * POST /api/superadmin/login — email + password (2FA required in production)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const sa = await db.superAdmin.findUnique({ where: { email } });
  if (!sa || !verifyPassword(password, sa.passwordHash)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  await db.superAdmin.update({ where: { id: sa.id }, data: { lastLoginAt: new Date() } });
  return NextResponse.json({
    superAdmin: {
      id: sa.id,
      email: sa.email,
      name: sa.name,
      twoFactorEnabled: sa.twoFactorEnabled,
    },
  });
}
