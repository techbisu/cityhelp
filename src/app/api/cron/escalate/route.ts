/**
 * GET /api/cron/escalate
 *
 * Vercel Cron (or external scheduler) calls this every 60 seconds.
 * Scans for `broadcast` orders older than 2 minutes and escalates them.
 *
 * On escalation:
 *  - Order status → "escalated", escalatedAt = now
 *  - Owner gets a push notification (via WS broadcast)
 *  - Owner gets an email if escalationEmail is enabled
 *
 * Auth: requires CRON_SECRET header (or ?secret=) matching env var.
 *
 * vercel.json:
 *   "crons": [{ "path": "/api/cron/escalate", "schedule": "* * * * *" }]
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { broadcastToTenant } from "@/lib/realtime";

const CRON_SECRET = process.env.CRON_SECRET || "cityhelp-cron-secret-dev";
const ESCALATION_MS = 2 * 60 * 1000; // 2 minutes

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get("authorization");
  const secretParam = new URL(req.url).searchParams.get("secret");
  const secret = authHeader?.replace("Bearer ", "") || secretParam;
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - ESCALATION_MS);
  // Find broadcast orders older than 2 minutes
  const staleOrders = await db.order.findMany({
    where: {
      status: "broadcast",
      createdAt: { lt: cutoff },
    },
    include: { tenant: { include: { staff: { where: { role: "owner" } } } } },
    take: 50,
  });

  let escalated = 0;
  for (const order of staleOrders) {
    await db.$transaction(async (tx) => {
      // Re-check status to avoid race
      const fresh = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } });
      if (!fresh || fresh.status !== "broadcast") return;
      await tx.order.update({
        where: { id: order.id },
        data: { status: "escalated", escalatedAt: new Date() },
      });
      await tx.activity.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          actor: "system",
          action: "escalated",
          detail: "Auto-escalated after 2 minutes with no acceptance",
        },
      });
    });

    // Push notification to tenant admins/owner
    await broadcastToTenant(order.tenantId, "escalation", {
      orderId: order.id,
      code: order.code,
      area: order.addressArea,
      tenantId: order.tenantId,
    });

    // Email alert if enabled
    const settings = await db.notificationSetting.findUnique({ where: { tenantId: order.tenantId } });
    if (settings?.escalationEmail && order.tenant.staff[0]?.email) {
      try {
        const { sendEscalationEmail, isEmailConfigured } = await import("@/lib/email");
        if (isEmailConfigured()) {
          await sendEscalationEmail(
            order.tenant.staff[0].email,
            order.tenant.name,
            order.code,
            order.addressArea || "—"
          );
        }
      } catch {
        // email optional — never fail the escalation
      }
    }
    escalated++;
  }

  return NextResponse.json({
    ok: true,
    checked: staleOrders.length,
    escalated,
    cutoff: cutoff.toISOString(),
  });
}
