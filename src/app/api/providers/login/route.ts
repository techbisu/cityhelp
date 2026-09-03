/**
 * POST /api/providers/login — phone + PIN login with lockout
 * Sets a signed httpOnly session cookie on success.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPin } from "@/lib/crypto";
import { setSessionCookie, type ProviderSession } from "@/lib/session";
import { rateLimitOr429, getClientIp } from "@/lib/rate-limit";

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  // Rate limit: 10 login attempts per IP per 15 minutes
  const ip = getClientIp(req);
  const rl = rateLimitOr429(req, `provider-login:${ip}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (rl) return rl;

  const body = await req.json();
  const { tenantSlug, phone, pin } = body;
  if (!tenantSlug || !phone || !pin) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  // Check if tenant is suspended
  if (tenant.status === "suspended") {
    return NextResponse.json({ error: "tenant_suspended", message: "This account is suspended." }, { status: 403 });
  }

  const provider = await db.provider.findUnique({
    where: { tenantId_phone: { tenantId: tenant.id, phone } },
    include: { city: true },
  });
  if (!provider) return NextResponse.json({ error: "invalid credentials" }, { status: 401 });

  if (provider.pinLockedUntil && new Date(provider.pinLockedUntil).getTime() > Date.now()) {
    const remaining = Math.ceil((new Date(provider.pinLockedUntil).getTime() - Date.now()) / 60000);
    return NextResponse.json(
      { error: "locked", message: `Account locked. Try again in ${remaining} min.` },
      { status: 423 }
    );
  }

  if (!verifyPin(pin, provider.pinHash)) {
    const attempts = provider.pinAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db.provider.update({
        where: { id: provider.id },
        data: { pinAttempts: 0, pinLockedUntil: new Date(Date.now() + LOCK_MS) },
      });
      return NextResponse.json(
        { error: "locked", message: "Too many attempts. Account locked for 15 minutes." },
        { status: 423 }
      );
    }
    await db.provider.update({
      where: { id: provider.id },
      data: { pinAttempts: attempts },
    });
    return NextResponse.json(
      { error: "invalid", message: `Wrong PIN. ${MAX_ATTEMPTS - attempts} attempts left.` },
      { status: 401 }
    );
  }

  await db.provider.update({
    where: { id: provider.id },
    data: { pinAttempts: 0, pinLockedUntil: null, lastSeenAt: new Date() },
  });

  // Create session
  const session: ProviderSession = {
    kind: "provider",
    providerId: provider.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    phone: provider.phone,
  };

  const res = NextResponse.json({
    provider: {
      id: provider.id,
      name: provider.name,
      phone: provider.phone,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      tenantAccent: tenant.accentColor,
      cityId: provider.cityId,
      cityName: provider.city.name,
      zone: provider.zone,
      isOnline: provider.isOnline,
      rating: provider.rating,
      jobsDone: provider.jobsDone,
      earnings: provider.earnings,
    },
  });
  setSessionCookie(res, session);
  return res;
}
