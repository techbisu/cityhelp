/**
 * POST /api/orders/[id]/charges
 *
 * Provider sets the charges breakdown (delivery/service/addons/items) at accept time.
 * Customer then sees the breakdown and must agree (chargesConfirmed=true) before payment.
 *
 * Body: { providerId, tenantSlug, deliveryCharge?, serviceCharge?, addonsCharge?, itemsTotal? }
 *       All amounts in RUPEES (converted to paise server-side).
 *
 * Flow:
 *  1. Verify order + provider + tenant
 *  2. Save charges on the order + compute totalAmount
 *  3. Send WhatsApp to customer with the breakdown + [✅ Agree] [❌ Cancel] buttons
 *  4. Customer taps Agree → chargesConfirmed=true (separate endpoint or button callback)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendWhatsAppButtons } from "@/lib/whatsapp";
import { formatINR } from "@/lib/utils";
import { getProviderSession, getStaffSession } from "@/lib/session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { providerId, deliveryCharge, serviceCharge, addonsCharge, itemsTotal } = body;

  if (!providerId) return NextResponse.json({ error: "providerId required" }, { status: 400 });

  // Auth: require provider session
  const providerSession = getProviderSession(req);
  if (!providerSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const order = await db.order.findUnique({
    where: { id },
    include: { customer: true, service: true, tenant: true, acceptedBy: true },
  });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  // Tenant isolation via session
  if (order.tenantId !== providerSession.tenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Verify provider belongs to same tenant
  const provider = await db.provider.findUnique({ where: { id: providerId }, select: { tenantId: true, name: true } });
  if (!provider || provider.tenantId !== order.tenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // CRITICAL: verify the provider setting charges is the one who accepted the order
  if (order.acceptedById !== providerId) {
    return NextResponse.json({ error: "forbidden", message: "Only the provider who accepted this order can set charges" }, { status: 403 });
  }

  // State check: order must be accepted or picked
  if (!["accepted", "picked"].includes(order.status)) {
    return NextResponse.json({ error: "invalid_state", message: `Cannot set charges on a ${order.status} order` }, { status: 400 });
  }

  // Convert rupees to paise — validate input
  const toPaise = (r: number | string | undefined) => {
    if (r === undefined || r === "" || r === null) return 0;
    const n = parseFloat(String(r));
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.round(n * 100);
  };
  const dc = toPaise(deliveryCharge);
  const sc = toPaise(serviceCharge);
  const ac = toPaise(addonsCharge);
  const it = toPaise(itemsTotal);
  // Validate no NaN values
  if ([dc, sc, ac, it].some((v) => Number.isNaN(v))) {
    return NextResponse.json({ error: "invalid_amount", message: "All charge values must be valid non-negative numbers" }, { status: 400 });
  }
  const total = dc + sc + ac + it;

  // Save charges
  const updated = await db.order.update({
    where: { id },
    data: {
      deliveryCharge: dc,
      serviceCharge: sc,
      addonsCharge: ac,
      itemsTotal: it,
      totalAmount: total,
      chargesConfirmed: false, // customer must agree
    },
  });

  // Build breakdown message
  const lines: string[] = [`📋 *Charges for order #${order.code}*`, ""];
  if (it > 0) lines.push(`🛍️ Items: ₹${(it / 100).toFixed(0)}`);
  if (dc > 0) lines.push(`🚚 Delivery: ₹${(dc / 100).toFixed(0)}`);
  if (sc > 0) lines.push(`🔧 Service: ₹${(sc / 100).toFixed(0)}`);
  if (ac > 0) lines.push(`➕ Add-ons: ₹${(ac / 100).toFixed(0)}`);
  lines.push("", `*Total: ₹${(total / 100).toFixed(0)}*`, "", "Do you agree to these charges?");

  const message = lines.join("\n");

  // Send WhatsApp with Agree/Cancel buttons
  const waResult = await sendWhatsAppButtons(
    order.tenantId,
    order.customer.phone,
    message,
    [
      { id: `charges_agree_${id}`, label: "✅ Agree" },
      { id: `charges_cancel_${id}`, label: "❌ Cancel" },
    ]
  );

  // Activity log
  await db.activity.create({
    data: {
      tenantId: order.tenantId,
      orderId: id,
      providerId,
      actor: `provider:${providerId}`,
      action: "charges_set",
      detail: `Charges: items ₹${it / 100}, delivery ₹${dc / 100}, service ₹${sc / 100}, addons ₹${ac / 100}, total ₹${total / 100}`,
    },
  });

  return NextResponse.json({
    ok: true,
    charges: {
      deliveryCharge: dc,
      serviceCharge: sc,
      addonsCharge: ac,
      itemsTotal: it,
      totalAmount: total,
      chargesConfirmed: false,
    },
    whatsappSent: !waResult.skipped,
  });
}

/**
 * PATCH /api/orders/[id]/charges — customer agrees or cancels
 * Body: { agreed: boolean, tenantSlug }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { agreed } = body;

  // This endpoint is primarily called internally by the bot (order-actions.ts).
  // For external HTTP calls, require a staff session.
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const order = await db.order.findUnique({ where: { id }, include: { customer: true, tenant: true } });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (order.tenantId !== staffSession.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (agreed) {
    await db.order.update({
      where: { id },
      data: { chargesConfirmed: true },
    });
    await db.activity.create({
      data: {
        tenantId: order.tenantId, orderId: id,
        actor: "customer",
        action: "charges_agreed",
        detail: `Customer agreed to charges (total ₹${(order.totalAmount || 0) / 100})`,
      },
    });
    return NextResponse.json({ ok: true, chargesConfirmed: true });
  } else {
    // Customer cancelled
    await db.order.update({
      where: { id },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: "Customer declined charges",
      },
    });
    await db.activity.create({
      data: {
        tenantId: order.tenantId, orderId: id,
        actor: "customer",
        action: "charges_declined",
        detail: "Customer declined charges — order cancelled",
      },
    });
    return NextResponse.json({ ok: true, cancelled: true });
  }
}
