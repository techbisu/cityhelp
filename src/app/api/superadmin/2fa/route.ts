/**
 * POST /api/superadmin/2fa
 * Body: { action: "enroll" | "verify" | "disable", superAdminId, token?, secret? }
 *
 * enroll: generates a new TOTP secret + QR code data URL
 * verify: confirms the 6-digit token and enables 2FA
 * disable: turns off 2FA (requires current token)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSecret, generateQrCodeDataUrl, verifyTotp } from "@/lib/totp";
import { encrypt } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, superAdminId, token } = body;

  const sa = await db.superAdmin.findUnique({ where: { id: superAdminId } });
  if (!sa) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "enroll") {
    const secret = generateSecret();
    const qrDataUrl = await generateQrCodeDataUrl(sa.email, secret);
    // Store the secret encrypted but NOT yet enabled
    await db.superAdmin.update({
      where: { id: superAdminId },
      data: { twoFactorSecret: encrypt(secret) },
    });
    return NextResponse.json({ secret, qrDataUrl });
  }

  if (action === "verify") {
    if (!sa.twoFactorSecret) return NextResponse.json({ error: "not enrolled" }, { status: 400 });
    const { decrypt } = await import("@/lib/crypto");
    const secret = decrypt(sa.twoFactorSecret);
    if (!verifyTotp(token || "", secret)) {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    await db.superAdmin.update({
      where: { id: superAdminId },
      data: { twoFactorEnabled: true },
    });
    await db.auditLog.create({
      data: {
        actor: `superadmin:${superAdminId}`,
        action: "2fa_enabled",
        entity: "superadmin",
        entityId: superAdminId,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "disable") {
    if (sa.twoFactorEnabled && sa.twoFactorSecret) {
      const { decrypt } = await import("@/lib/crypto");
      const secret = decrypt(sa.twoFactorSecret);
      if (!verifyTotp(token || "", secret)) {
        return NextResponse.json({ error: "invalid_token" }, { status: 401 });
      }
    }
    await db.superAdmin.update({
      where: { id: superAdminId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    await db.auditLog.create({
      data: {
        actor: `superadmin:${superAdminId}`,
        action: "2fa_disabled",
        entity: "superadmin",
        entityId: superAdminId,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null,
      },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
