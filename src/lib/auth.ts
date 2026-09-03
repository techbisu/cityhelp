/**
 * CityHelp — Route-level authorization helpers
 *
 * Usage at the top of any protected API route:
 *
 *   import { requireStaffSession } from "@/lib/auth";
 *
 *   export async function POST(req: NextRequest) {
 *     const auth = requireStaffSession(req);
 *     if (!auth.ok) return auth.response;
 *     const session = auth.session; // { staffId, tenantId, tenantSlug, email, role, permissions }
 *     // ... route logic, using session.tenantId instead of body.tenantSlug
 *   }
 *
 * For routes that need a specific role (e.g., owner-only for billing):
 *   const auth = requireStaffSession(req, { role: "owner" });
 *
 * For super-admin routes:
 *   const auth = requireSuperSession(req);
 */
import { NextResponse, type NextRequest } from "next/server";
import { getStaffSession, getProviderSession, getSuperSession, setSessionCookie, type StaffSession, type ProviderSession, type SuperSession } from "./session";

export type AuthResult<T> =
  | { ok: true; session: T }
  | { ok: false; response: NextResponse };

/** Require a staff session (tenant admin/staff). Optionally require a specific role. */
export function requireStaffSession(req: NextRequest, opts?: { role?: string; permission?: string }): AuthResult<StaffSession> {
  const session = getStaffSession(req);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (opts?.role && session.role !== opts.role && session.role !== "owner") {
    return { ok: false, response: NextResponse.json({ error: "forbidden", message: "Insufficient role" }, { status: 403 }) };
  }
  if (opts?.permission && session.permissions !== "full" && session.permissions !== opts.permission) {
    return { ok: false, response: NextResponse.json({ error: "forbidden", message: "Insufficient permissions" }, { status: 403 }) };
  }
  return { ok: true, session };
}

/** Require a provider session. */
export function requireProviderSession(req: NextRequest): AuthResult<ProviderSession> {
  const session = getProviderSession(req);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true, session };
}

/** Require a super-admin session. */
export function requireSuperSession(req: NextRequest): AuthResult<SuperSession> {
  const session = getSuperSession(req);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true, session };
}

/** Set session cookie on a NextResponse and return it */
export { setSessionCookie };

/** Require a staff session AND verify the tenant matches the resource's tenant */
export function requireTenantAccess(req: NextRequest, resourceTenantId: string): AuthResult<StaffSession> {
  const auth = requireStaffSession(req);
  if (!auth.ok) return auth;
  if (auth.session.tenantId !== resourceTenantId) {
    return { ok: false, response: NextResponse.json({ error: "forbidden", message: "Resource belongs to a different tenant" }, { status: 403 }) };
  }
  return auth;
}
