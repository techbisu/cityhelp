/**
 * GET /api/cron/digest — daily digest email at 9 AM IST
 * Schedule: "0 4 * * *" (9 AM IST = 4 AM UTC)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const CRON_SECRET = process.env.CRON_SECRET || (process.env.NODE_ENV === "production" ? "" : "cityhelp-cron-secret-dev");

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = authHeader?.replace("Bearer ", "");
  if (process.env.NODE_ENV === "production" && !CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (secret !== CRON_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const tenants = await db.tenant.findMany({
    where: { status: { in: ["active", "trial"] } },
    include: {
      staff: { where: { role: "owner" } },
      notifications: true,
      plan: true,
    },
  });

  let sent = 0;
  for (const tenant of tenants) {
    if (!tenant.notifications?.dailyDigest) continue;
    if (!tenant.plan.featureEmail) continue;
    const owner = tenant.staff[0];
    if (!owner?.email) continue;

    const { isEmailConfigured, sendDailyDigest } = await import("@/lib/email");
    if (!isEmailConfigured()) continue;

    // Compute stats for today
    const orders = await db.order.findMany({
      where: { tenantId: tenant.id, createdAt: { gte: startOfDay, lte: endOfDay } },
      select: { quoteAmount: true, status: true, acceptedAt: true, createdAt: true },
    });
    const ordersToday = orders.length;
    const revenueToday = orders.filter((o) => o.status === "delivered").reduce((s, o) => s + (o.quoteAmount || 0), 0);
    const acceptedWithTimes = orders.filter((o) => o.acceptedAt);
    const avgAcceptSec = acceptedWithTimes.length > 0
      ? Math.round(acceptedWithTimes.reduce((s, o) => s + Math.max(0, (o.acceptedAt!.getTime() - o.createdAt.getTime()) / 1000), 0) / acceptedWithTimes.length)
      : 0;
    const escalationRate = ordersToday > 0
      ? Math.round((orders.filter((o) => o.status === "escalated" || o.status === "cancelled").length / ordersToday) * 100)
      : 0;

    // Top providers today
    const topProvidersRaw = await db.order.findMany({
      where: { tenantId: tenant.id, status: "delivered", deliveredAt: { gte: startOfDay, lte: endOfDay } },
      select: { acceptedById: true, quoteAmount: true, acceptedBy: { select: { name: true } } },
    });
    const providerMap = new Map<string, { name: string; jobs: number; earnings: number }>();
    for (const o of topProvidersRaw) {
      if (!o.acceptedById || !o.acceptedBy) continue;
      const e = providerMap.get(o.acceptedById) || { name: o.acceptedBy.name, jobs: 0, earnings: 0 };
      e.jobs++;
      e.earnings += o.quoteAmount || 0;
      providerMap.set(o.acceptedById, e);
    }
    const topProviders = Array.from(providerMap.values()).sort((a, b) => b.jobs - a.jobs).slice(0, 5);

    await sendDailyDigest(owner.email, tenant.name, {
      ordersToday, revenueToday, avgAcceptSec, escalationRate, topProviders,
    });
    sent++;
  }

  return NextResponse.json({ ok: true, sent, total: tenants.length });
}
