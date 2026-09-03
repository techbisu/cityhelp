/**
 * POST /api/orders/[id]/payment-request
 *
 * Provider generates a UPI payment link and sends it to the customer's WhatsApp.
 *
 * Body: { providerId, amount (in rupees), tenantSlug }
 *
 * Flow:
 *  1. Verify order belongs to the tenant + provider belongs to the same tenant
 *  2. Get the tenant's UPI ID (business collects)
 *  3. Generate UPI deep link + web fallback
 *  4. Save payment details on the order (paymentStatus = "requested")
 *  5. Send WhatsApp message to customer with the UPI link
 *  6. Write activity log
 *
 * Future scope: if Razorpay is configured + tenant prefers Razorpay, create a
 * Razorpay Payment Link instead and send that. The razorpayPaymentLinkId is stored.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { generateUpiDeepLink, buildPaymentRequestMessage } from "@/lib/upi";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { providerId, amount, tenantSlug } = body;

  if (!providerId || !amount) {
    return NextResponse.json({ error: "providerId and amount required" }, { status: 400 });
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

  // Verify provider belongs to same tenant
  const provider = await db.provider.findUnique({ where: { id: providerId }, select: { tenantId: true, name: true } });
  if (!provider || provider.tenantId !== order.tenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Check tenant has UPI ID configured
  if (!order.tenant.upiId) {
    return NextResponse.json({
      error: "upi_not_configured",
      message: "Business hasn't set up a UPI ID for collecting payments. Add it in Admin → Settings → Payments.",
    }, { status: 400 });
  }

  const amountPaise = Math.round(parseFloat(amount) * 100);

  // Generate UPI link
  const upiLink = generateUpiDeepLink({
    payeeVpa: order.tenant.upiId,
    payeeName: order.tenant.upiName || order.tenant.name,
    amount: amountPaise,
    note: `Order #${order.code}`,
    txnRef: order.id,
  });

  // Save payment details on the order
  const updated = await db.order.update({
    where: { id },
    data: {
      paymentAmount: amountPaise,
      paymentMethod: "upi",
      paymentStatus: "requested",
      paymentRequestedAt: new Date(),
      upiPaymentLink: upiLink,
      upiId: order.tenant.upiId,
    },
  });

  // Write activity log
  await db.activity.create({
    data: {
      tenantId: order.tenantId,
      orderId: id,
      providerId,
      actor: `provider:${providerId}`,
      action: "payment_requested",
      detail: `Payment request: ₹${amount} via UPI to ${order.tenant.upiId}`,
    },
  });

  // Send WhatsApp message to customer
  const message = buildPaymentRequestMessage(
    order.code,
    amountPaise,
    order.tenant.upiName || order.tenant.name,
    upiLink
  );
  const waResult = await sendWhatsAppText(order.tenantId, order.customer.phone, message);
  if (waResult.skipped) {
    // WhatsApp not configured — log but don't fail
    console.log(`[WA:skip] Payment link for #${order.code} not sent (WhatsApp not configured)`);
  }

  return NextResponse.json({
    ok: true,
    payment: {
      amount: amountPaise,
      method: "upi",
      status: "requested",
      upiLink,
      upiId: order.tenant.upiId,
    },
    whatsappSent: !waResult.skipped,
  });
}
