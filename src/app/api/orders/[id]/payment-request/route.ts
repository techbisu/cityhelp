/**
 * POST /api/orders/[id]/payment-request
 *
 * Provider generates a UPI payment link and sends it to the customer's WhatsApp.
 *
 * Body: { providerId, amount?, tenantSlug }
 *   - If amount is provided, use it (manual override)
 *   - If not, use order.totalAmount (computed from charges breakdown)
 *
 * UPI ID resolution:
 *   1. Provider's default UPI ID (from provider.upiIds)
 *   2. Fall back to tenant's UPI ID (tenant.upiId)
 *   3. If neither, return error
 *
 * The WhatsApp message includes a full breakdown:
 *   For orders: Items + Delivery = Total
 *   For bookings: Service + Add-ons = Total
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { generateUpiDeepLink, buildPaymentRequestMessage } from "@/lib/upi";
import { safeParse } from "@/lib/utils";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { providerId, amount, tenantSlug } = body;

  if (!providerId) return NextResponse.json({ error: "providerId required" }, { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    include: { customer: true, tenant: true, acceptedBy: true, service: true },
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
  const provider = await db.provider.findUnique({ where: { id: providerId }, select: { tenantId: true, name: true, upiIds: true } });
  if (!provider || provider.tenantId !== order.tenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // CRITICAL: verify the provider requesting is the one who accepted the order
  if (order.acceptedById !== providerId) {
    return NextResponse.json({ error: "forbidden", message: "Only the provider who accepted this order can request payment" }, { status: 403 });
  }

  // State check: order must be accepted or picked (not delivered/cancelled/new)
  if (!["accepted", "picked"].includes(order.status)) {
    return NextResponse.json({ error: "invalid_state", message: `Cannot request payment on a ${order.status} order` }, { status: 400 });
  }

  // Idempotency: if payment already requested, return the existing link
  if (order.paymentStatus === "requested" && order.upiPaymentLink) {
    return NextResponse.json({
      ok: true,
      payment: {
        amount: order.paymentAmount,
        method: "upi",
        status: "requested",
        upiLink: order.upiPaymentLink,
        upiId: order.upiId,
      },
      whatsappSent: false,
      message: "Payment already requested",
    });
  }

  // If already paid, reject
  if (order.paymentStatus === "paid") {
    return NextResponse.json({ error: "already_paid", message: "Payment already confirmed" }, { status: 400 });
  }

  // Determine amount: explicit override > order.totalAmount
  const amountPaise = amount ? Math.round(parseFloat(amount) * 100) : (order.totalAmount || 0);
  if (amountPaise <= 0) {
    return NextResponse.json({
      error: "no_amount",
      message: "Set charges on the order first, or pass an explicit amount.",
    }, { status: 400 });
  }

  // Resolve UPI ID: provider's default > tenant's
  let upiVpa: string;
  let upiName: string;
  let upiSource: "provider" | "tenant";

  const providerUpiIds = safeParse<Array<{ id: string; vpa: string; label: string; isDefault: boolean }>>(provider.upiIds, []);
  const defaultProviderUpi = providerUpiIds.find((u) => u.isDefault) || providerUpiIds[0];
  if (defaultProviderUpi) {
    upiVpa = defaultProviderUpi.vpa;
    upiName = defaultProviderUpi.label || provider.name;
    upiSource = "provider";
  } else if (order.tenant.upiId) {
    upiVpa = order.tenant.upiId;
    upiName = order.tenant.upiName || order.tenant.name;
    upiSource = "tenant";
  } else {
    return NextResponse.json({
      error: "upi_not_configured",
      message: "No UPI ID configured. Provider should add their UPI ID in the app, or admin should set the business UPI ID.",
    }, { status: 400 });
  }

  // Generate UPI link
  const upiLink = generateUpiDeepLink({
    payeeVpa: upiVpa,
    payeeName: upiName,
    amount: amountPaise,
    note: `Order #${order.code}`,
    txnRef: order.id,
  });

  // Save payment details
  const updated = await db.order.update({
    where: { id },
    data: {
      paymentAmount: amountPaise,
      paymentMethod: "upi",
      paymentStatus: "requested",
      paymentRequestedAt: new Date(),
      upiPaymentLink: upiLink,
      upiId: upiVpa,
    },
  });

  // Build the message with breakdown
  const message = buildPaymentRequestWithBreakdown(order, amountPaise, upiName, upiLink, upiSource);

  // Activity log
  await db.activity.create({
    data: {
      tenantId: order.tenantId,
      orderId: id,
      providerId,
      actor: `provider:${providerId}`,
      action: "payment_requested",
      detail: `Payment request: ₹${(amountPaise / 100).toFixed(0)} via UPI to ${upiVpa} (${upiSource})`,
    },
  });

  // Send WhatsApp
  const waResult = await sendWhatsAppText(order.tenantId, order.customer.phone, message);
  if (waResult.skipped) {
    console.log(`[WA:skip] Payment link for #${order.code} not sent (WhatsApp not configured)`);
  }

  return NextResponse.json({
    ok: true,
    payment: {
      amount: amountPaise,
      method: "upi",
      status: "requested",
      upiLink,
      upiId: upiVpa,
      upiSource,
      upiName,
    },
    whatsappSent: !waResult.skipped,
  });
}

function buildPaymentRequestWithBreakdown(
  order: {
    code: string;
    kind: string;
    itemsTotal: number | null;
    deliveryCharge: number | null;
    serviceCharge: number | null;
    addonsCharge: number | null;
    totalAmount: number | null;
    service: { icon: string; key: string; labels: string } | null;
  },
  amountPaise: number,
  upiName: string,
  upiLink: string,
  upiSource: string
): string {
  const lines: string[] = [`💳 *Payment request for order #${order.code}*`, ""];

  // Breakdown
  if (order.kind === "order") {
    if (order.itemsTotal && order.itemsTotal > 0) lines.push(`🛍️ Items: ₹${(order.itemsTotal / 100).toFixed(0)}`);
    if (order.deliveryCharge && order.deliveryCharge > 0) lines.push(`🚚 Delivery: ₹${(order.deliveryCharge / 100).toFixed(0)}`);
  } else if (order.kind === "book") {
    if (order.serviceCharge && order.serviceCharge > 0) lines.push(`🔧 Service: ₹${(order.serviceCharge / 100).toFixed(0)}`);
    if (order.addonsCharge && order.addonsCharge > 0) lines.push(`➕ Add-ons: ₹${(order.addonsCharge / 100).toFixed(0)}`);
  }

  lines.push("", `*Total: ₹${(amountPaise / 100).toFixed(0)}*`, "");
  lines.push(`Pay to: ${upiName} (${upiSource === "provider" ? "provider" : "business"})`);
  lines.push("", "Pay via UPI (any app):");
  lines.push(upiLink);
  lines.push("", "After payment, please share the screenshot here to confirm. 🙏");

  return lines.join("\n");
}
