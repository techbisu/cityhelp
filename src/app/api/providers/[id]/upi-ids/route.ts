/**
 * GET /api/providers/[id]/upi-ids
 * Returns the provider's UPI IDs (JSON array).
 *
 * PATCH /api/providers/[id]/upi-ids
 * Body: { upiIds: [{ id, vpa, label, isDefault }] }
 * Saves the provider's UPI IDs.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParse } from "@/lib/utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const provider = await db.provider.findUnique({
    where: { id },
    select: { upiIds: true, name: true, tenantId: true },
  });
  if (!provider) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    upiIds: safeParse<Array<{ id: string; vpa: string; label: string; isDefault: boolean }>>(provider.upiIds, []),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { upiIds } = body;

  if (!Array.isArray(upiIds)) {
    return NextResponse.json({ error: "upiIds must be an array" }, { status: 400 });
  }

  // Validate each UPI ID
  for (const upi of upiIds) {
    if (!upi.vpa || !/^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+$/.test(upi.vpa)) {
      return NextResponse.json({ error: `Invalid UPI ID: ${upi.vpa}` }, { status: 400 });
    }
  }

  // Ensure at most one is default
  const defaults = upiIds.filter((u: { isDefault: boolean }) => u.isDefault);
  if (defaults.length > 1) {
    return NextResponse.json({ error: "Only one UPI ID can be default" }, { status: 400 });
  }

  const provider = await db.provider.update({
    where: { id },
    data: { upiIds: JSON.stringify(upiIds) },
  });

  return NextResponse.json({ ok: true, upiIds: safeParse(provider.upiIds, []) });
}
