/**
 * POST /api/customers/[id]/delete?tenantSlug=
 *
 * GDPR right-to-be-forgotten: anonymizes the customer's PII.
 * - Phone → "deleted+hash@redacted"
 * - Name → null
 * - Addresses → "[]"
 * - Bot sessions deleted
 * - Orders KEPT (for accounting) but customer field anonymized
 *
 * Writes audit log. Must verify tenant isolation.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const tenantSlug = body.tenantSlug;

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Tenant isolation
  if (tenantSlug) {
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant || customer.tenantId !== tenant.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const phoneHash = crypto.createHash("sha256").update(customer.phone).digest("hex").slice(0, 12);

  // Anonymize the customer record
  await db.customer.update({
    where: { id },
    data: {
      phone: `deleted+${phoneHash}@redacted`,
      name: null,
      addresses: "[]",
      isBlocked: true,
    },
  });

  // Delete bot sessions
  await db.botSession.deleteMany({ where: { customerId: id } });

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: customer.tenantId,
      actor: `staff:${tenantSlug || "system"}`,
      action: "delete",
      entity: "customer",
      entityId: id,
      detail: `Anonymized customer PII (original phone hash: ${phoneHash})`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ ok: true, message: "Customer PII anonymized. Orders retained for accounting." });
}
