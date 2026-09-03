/**
 * POST /api/billing/checkout
 * Body: { tenantSlug, planId }
 *
 * Creates a Razorpay order for the plan upgrade and returns the order ID + key ID.
 * The client opens the Razorpay checkout modal with these.
 *
 * SECURITY: Never trust the price from the client. We look up the plan's priceMonthly
 * from the DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createRazorpayOrder, isBillingConfigured, getRazorpayKeyId } from "@/lib/razorpay";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, planId } = body;
  if (!tenantSlug || !planId) {
    return NextResponse.json({ error: "tenantSlug and planId required" }, { status: 400 });
  }
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan) return NextResponse.json({ error: "plan not found" }, { status: 404 });

  if (!isBillingConfigured()) {
    // Phase 2 screen — return a flag so the UI shows "billing not yet configured"
    return NextResponse.json({
      ok: false,
      billingConfigured: false,
      message: "Razorpay not configured. Contact platform owner for manual activation.",
    });
  }

  const receipt = `ch_${tenant.slug}_${Date.now()}`;
  const order = await createRazorpayOrder(plan.priceMonthly, "INR", receipt, {
    tenant_id: tenant.id,
    plan_id: plan.id,
    plan_name: plan.name,
  });
  if ("error" in order) {
    return NextResponse.json({ error: order.error }, { status: 500 });
  }

  // Create a pending invoice
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  const invoiceCount = await db.invoice.count();
  const invoice = await db.invoice.create({
    data: {
      tenantId: tenant.id,
      invoiceNumber: `INV-${String(invoiceCount + 1).padStart(5, "0")}`,
      razorpayOrderId: order.id,
      amount: plan.priceMonthly,
      planName: plan.name,
      periodStart: now,
      periodEnd,
      status: "pending",
    },
  });

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: `staff:${tenant.slug}`,
      action: "checkout_started",
      entity: "invoice",
      entityId: invoice.id,
      detail: `Checkout for ${plan.name} (₹${plan.priceMonthly / 100})`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: getRazorpayKeyId(),
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    planName: plan.name,
  });
}
