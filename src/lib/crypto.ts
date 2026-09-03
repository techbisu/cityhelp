/**
 * CityHelp — Crypto helpers for encrypting third-party API keys at rest.
 *
 * Uses AES-256-GCM with a master key from env (CITYHELP_MASTER_KEY).
 * If no master key is set, derives one from a fixed dev fallback (NOT for production).
 */
import crypto from "crypto";

const MASTER_KEY_ENV = process.env.CITYHELP_MASTER_KEY;
const DEV_FALLBACK = "cityhelp-dev-master-key-do-not-use-in-production-32b";

function getKey(): Buffer {
  const raw = MASTER_KEY_ENV && MASTER_KEY_ENV.length >= 32 ? MASTER_KEY_ENV : DEV_FALLBACK;
  if (process.env.NODE_ENV === "production" && raw === DEV_FALLBACK) {
    throw new Error("CITYHELP_MASTER_KEY must be set in production (min 32 chars). Run: openssl rand -base64 32");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export function maskKey(plain: string): string {
  if (!plain || plain.length < 4) return "••••";
  return "••••" + plain.slice(-4);
}

// PIN hashing (provider 4-digit PIN) — bcrypt would be heavier, use scrypt
export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(8).toString("hex");
  const hash = crypto.scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pin, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

// Password hashing (staff)
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}
