/**
 * POST /api/quotes — provider sends a quote for a custom order
 *   body: { orderId, amount, deliveryTime }
 *
 * Auth: requires provider session; provider must be the one who accepted the order
 * State check: order must be in "new" or "custom" status
 * Notifies customer via WhatsApp with Accept/Decline buttons
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProviderSession } from "@/lib/session";
import { sendWhatsAppButtons } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orderId, amount, deliveryTime } = body;
  if (!orderId || !amount) {
    return NextResponse.json({ error: "orderId and amount required" }, { status: 400 });
  }

  // Auth
  const providerSession = getProviderSession(req);
  if (!providerSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { customer: true },
  });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  // Tenant isolation
  if (order.tenantId !== providerSession.tenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // State check: order must be in new/custom status for quoting
  if (!["new", "broadcast", "escalated"].includes(order.status)) {
    return NextResponse.json({ error: "invalid_state", message: `Cannot quote a ${order.status} order` }, { status: 400 });
  }

  const amountPaise = Math.round(parseFloat(amount) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  const updated = await db.order.update({
    where: { id: orderId },
    data: {
      status: "quoted",
      quoteAmount: amountPaise,
      quoteDelivery: deliveryTime || null,
      quoteStatus: "pending",
      acceptedById: providerSession.providerId, // the quoting provider is tentatively assigned
    },
  });

  await db.activity.create({
    data: {
      tenantId: order.tenantId, orderId,
      providerId: providerSession.providerId,
      actor: `provider:${providerSession.providerId}`,
      action: "quoted",
      detail: `Quote: ₹${amountPaise / 100}, delivery: ${deliveryTime || "—"}`,
    },
  });

  // Notify customer via WhatsApp with Accept/Decline buttons
  const amountRupees = (amountPaise / 100).toLocaleString("en-IN");
  const message = `💬 Quote for your order #${order.code}\n\nAmount: ₹${amountRupees}\nDelivery: ${deliveryTime || "—"}\n\nDo you accept?`;
  await sendWhatsAppButtons(
    order.tenantId,
    order.customer.phone,
    message,
    [
      { id: `quote_accept_${orderId}`, label: "✅ Accept" },
      { id: `quote_decline_${orderId}`, label: "❌ Decline" },
    ]
  );

  return NextResponse.json({ order: updated });
}
