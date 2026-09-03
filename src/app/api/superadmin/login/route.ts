/**
 * POST /api/superadmin/login — email + password (2FA required in production)
 * Sets a signed httpOnly session cookie on success.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { setSessionCookie, type SuperSession } from "@/lib/session";
import { rateLimitOr429, getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  // Rate limit: 5 login attempts per IP per 15 minutes (stricter for super admin)
  const ip = getClientIp(req);
  const rl = rateLimitOr429(req, `superadmin-login:${ip}`, { max: 5, windowMs: 15 * 60 * 1000 });
  if (rl) return rl;

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

  // Create session — 2FA verification status included
  const session: SuperSession = {
    kind: "superadmin",
    superAdminId: sa.id,
    email: sa.email,
    twoFactorVerified: !sa.twoFactorEnabled, // if 2FA is enabled, they need to verify separately
  };

  const res = NextResponse.json({
    superAdmin: {
      id: sa.id,
      email: sa.email,
      name: sa.name,
      twoFactorEnabled: sa.twoFactorEnabled,
    },
  });
  setSessionCookie(res, session);
  return res;
}
