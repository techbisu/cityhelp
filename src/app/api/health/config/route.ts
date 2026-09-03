/**
 * GET /api/health/config
 * Returns which optional services are configured (for the super admin health dashboard).
 * Does NOT expose any secrets — just boolean flags.
 */
import { NextResponse } from "next/server";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { isEmailConfigured } from "@/lib/email";
import { isPushConfigured } from "@/lib/push";
import { isBillingConfigured } from "@/lib/razorpay";

export async function GET() {
  return NextResponse.json({
    whatsapp: isWhatsAppConfigured(),
    sentry: !!process.env.SENTRY_DSN,
    email: isEmailConfigured(),
    push: isPushConfigured(),
    billing: isBillingConfigured(),
  });
}
