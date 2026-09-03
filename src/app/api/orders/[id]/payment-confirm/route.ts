/**
 * POST /api/orders/[id]/payment-confirm
 *
 * Provider confirms that they received the payment (after customer paid via UPI
 * and shared the screenshot on WhatsApp).
 *
 * Body: { providerId, tenantSlug, method? ("upi" | "cash") }
 *
 * Flow:
 *  1. Verify order + provider + tenant
 *  2. Mark payment as confirmed (paymentStatus = "paid", paymentConfirmedAt, paymentConfirmedById)
 *  3. Send WhatsApp confirmation to customer
 *  4. Write activity log + audit log
 *
 * Future: verify against Razorpay webhook instead of manual confirmation.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { buildPaymentConfirmedMessage } from "@/lib/upi";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { providerId, tenantSlug, method } = body;

  if (!providerId) {
    return NextResponse.json({ error: "providerId required" }, { status: 400 });
  }

  const order = await db.order.findUnique({
    where: { id },
    include: { customer: true, tenant: true },
  });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  // Tenant isolation
  if (tenantSlug) {
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant || order.tenantId !== tenant.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Verify provider
  const provider = await db.provider.findUnique({ where: { id: providerId }, select: { tenantId: true, name: true } });
  if (!provider || provider.tenantId !== order.tenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Update payment status
  const updated = await db.order.update({
    where: { id },
    data: {
      paymentStatus: "paid",
      paymentConfirmedAt: new Date(),
      paymentConfirmedById: providerId,
      paymentMethod: method || order.paymentMethod || "upi",
    },
  });

  // Activity log
  await db.activity.create({
    data: {
      tenantId: order.tenantId,
      orderId: id,
      providerId,
      actor: `provider:${providerId}`,
      action: "payment_confirmed",
      detail: `Payment confirmed: ₹${(order.paymentAmount || 0) / 100} via ${method || order.paymentMethod || "upi"}`,
    },
  });

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: order.tenantId,
      actor: `provider:${providerId}`,
      action: "payment_confirmed",
      entity: "order",
      entityId: id,
      detail: `Payment confirmed for order #${order.code}`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  // Send WhatsApp confirmation to customer
  if (order.paymentAmount) {
    const message = buildPaymentConfirmedMessage(order.code, order.paymentAmount);
    const waResult = await sendWhatsAppText(order.tenantId, order.customer.phone, message);
    if (waResult.skipped) {
      console.log(`[WA:skip] Payment confirmation for #${order.code} not sent`);
    }
  }

  return NextResponse.json({
    ok: true,
    payment: {
      status: "paid",
      confirmedAt: updated.paymentConfirmedAt,
      confirmedBy: provider.name,
      method: updated.paymentMethod,
    },
  });
}
