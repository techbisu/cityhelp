/**
 * POST /api/whatsapp/test
 * Body: { tenantSlug }
 *
 * Tests the tenant's WhatsApp connection by calling the Graph API
 * with their stored access token.
 */
import { NextRequest, NextResponse } from "next/server";
import { testTenantWaConnection } from "@/lib/whatsapp";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug } = body;
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  const result = await testTenantWaConnection(
    // We need the tenant ID — look it up via the slug
    await (async () => {
      const { db } = await import("@/lib/db");
      const t = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
      return t?.id || "";
    })()
  );

  if (result.ok) {
    return NextResponse.json({ ok: true, message: "Connection verified — your WhatsApp number is ready." });
  }
  return NextResponse.json({ ok: false, error: result.error || "Connection failed" }, { status: 400 });
}
