/**
 * GET /api/push/vapid — returns the VAPID public key for client-side subscription.
 */
import { NextResponse } from "next/server";
import { isPushConfigured, getVapidPublicKey } from "@/lib/push";

export async function GET() {
  if (!isPushConfigured()) {
    return NextResponse.json({ configured: false });
  }
  return NextResponse.json({ configured: true, publicKey: getVapidPublicKey() });
}
