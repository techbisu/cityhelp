/**
 * POST /api/billing/mark-paid
 * Super admin manual override for cash clients.
 * Body: { invoiceId }
 * Marks the invoice as paid and activates the tenant's plan.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { invoiceId } = body;
  if (!invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return NextResponse.json({ error: "invoice not found" }, { status: 404 });

  if (invoice.status === "paid") {
    return NextResponse.json({ ok: true, message: "already_paid" });
  }

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "paid",
      paidAt: new Date(),
      paymentMethod: "cash",
    },
  });

  const plan = await db.plan.findFirst({ where: { name: invoice.planName } });
  if (plan) {
    await db.tenant.update({
      where: { id: invoice.tenantId },
      data: {
        planId: plan.id,
        status: "active",
        currentPeriodEnd: invoice.periodEnd,
        dunningStartedAt: null,
      },
    });
  }

  await db.auditLog.create({
    data: {
      tenantId: invoice.tenantId,
      actor: "superadmin",
      action: "mark_paid",
      entity: "invoice",
      entityId: invoice.id,
      detail: `Manually marked ${invoice.invoiceNumber} as paid (cash)`,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ ok: true });
}
