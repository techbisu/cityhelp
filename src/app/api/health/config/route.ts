/**
 * GET /api/health/config
 * Returns which optional services are configured (for the super admin health dashboard).
 * Does NOT expose any secrets — just boolean flags + counts.
 *
 * WhatsApp is now PER-TENANT — we report how many tenants have it configured.
 */
import { NextResponse } from "next/server";
import { isEmailConfigured } from "@/lib/email";
import { isPushConfigured } from "@/lib/push";
import { isBillingConfigured } from "@/lib/razorpay";
import { getConfiguredWaTenantCount } from "@/lib/whatsapp";

export async function GET() {
  const waTenantCount = await getConfiguredWaTenantCount();
  return NextResponse.json({
    whatsapp: waTenantCount > 0, // true if ANY tenant has it configured
    whatsappTenantCount: waTenantCount, // how many tenants
    sentry: !!process.env.SENTRY_DSN,
    email: isEmailConfigured(),
    push: isPushConfigured(),
    billing: isBillingConfigured(),
  });
}
