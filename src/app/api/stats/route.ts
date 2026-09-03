/**
 * GET /api/stats?tenantSlug=&cityId=
 * Returns dashboard stat cards + sparkline data
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const cityId = searchParams.get("cityId");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  const where: Record<string, unknown> = { tenantId: tenant.id };
  if (cityId && cityId !== "all") where.cityId = cityId;

  // Today's range
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const todayWhere = { ...where, createdAt: { gte: startOfDay, lte: endOfDay } };

  const [
    ordersToday,
    revenueTodayAgg,
    allOrders,
    acceptedOrders,
    escalatedOrders,
    activeProviders,
    totalProviders,
    totalCustomers,
  ] = await Promise.all([
    db.order.count({ where: todayWhere }),
    db.order.aggregate({ where: { ...todayWhere, status: "delivered" }, _sum: { quoteAmount: true } }),
    db.order.findMany({ where, select: { status: true, createdAt: true, quoteAmount: true, acceptedAt: true } }),
    db.order.count({ where: { ...where, status: "accepted" } }),
    db.order.count({ where: { ...where, status: "escalated" } }),
    db.provider.count({ where: { tenantId: tenant.id, isOnline: true, isActive: true } }),
    db.provider.count({ where: { tenantId: tenant.id, isActive: true } }),
    db.customer.count({ where: { tenantId: tenant.id } }),
  ]);

  const revenueToday = revenueTodayAgg._sum.quoteAmount || 0;
  const deliveredCount = allOrders.filter((o) => o.status === "delivered").length;
  const escalatedCount = allOrders.filter((o) => o.status === "escalated" || o.status === "cancelled").length;
  const escalationRate = allOrders.length > 0 ? Math.round((escalatedCount / allOrders.length) * 100) : 0;

  // Average accept time (seconds)
  const acceptedWithTimes = allOrders.filter((o) => o.acceptedAt && o.createdAt);
  const avgAcceptSec = acceptedWithTimes.length > 0
    ? Math.round(
        acceptedWithTimes.reduce((sum, o) => {
          const diff = (o.acceptedAt!.getTime() - o.createdAt.getTime()) / 1000;
          return sum + Math.max(0, diff);
        }, 0) / acceptedWithTimes.length
      )
    : 0;

  // Sparkline: orders per hour for today (24 buckets)
  const sparkOrders = Array.from({ length: 24 }, (_, h) => {
    const hourStart = new Date(startOfDay);
    hourStart.setHours(h, 0, 0, 0);
    const hourEnd = new Date(startOfDay);
    hourEnd.setHours(h, 59, 59, 999);
    return allOrders.filter((o) => o.createdAt >= hourStart && o.createdAt <= hourEnd).length;
  });

  // Sparkline: revenue per day for last 7 days
  const sparkRevenue: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    const dayRev = allOrders
      .filter((o) => o.status === "delivered" && o.createdAt >= dayStart && o.createdAt <= dayEnd)
      .reduce((s, o) => s + (o.quoteAmount || 0), 0);
    sparkRevenue.push(dayRev);
  }

  // Sparkline: escalation rate trend (last 7 days, %)
  const sparkEscalation: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    const dayOrders = allOrders.filter((o) => o.createdAt >= dayStart && o.createdAt <= dayEnd);
    const dayEsc = dayOrders.filter((o) => o.status === "escalated" || o.status === "cancelled").length;
    sparkEscalation.push(dayOrders.length > 0 ? Math.round((dayEsc / dayOrders.length) * 100) : 0);
  }

  // Sparkline: avg accept time trend (last 7 days)
  const sparkAccept: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    const dayAccepted = acceptedWithTimes.filter((o) => o.createdAt >= dayStart && o.createdAt <= dayEnd);
    if (dayAccepted.length === 0) {
      sparkAccept.push(0);
    } else {
      const avg = dayAccepted.reduce((s, o) => {
        const diff = (o.acceptedAt!.getTime() - o.createdAt.getTime()) / 1000;
        return s + Math.max(0, diff);
      }, 0) / dayAccepted.length;
      sparkAccept.push(Math.round(avg));
    }
  }

  // Live orders feed (broadcast, accepted, picked — not delivered/cancelled)
  const liveOrders = await db.order.findMany({
    where: { ...where, status: { in: ["new", "broadcast", "accepted", "picked", "escalated"] } },
    include: {
      customer: { select: { name: true, phone: true } },
      service: { select: { icon: true, key: true, labels: true } },
      city: { select: { name: true } },
      acceptedBy: { select: { name: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  return NextResponse.json({
    cards: {
      ordersToday,
      revenueToday,
      avgAcceptSec,
      escalationRate,
      activeProviders,
      totalProviders,
      totalCustomers,
      acceptedOrders,
      escalatedOrders,
    },
    sparklines: {
      orders: sparkOrders,
      revenue: sparkRevenue,
      escalation: sparkEscalation,
      accept: sparkAccept,
    },
    liveOrders,
  });
}
