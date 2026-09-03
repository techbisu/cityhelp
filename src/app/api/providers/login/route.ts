/**
 * POST /api/providers/login — phone + PIN login with lockout
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPin } from "@/lib/crypto";

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, phone, pin } = body;
  if (!tenantSlug || !phone || !pin) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

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

  return NextResponse.json({
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
}
