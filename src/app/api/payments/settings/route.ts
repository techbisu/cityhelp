/**
 * GET /api/payments/settings?tenantSlug=
 * Returns the tenant's payment settings (UPI ID, Razorpay status).
 *
 * POST /api/payments/settings
 * Body: { tenantSlug, upiId, upiName }
 * Saves the tenant's UPI ID for collecting customer payments.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isBillingConfigured } from "@/lib/razorpay";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    select: {
      upiId: true,
      upiName: true,
      razorpayCustomerId: true,
    },
  });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  return NextResponse.json({
    settings: {
      upiId: tenant.upiId,
      upiName: tenant.upiName,
      razorpayConfigured: isBillingConfigured(),
      razorpayCustomerId: tenant.razorpayCustomerId,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, upiId, upiName } = body;
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  // Basic UPI ID validation
  if (upiId && !/^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+$/.test(upiId)) {
    return NextResponse.json({ error: "Invalid UPI ID format (should be like name@bank)" }, { status: 400 });
  }

  await db.tenant.update({
    where: { id: tenant.id },
    data: {
      upiId: upiId || null,
      upiName: upiName || null,
    },
  });

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: `staff:${tenant.slug}`,
      action: "key_change",
      entity: "payments",
      entityId: tenant.id,
      detail: `UPI ID ${upiId ? "set to " + upiId : "cleared"}`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ ok: true });
}
