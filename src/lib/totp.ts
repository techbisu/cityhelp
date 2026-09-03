/**
 * CityHelp — 2FA (TOTP) using otplib
 * For super admin and tenant owners.
 *
 * otplib v13 uses named exports: { authenticator } from 'otplib'
 * If the authenticator export is missing, we use the TOTP class directly.
 */
import * as OTPAuth from "otplib";
import qrcode from "qrcode";
import * as crypto from "crypto";

// otplib v13 may export authenticator differently — try multiple approaches
let totpInstance: {
  generateSecret: () => string;
  keyuri: (email: string, issuer: string, secret: string) => string;
  verify: (opts: { token: string; secret: string }) => boolean;
  options: { step: number; window: number };
};

try {
  // v12 style: import { authenticator } from 'otplib'
  const mod = OTPAuth as unknown as { authenticator?: typeof totpInstance };
  if (mod.authenticator) {
    totpInstance = mod.authenticator;
  } else {
    throw new Error("authenticator not found");
  }
} catch {
  // Fallback: use a simple TOTP implementation
  totpInstance = {
    generateSecret: () => crypto.randomBytes(20).toString("base32"),
    keyuri: (email: string, issuer: string, secret: string) =>
      `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`,
    verify: ({ token, secret }: { token: string; secret: string }) => {
      // Simple TOTP verification using crypto
      const window = 1;
      const step = 30;
      const epoch = Math.floor(Date.now() / 1000);
      for (let i = -window; i <= window; i++) {
        const counter = Math.floor(epoch / step) + i;
        const expected = generateTOTP(secret, counter);
        if (token.trim() === expected) return true;
      }
      return false;
    },
    options: { step: 30, window: 1 },
  };
}

// Simple TOTP generator (RFC 6238) as fallback
function generateTOTP(secret: string, counter: number): string {
  const key = Buffer.from(secret, "base32");
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, "0");
}

const ISSUER = "CityHelp";

/** Generate a new TOTP secret (base32) */
export function generateSecret(): string {
  return totpInstance.generateSecret();
}

/** Build the otpauth:// URI for QR code enrollment */
export function buildOtpAuthUri(email: string, secret: string): string {
  return totpInstance.keyuri(email, ISSUER, secret);
}

/** Generate a QR code data URL for the otpauth URI */
export async function generateQrCodeDataUrl(email: string, secret: string): Promise<string> {
  const uri = buildOtpAuthUri(email, secret);
  return qrcode.toDataURL(uri, { width: 240, margin: 1 });
}

/** Verify a 6-digit TOTP token against a secret */
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return totpInstance.verify({ token: token.trim(), secret });
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
