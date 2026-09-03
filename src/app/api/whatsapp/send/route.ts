/**
 * POST /api/whatsapp/send
 * Internal endpoint to send an outbound WhatsApp message to a customer.
 * Body: { phone, text } or { phone, text, buttons: [...] } or { phone, list }
 *
 * Used by:
 *  - Order accept → "✅ Order #1024 accepted! Provider Vikram will arrive in ~10 min."
 *  - Order picked → "📦 Your order has been picked up."
 *  - Order delivered → "🎉 Order delivered! Rate your experience."
 */
import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppText, sendWhatsAppButtons, isWhatsAppConfigured } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { phone, text, buttons } = body;

  if (!phone || !text) {
    return NextResponse.json({ error: "phone and text required" }, { status: 400 });
  }

  if (!isWhatsAppConfigured()) {
    // Graceful skip in dev — log only
    console.log(`[WA:skip] Would send to ${phone}: ${text}`);
    return NextResponse.json({ ok: false, skipped: true, reason: "whatsapp_not_configured" });
  }

  if (buttons && Array.isArray(buttons) && buttons.length > 0) {
    const res = await sendWhatsAppButtons(phone, text, buttons);
    return NextResponse.json(res, { status: res.ok ? 200 : 500 });
  }

  const res = await sendWhatsAppText(phone, text);
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}
