/**
 * GET /api/tenants/[id]/branding
 * Returns the tenant's branding settings (logo, colors, custom domain).
 *
 * PATCH /api/tenants/[id]/branding
 * Body: { logoUrl?, accentColor?, customDomain? }
 * Updates branding. Custom domain requires Pro plan + DNS verification.
 *
 * Auth: requires staff session with owner role.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSession } from "@/lib/session";
import { invalidateDomainCache } from "@/lib/custom-domain";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      accentColor: true,
      logoUrl: true,
      customDomain: true,
      customDomainVerified: true,
      plan: { select: { featureCustomDomain: true, name: true } },
    },
  });

  if (!tenant) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (tenant.id !== staffSession.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({ branding: tenant });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (staffSession.role !== "owner" && staffSession.role !== "admin") {
    return NextResponse.json({ error: "forbidden", message: "Only owners/admins can change branding" }, { status: 403 });
  }

  const tenant = await db.tenant.findUnique({
    where: { id },
    select: { id: true, plan: { select: { featureCustomDomain: true } } },
  });
  if (!tenant) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (tenant.id !== staffSession.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { logoUrl, accentColor, customDomain } = body;

  const update: Record<string, unknown> = {};

  // Logo URL — any tenant can set
  if (logoUrl !== undefined) {
    if (logoUrl && !/^https?:\/\//.test(logoUrl)) {
      return NextResponse.json({ error: "Logo URL must start with http:// or https://" }, { status: 400 });
    }
    update.logoUrl = logoUrl || null;
  }

  // Accent color — any tenant can set
  if (accentColor !== undefined) {
    if (accentColor && !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      return NextResponse.json({ error: "Accent color must be a valid hex color (e.g., #10b981)" }, { status: 400 });
    }
    update.accentColor = accentColor || "#10b981";
  }

  // Custom domain — Pro plan only
  if (customDomain !== undefined) {
    if (!tenant.plan.featureCustomDomain) {
      return NextResponse.json({
        error: "plan_limit",
        message: "Custom domain requires the Pro plan. Upgrade to use your own domain.",
      }, { status: 403 });
    }

    if (customDomain) {
      // Validate domain format
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(customDomain)) {
        return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
      }

      // Check if another tenant already uses this domain
      const existing = await db.tenant.findFirst({
        where: { customDomain, NOT: { id } },
      });
      if (existing) {
        return NextResponse.json({ error: "This domain is already used by another account" }, { status: 400 });
      }

      update.customDomain = customDomain;
      update.customDomainVerified = false; // requires DNS verification
    } else {
      update.customDomain = null;
      update.customDomainVerified = false;
    }
  }

  const updated = await db.tenant.update({ where: { id }, data: update });
  invalidateDomainCache();

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId: id,
      actor: `staff:${staffSession.staffId}`,
      action: "branding_change",
      entity: "tenant",
      entityId: id,
      detail: JSON.stringify(update),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
    },
  });

  return NextResponse.json({ tenant: updated });
}
