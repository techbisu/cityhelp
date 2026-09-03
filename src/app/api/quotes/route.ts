/**
 * POST /api/quotes — provider sends a quote for a custom order
 *   body: { orderId, amount, deliveryTime }
 * POST /api/quotes/[id]/accept — customer accepts quote
 * POST /api/quotes/[id]/decline — customer declines
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orderId, amount, deliveryTime } = body;
  if (!orderId || !amount) {
    return NextResponse.json({ error: "orderId and amount required" }, { status: 400 });
  }
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  const updated = await db.order.update({
    where: { id: orderId },
    data: {
      status: "quoted",
      quoteAmount: amount,
      quoteDelivery: deliveryTime || null,
      quoteStatus: "pending",
    },
  });
  await db.activity.create({
    data: {
      tenantId: order.tenantId, orderId,
      actor: order.acceptedById ? `provider:${order.acceptedById}` : "system",
      action: "quoted",
      detail: `Quote: ₹${amount / 100}, delivery: ${deliveryTime || "—"}`,
    },
  });
  return NextResponse.json({ order: updated });
}
