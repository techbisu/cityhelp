/**
 * GET /api/plans — list all plans (public, cached)
 * POST /api/plans — create plan (super admin only)
 * PATCH /api/plans — update plan (super admin only)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperSession } from "@/lib/session";

export async function GET() {
  const plans = await db.plan.findMany({
    orderBy: { priceMonthly: "asc" },
    include: { _count: { select: { tenants: true } } },
  });
  return NextResponse.json(
    { plans },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}

export async function POST(req: NextRequest) {
  const auth = getSuperSession(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, priceMonthly, limitCities, limitOrders, limitWhatsApp, limitSeats, featureWorkflow, featureEmail, featureApi, featureCustomDomain } = body;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const plan = await db.plan.create({
    data: {
      name,
      priceMonthly: priceMonthly || 0,
      limitCities: limitCities ?? 1,
      limitOrders: limitOrders ?? 100,
      limitWhatsApp: limitWhatsApp ?? 1,
      limitSeats: limitSeats ?? 2,
      featureWorkflow: !!featureWorkflow,
      featureEmail: !!featureEmail,
      featureApi: !!featureApi,
      featureCustomDomain: !!featureCustomDomain,
    },
  });
  return NextResponse.json({ plan });
}

export async function PATCH(req: NextRequest) {
  const auth = getSuperSession(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) clean[k] = v;
  }
  const plan = await db.plan.update({ where: { id }, data: clean });
  return NextResponse.json({ plan });
}
