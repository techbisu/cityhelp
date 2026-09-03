/**
 * GET /api/customers/[id]/export?tenantSlug=
 *
 * Exports all PII for a customer as JSON (full GDPR-style data portability).
 * Writes an audit log entry. Must verify tenant isolation.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParse } from "@/lib/utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      orders: {
        select: {
          code: true, status: true, kind: true, items: true, description: true,
          timing: true, addressText: true, addressArea: true,
          quoteAmount: true, source: true, createdAt: true, deliveredAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Tenant isolation
  if (tenantSlug) {
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant || customer.tenantId !== tenant.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: customer.tenantId,
      actor: `staff:${tenantSlug || "system"}`,
      action: "export",
      entity: "customer",
      entityId: id,
      detail: `Exported PII for customer ${customer.phone}`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  const exportData = {
    exportedAt: new Date().toISOString(),
    customer: {
      phone: customer.phone,
      name: customer.name,
      language: customer.language,
      addresses: safeParse(customer.addresses, []),
      totalOrders: customer.totalOrders,
      lifetimeValue: customer.lifetimeValue,
      createdAt: customer.createdAt,
    },
    orders: customer.orders.map((o) => ({
      ...o,
      items: safeParse(o.items, []),
      quoteAmount: o.quoteAmount ? o.quoteAmount / 100 : null,
    })),
  };

  return NextResponse.json(exportData, {
    headers: {
      "Content-Disposition": `attachment; filename="customer-${customer.phone}-export.json"`,
    },
  });
}
