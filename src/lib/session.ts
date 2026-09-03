/**
 * CityHelp — session management (signed httpOnly cookies)
 *
 * Three session kinds:
 *   - staff:     tenant-scoped staff/admin
 *   - provider:  provider (mobile PWA)
 *   - superadmin: platform owner
 *
 * Tokens are HMAC-signed JSON (no external JWT lib needed).
 * Stored in httpOnly, SameSite=Lax, Secure-when-https cookies.
 */
import crypto from "crypto";

const SESSION_SECRET_RAW = process.env.CITYHELP_SESSION_SECRET || "cityhelp-dev-session-secret-change-in-prod";

if (process.env.NODE_ENV === "production" && !process.env.CITYHELP_SESSION_SECRET) {
  throw new Error("CITYHELP_SESSION_SECRET must be set in production (min 32 chars). Run: openssl rand -base64 32");
}

const SESSION_SECRET = SESSION_SECRET_RAW;
const COOKIE_STAFF = "ch_staff";
const COOKIE_PROVIDER = "ch_provider";
const COOKIE_SUPER = "ch_super";
const MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days

export interface StaffSession {
  kind: "staff";
  staffId: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  role: string;
  permissions: string;
}

export interface ProviderSession {
  kind: "provider";
  providerId: string;
  tenantId: string;
  tenantSlug: string;
  phone: string;
}

export interface SuperSession {
  kind: "superadmin";
  superAdminId: string;
  email: string;
  twoFactorVerified: boolean;
}

export type Session = StaffSession | ProviderSession | SuperSession;

function sign(payload: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

function encode(session: Session): string {
  const payload = JSON.stringify(session);
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

function decode(token: string): Session | null {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const expected = sign(b64);
  // timingSafeEqual throws on length mismatch — guard with try/catch
  try {
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    return JSON.parse(json) as Session;
  } catch {
    return null;
  }
}

/** Set a session cookie in the response */
export function setSessionCookie(res: Response, session: Session): void {
  const token = encode(session);
  const name =
    session.kind === "staff" ? COOKIE_STAFF :
    session.kind === "provider" ? COOKIE_PROVIDER :
    COOKIE_SUPER;
  const isHttps = process.env.NODE_ENV === "production";
  res.headers.append(
    "Set-Cookie",
    `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${isHttps ? "; Secure" : ""}`
  );
}

/** Clear a session cookie */
export function clearSessionCookie(res: Response, kind: Session["kind"]): void {
  const name =
    kind === "staff" ? COOKIE_STAFF :
    kind === "provider" ? COOKIE_PROVIDER :
    COOKIE_SUPER;
  res.headers.append(
    "Set-Cookie",
    `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

/** Parse cookies from a request */
function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie") || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = v.join("=");
  }
  return out;
}

/** Get the current session from the request */
export function getSession(req: Request): Session | null {
  const cookies = parseCookies(req);
  // Try each cookie in priority order
  for (const name of [COOKIE_SUPER, COOKIE_STAFF, COOKIE_PROVIDER]) {
    const token = cookies[name];
    if (token) {
      const session = decode(token);
      if (session) return session;
    }
  }
  return null;
}

/** Get a specific kind of session */
export function getStaffSession(req: Request): StaffSession | null {
  const s = getSession(req);
  return s && s.kind === "staff" ? s : null;
}

export function getProviderSession(req: Request): ProviderSession | null {
  const s = getSession(req);
  return s && s.kind === "provider" ? s : null;
}

export function getSuperSession(req: Request): SuperSession | null {
  const s = getSession(req);
  return s && s.kind === "superadmin" ? s : null;
}
