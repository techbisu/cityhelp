/**
 * CityHelp — 2FA (TOTP) using otplib
 * For super admin and tenant owners.
 */
import { authenticator } from "otplib";
import qrcode from "qrcode";
import * as crypto from "crypto";

authenticator.options = {
  step: 30,
  window: 1, // allow 1 step before/after for clock skew
};

const ISSUER = "CityHelp";

/** Generate a new TOTP secret (base32) */
export function generateSecret(): string {
  return authenticator.generateSecret();
}

/** Build the otpauth:// URI for QR code enrollment */
export function buildOtpAuthUri(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

/** Generate a QR code data URL for the otpauth URI */
export async function generateQrCodeDataUrl(email: string, secret: string): Promise<string> {
  const uri = buildOtpAuthUri(email, secret);
  return qrcode.toDataURL(uri, { width: 240, margin: 1 });
}

/** Verify a 6-digit TOTP token against a secret */
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: token.trim(), secret });
  } catch {
    return false;
  }
}

/** Generate backup codes (8 codes, 8 chars each) */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const buf = crypto.randomBytes(4);
    const hex = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
    codes.push(hex);
  }
  return codes;
}
