/**
 * POST /api/whatsapp/send
 * Internal endpoint to send an outbound WhatsApp message to a customer.
 *
 * Body: { tenantSlug, phone, text } or { tenantSlug, phone, text, buttons: [...] }
 *
 * Uses the TENANT's own WhatsApp credentials (not global env vars).
 * If the tenant hasn't configured WhatsApp, returns { skipped: true }.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendWhatsAppText, sendWhatsAppButtons } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, phone, text, buttons } = body;

  if (!tenantSlug || !phone || !text) {
    return NextResponse.json({ error: "tenantSlug, phone, and text required" }, { status: 400 });
  }

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, waConfigured: true } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  if (!tenant.waConfigured) {
    // Graceful skip — log only
    console.log(`[WA:skip] Tenant ${tenantSlug} has no WhatsApp configured. Would send to ${phone}: ${text}`);
    return NextResponse.json({ ok: false, skipped: true, reason: "whatsapp_not_configured" });
  }

  if (buttons && Array.isArray(buttons) && buttons.length > 0) {
    const res = await sendWhatsAppButtons(tenant.id, phone, text, buttons);
    return NextResponse.json(res, { status: res.ok ? 200 : 500 });
  }

  const res = await sendWhatsAppText(tenant.id, phone, text);
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}
