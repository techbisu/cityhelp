/**
 * POST /api/billing/webhook
 *
 * Razorpay webhook receiver. Signature-verified and idempotent.
 * Handles: payment.captured, payment.failed, subscription.activated,
 *          subscription.charged, subscription.cancelled
 *
 * On payment success:
 *  - Update invoice status → "paid"
 *  - Update tenant.planId, currentPeriodEnd
 *  - Send receipt email
 *  - Write audit log
 *
 * On 7-day dunning failure → tenant downgraded to Free (data preserved).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyRazorpayWebhookSignature } from "@/lib/razorpay";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = body.event;
  const payload = body.payload?.payment || body.payload?.subscription || {};
  const entityId = payload?.entity?.id;
  if (!entityId) {
    return NextResponse.json({ ok: true, message: "no_entity" });
  }

  // IDEMPOTENCY: check if we already processed this event
  const existingLog = await db.auditLog.findFirst({
    where: {
      action: "webhook_event",
      entity: "razorpay_event",
      entityId: body.event_id || entityId,
    },
  });
  if (existingLog) {
    return NextResponse.json({ ok: true, message: "duplicate_ignored" });
  }

  // Record the event
  await db.auditLog.create({
    data: {
      actor: "razorpay",
      action: "webhook_event",
      entity: "razorpay_event",
      entityId: body.event_id || entityId,
      detail: `${event} for ${entityId}`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  // Handle events
  if (event === "payment.captured" || event === "subscription.charged") {
    const paymentId = payload.entity.id;
    const orderId = payload.entity.order_id;
    const amount = payload.entity.amount || payload.entity.amount_paid;

    // Find the invoice by razorpayOrderId or subscriptionId
    let invoice = await db.invoice.findFirst({
      where: { razorpayOrderId: orderId },
    });
    if (!invoice && payload.entity.subscription_id) {
      invoice = await db.invoice.findFirst({
        where: { razorpaySubscriptionId: payload.entity.subscription_id },
        orderBy: { createdAt: "desc" },
      });
    }

    if (invoice) {
      // Idempotent: only update if not already paid
      if (invoice.status !== "paid") {
        await db.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "paid",
            razorpayPaymentId: paymentId,
            paidAt: new Date(),
            paymentMethod: payload.entity.method || "online",
          },
        });
        // Update tenant plan
        const plan = await db.plan.findFirst({ where: { name: invoice.planName } });
        if (plan) {
          await db.tenant.update({
            where: { id: invoice.tenantId },
            data: {
              planId: plan.id,
              status: "active",
              currentPeriodEnd: invoice.periodEnd,
              dunningStartedAt: null,
            },
          });
        }
        // Send receipt email
        try {
          const { sendPaymentReceipt, isEmailConfigured } = await import("@/lib/email");
          if (isEmailConfigured()) {
            const tenant = await db.tenant.findUnique({
              where: { id: invoice.tenantId },
              include: { staff: { where: { role: "owner" } } },
            });
            if (tenant?.staff[0]?.email) {
              await sendPaymentReceipt(tenant.staff[0].email, tenant.name, {
                invoiceNumber: invoice.invoiceNumber,
                amount: invoice.amount,
                plan: invoice.planName,
                period: `${invoice.periodStart.toLocaleDateString()} – ${invoice.periodEnd.toLocaleDateString()}`,
                paymentMethod: payload.entity.method || "online",
              });
            }
          }
        } catch {
          // email optional
        }
      }
    }
  } else if (event === "payment.failed") {
    // Start dunning if not already
    const orderId = payload.entity.order_id;
    const invoice = await db.invoice.findFirst({ where: { razorpayOrderId: orderId } });
    if (invoice && invoice.status !== "paid") {
      await db.invoice.update({
        where: { id: invoice.id },
        data: { status: "failed" },
      });
      const tenant = await db.tenant.findUnique({ where: { id: invoice.tenantId } });
      if (tenant && !tenant.dunningStartedAt) {
        await db.tenant.update({
          where: { id: tenant.id },
          data: { dunningStartedAt: new Date() },
        });
      }
    }
  } else if (event === "subscription.cancelled") {
    const tenant = await db.tenant.findFirst({
      where: { razorpaySubscriptionId: entityId },
    });
    if (tenant) {
      await db.tenant.update({
        where: { id: tenant.id },
        data: { status: "cancelled" },
      });
    }
  }

  // DUNNING: check for tenants in dunning > 7 days → downgrade to Free
  await runDunningCheck();

  return NextResponse.json({ ok: true, processed: event });
}

/**
 * Dunning: if a tenant has been in dunning for > 7 days, downgrade to Free.
 * Data is preserved — only the plan changes.
 */
async function runDunningCheck() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dunningTenants = await db.tenant.findMany({
    where: {
      dunningStartedAt: { lt: sevenDaysAgo },
      status: { in: ["active", "trial"] },
    },
  });
  const freePlan = await db.plan.findFirst({ where: { name: "Free" } });
  if (!freePlan) return;
  for (const t of dunningTenants) {
    await db.tenant.update({
      where: { id: t.id },
      data: { planId: freePlan.id, dunningStartedAt: null, status: "active" },
    });
    await db.auditLog.create({
      data: {
        tenantId: t.id,
        actor: "system",
        action: "plan_change",
        entity: "tenant",
        entityId: t.id,
        detail: "Auto-downgraded to Free after 7 days dunning",
      },
    });
  }
}
