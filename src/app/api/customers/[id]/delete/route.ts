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
import { getStaffSession } from "@/lib/session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Auth: require staff session
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Tenant isolation via session
  if (customer.tenantId !== staffSession.tenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
      actor: `staff:${staffSession.staffId}`,
      action: "delete",
      entity: "customer",
      entityId: id,
      detail: `Anonymized customer PII (original phone hash: ${phoneHash})`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ ok: true, message: "Customer PII anonymized. Orders retained for accounting." });
}
