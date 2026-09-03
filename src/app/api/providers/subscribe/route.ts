/**
 * POST /api/providers/subscribe
 * Body: { providerId, subscription }
 *
 * Saves the web-push PushSubscription JSON to the provider row.
 * Used by the provider PWA after Notification.requestPermission() succeeds.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { providerId, subscription } = body;
  if (!providerId || !subscription) {
    return NextResponse.json({ error: "providerId and subscription required" }, { status: 400 });
  }
  const provider = await db.provider.findUnique({ where: { id: providerId }, select: { id: true, tenantId: true } });
  if (!provider) return NextResponse.json({ error: "provider not found" }, { status: 404 });

  await db.provider.update({
    where: { id: providerId },
    data: { pushSubscription: JSON.stringify(subscription) },
  });
  return NextResponse.json({ ok: true });
}
