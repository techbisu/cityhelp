/**
 * POST /api/orders/[id]/[action] — accept | reject | status | assign
 * Race-safe accept via Prisma transaction.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const { id, action } = await params;
  const body = await req.json();
  const { providerId, reason, actor, status: newStatus } = body;

  const order = await db.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
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
    return NextResponse.json({ order: updated });
  }

  // ── ASSIGN (manual) ──
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
      return u;
    });
    return NextResponse.json({ order: updated });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
