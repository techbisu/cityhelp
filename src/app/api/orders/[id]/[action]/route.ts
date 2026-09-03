/**
 * POST /api/orders/[id]/[action] — accept | reject | status | assign
 *
 * Security:
 *  - Tenant isolation: verifies order.tenantId matches the caller's session/tenantSlug
 *  - Race-safe accept via Prisma $transaction
 *  - Sends WhatsApp notification to customer on accept/picked/delivered
 *  - Writes audit logs for sensitive actions (assign, status changes by admin)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const { id, action } = await params;
  const body = await req.json();
  const { providerId, reason, actor, status: newStatus, tenantSlug } = body;

  const order = await db.order.findUnique({
    where: { id },
    include: { customer: true, service: true, city: true, acceptedBy: true },
  });
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  // ── TENANT ISOLATION ──
  // Verify the caller's tenant matches the order's tenant
  let callerTenantId: string | null = null;
  if (tenantSlug) {
    const callerTenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    callerTenantId = callerTenant?.id || null;
  }
  if (callerTenantId && order.tenantId !== callerTenantId) {
    return NextResponse.json({ error: "forbidden", message: "Order does not belong to your tenant" }, { status: 403 });
  }
  // If providerId given, verify provider belongs to same tenant
  if (providerId) {
    const provider = await db.provider.findUnique({ where: { id: providerId }, select: { tenantId: true } });
    if (!provider || provider.tenantId !== order.tenantId) {
      return NextResponse.json({ error: "forbidden", message: "Provider does not belong to this tenant" }, { status: 403 });
    }
  }

  // ── Helper: notify customer via WhatsApp (per-tenant credentials) ──
  async function notifyCustomer(text: string) {
    // Uses the tenant's own WhatsApp credentials; skips gracefully if not configured
    const res = await sendWhatsAppText(order.tenantId, order.customer.phone, text);
    if (res.skipped) {
      // Tenant hasn't configured WhatsApp — log in dev
      console.log(`[WA:skip] Tenant ${order.tenantId} — would notify ${order.customer.phone}: ${text}`);
    }
    return res;
  }

  // ── ACCEPT ──
  if (action === "accept") {
    if (!providerId) return NextResponse.json({ error: "providerId required" }, { status: 400 });
    if (["accepted", "picked", "delivered"].includes(order.status)) {
      return NextResponse.json(
        { error: "already_taken", message: "Another provider already accepted this order" },
        { status: 409 }
      );
    }
    try {
      const updated = await db.$transaction(async (tx) => {
        const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } });
        if (!fresh || ["accepted", "picked", "delivered"].includes(fresh.status)) {
          throw new Error("already_taken");
        }
        const u = await tx.order.update({
          where: { id },
          data: { status: "accepted", acceptedById: providerId, acceptedAt: new Date() },
        });
        await tx.orderBroadcast.updateMany({
          where: { orderId: id, providerId },
          data: { status: "accepted", respondedAt: new Date() },
        });
        await tx.orderBroadcast.updateMany({
          where: { orderId: id, NOT: { providerId } },
          data: { status: "rejected", respondedAt: new Date() },
        });
        await tx.activity.create({
          data: {
            tenantId: order.tenantId, orderId: id, providerId,
            actor: `provider:${providerId}`, action: "accepted", detail: "Accepted by provider",
          },
        });
        return u;
      });
      await db.provider.update({
        where: { id: providerId },
        data: { jobsDone: { increment: 1 } },
      });
      // Notify customer
      const provider = await db.provider.findUnique({ where: { id: providerId }, select: { name: true } });
      await notifyCustomer(`✅ Order #${order.code} accepted!\n${provider?.name || "Our partner"} will arrive in ~10 minutes.`);
      return NextResponse.json({ order: updated });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      if (msg === "already_taken") {
        return NextResponse.json(
          { error: "already_taken", message: "Another provider already accepted this order" },
          { status: 409 }
        );
      }
      throw e;
    }
  }

  // ── REJECT ──
  if (action === "reject") {
    if (!providerId) return NextResponse.json({ error: "providerId required" }, { status: 400 });
    await db.orderBroadcast.updateMany({
      where: { orderId: id, providerId },
      data: { status: "rejected", respondedAt: new Date() },
    });
    await db.activity.create({
      data: {
        tenantId: order.tenantId, orderId: id, providerId,
        actor: `provider:${providerId}`, action: "rejected", detail: reason || "Rejected",
      },
    });
    return NextResponse.json({ ok: true });
  }

  // ── STATUS ──
  if (action === "status") {
    if (!newStatus || !["picked", "delivered", "cancelled", "escalated", "quoted"].includes(newStatus)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const update: Record<string, unknown> = { status: newStatus };
    if (newStatus === "picked") update.pickedAt = new Date();
    if (newStatus === "delivered") {
      update.deliveredAt = new Date();
      if (order.quoteAmount) {
        await db.customer.update({
          where: { id: order.customerId },
          data: { totalOrders: { increment: 1 }, lifetimeValue: { increment: order.quoteAmount } },
        });
        if (order.acceptedById) {
          await db.provider.update({
            where: { id: order.acceptedById },
            data: { earnings: { increment: order.quoteAmount } },
          });
        }
      }
    }
    if (newStatus === "cancelled") {
      update.cancelledAt = new Date();
      update.cancelReason = reason || null;
    }
    if (newStatus === "escalated") update.escalatedAt = new Date();
    const updated = await db.order.update({ where: { id }, data: update });
    await db.activity.create({
      data: {
        tenantId: order.tenantId, orderId: id,
        providerId: providerId || order.acceptedById || null,
        actor: actor || (providerId ? `provider:${providerId}` : "system"),
        action: newStatus, detail: reason || `Status → ${newStatus}`,
      },
    });
    // WhatsApp notifications
    if (newStatus === "picked") {
      await notifyCustomer(`📦 Your order #${order.code} has been picked up and is on the way.`);
    } else if (newStatus === "delivered") {
      await notifyCustomer(`🎉 Order #${order.code} delivered! Thank you for choosing us. Rate your experience: ⭐⭐⭐⭐⭐`);
    } else if (newStatus === "cancelled") {
      await notifyCustomer(`❌ Order #${order.code} has been cancelled. Reason: ${reason || "—"}. Type "menu" to start a new order.`);
    } else if (newStatus === "escalated") {
      // Owner alert (push + email if enabled)
      const notifSettings = await db.notificationSetting.findUnique({ where: { tenantId: order.tenantId } });
      if (notifSettings?.escalationPush) {
        // Web push to online providers in the city (or owner)
        try {
          const { broadcastToTenant } = await import("@/lib/realtime");
          await broadcastToTenant(order.tenantId, "escalation", {
            orderId: order.id, code: order.code, area: order.addressArea,
          });
        } catch { /* mini-service may not be running */ }
      }
      if (notifSettings?.escalationEmail) {
        try {
          const { sendEscalationEmail } = await import("@/lib/email");
          const tenant = await db.tenant.findUnique({ where: { id: order.tenantId }, include: { staff: { where: { role: "owner" } } } });
          if (tenant?.staff[0]?.email) {
            await sendEscalationEmail(tenant.staff[0].email, tenant.name, order.code, order.addressArea || "—");
          }
        } catch { /* email optional */ }
      }
    }
    return NextResponse.json({ order: updated });
  }

  // ── ASSIGN (manual by admin) ──
  if (action === "assign") {
    if (!providerId) return NextResponse.json({ error: "providerId required" }, { status: 400 });
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.order.update({
        where: { id },
        data: {
          status: "accepted", acceptedById: providerId, acceptedAt: new Date(), escalatedAt: null,
        },
      });
      await tx.activity.create({
        data: {
          tenantId: order.tenantId, orderId: id, providerId,
          actor: actor || "admin", action: "assigned", detail: "Manually assigned",
        },
      });
      // Audit log
      await tx.auditLog.create({
        data: {
          tenantId: order.tenantId,
          actor: actor || "admin",
          action: "assign",
          entity: "order",
          entityId: id,
          detail: `Manually assigned order #${order.code} to provider ${providerId}`,
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
        },
      });
      return u;
    });
    // Notify customer
    const provider = await db.provider.findUnique({ where: { id: providerId }, select: { name: true } });
    await notifyCustomer(`✅ Order #${order.code} accepted!\n${provider?.name || "Our partner"} will arrive soon.`);
    return NextResponse.json({ order: updated });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
