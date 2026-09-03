/**
 * POST /api/whatsapp/configure
 * Body: { tenantSlug, phoneNumberId, accessToken, appSecret, verifyToken?, businessName? }
 *
 * Saves the tenant's WhatsApp credentials (encrypted at rest).
 * Generates a verify token if not provided.
 *
 * GET /api/whatsapp/configure?tenantSlug=
 * Returns the tenant's WhatsApp config status (masked tokens, never the real values).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { saveTenantWaCredentials, clearTenantWaCredentials, generateVerifyToken } from "@/lib/whatsapp";
import { getStaffSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    select: {
      waPhoneNumberId: true,
      waBusinessName: true,
      waVerified: true,
      waConfigured: true,
      waAccessTokenMask: true,
      waVerifyToken: true,
      waTestedAt: true,
      waTestStatus: true,
    },
  });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({
    config: {
      ...tenant,
      hasAccessToken: !!tenant.waAccessTokenMask,
      webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://cityhelp.app"}/api/whatsapp/webhook`,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, phoneNumberId, accessToken, appSecret, verifyToken, businessName, action } = body;

  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // ── Disconnect ──
  if (action === "disconnect") {
    await clearTenantWaCredentials(tenant.id);
    // Audit log
    await db.auditLog.create({
      data: {
        tenantId: tenant.id,
        actor: `staff:${tenant.slug}`,
        action: "key_change",
        entity: "whatsapp",
        entityId: tenant.id,
        detail: "WhatsApp credentials disconnected",
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // ── Save credentials ──
  if (!phoneNumberId || !accessToken || !appSecret) {
    return NextResponse.json({ error: "phoneNumberId, accessToken, and appSecret are required" }, { status: 400 });
  }

  await saveTenantWaCredentials(tenant.id, {
    phoneNumberId,
    accessToken,
    appSecret,
    verifyToken: verifyToken || generateVerifyToken(),
    businessName,
  });

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: `staff:${tenant.slug}`,
      action: "key_change",
      entity: "whatsapp",
      entityId: tenant.id,
      detail: `WhatsApp credentials saved (phone_number_id: ${phoneNumberId})`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ ok: true });
}
