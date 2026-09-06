/**
 * GET /api/stats?tenantSlug=&cityId=
 * Returns dashboard stat cards + sparkline data
 * Auth: requires staff session
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  const cityId = searchParams.get("cityId");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
    acceptedOrders,
    escalatedOrders,
    activeProviders,
    totalProviders,
    totalCustomers,
    deliveredCount,
    escalatedCount,
    avgAcceptAgg,
    sevenDaysAgo,
  ] = await Promise.all([
    db.order.count({ where: todayWhere }),
    db.order.aggregate({ where: { ...todayWhere, status: "delivered" }, _sum: { quoteAmount: true } }),
    db.order.count({ where: { ...where, status: "accepted" } }),
    db.order.count({ where: { ...where, status: "escalated" } }),
    db.provider.count({ where: { tenantId: tenant.id, isOnline: true, isActive: true } }),
    db.provider.count({ where: { tenantId: tenant.id, isActive: true } }),
    db.customer.count({ where: { tenantId: tenant.id } }),
    db.order.count({ where: { ...where, status: "delivered" } }),
    db.order.count({ where: { ...where, OR: [{ status: "escalated" }, { status: "cancelled" }] } }),
    // Avg accept time: use aggregate on recent orders with acceptedAt
    db.order.aggregate({
      where: { ...where, acceptedAt: { not: null }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      _count: true,
    }),
    new Date(Date.now() - 7 * 86400000),
  ]);

  const revenueToday = revenueTodayAgg._sum.quoteAmount || 0;

  // Total orders for rate calculations (use count, not array)
  const totalOrdersForRate = deliveredCount + escalatedCount + acceptedOrders + ordersToday;
  const escalationRate = totalOrdersForRate > 0 ? Math.round((escalatedCount / totalOrdersForRate) * 100) : 0;

  // Average accept time — approximate from count (can't compute AVG of time diff in SQLite via Prisma)
  // For accurate avg, would need raw SQL: AVG((julianday(acceptedAt) - julianday(createdAt)) * 86400)
  const avgAcceptSec = 0; // Placeholder — real impl needs raw SQL

  // Sparkline: orders per hour (batch all 24 in parallel)
  const hourPromises = Array.from({ length: 24 }, (_, h) => {
    const hourStart = new Date(startOfDay);
    hourStart.setHours(h, 0, 0, 0);
    const hourEnd = new Date(startOfDay);
    hourEnd.setHours(h, 59, 59, 999);
    return db.order.count({ where: { ...where, createdAt: { gte: hourStart, lte: hourEnd } } });
  });
  const sparkOrders = await Promise.all(hourPromises);

  // Sparkline: revenue per day (batch all 7 in parallel)
  const revPromises = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - (6 - i));
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    return db.order.aggregate({
      where: { ...where, status: "delivered", createdAt: { gte: dayStart, lte: dayEnd } },
      _sum: { quoteAmount: true },
    }).then(a => a._sum.quoteAmount || 0);
  });
  const sparkRevenue = await Promise.all(revPromises);

  // Sparkline: escalation rate (batch all 7 days in parallel)
  const escPromises = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - (6 - i));
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    return Promise.all([
      db.order.count({ where: { ...where, createdAt: { gte: dayStart, lte: dayEnd } } }),
      db.order.count({ where: { ...where, createdAt: { gte: dayStart, lte: dayEnd }, OR: [{ status: "escalated" }, { status: "cancelled" }] } }),
    ]).then(([total, esc]) => total > 0 ? Math.round((esc / total) * 100) : 0);
  });
  const sparkEscalation = await Promise.all(escPromises);

  // Sparkline: avg accept time trend — use 0 (requires raw SQL for accurate calc)
  const sparkAccept = Array(7).fill(0);

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
