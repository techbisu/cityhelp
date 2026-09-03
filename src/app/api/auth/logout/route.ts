/**
 * POST /api/auth/logout
 * Clears all session cookies.
 */
import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  // Clear all three cookie types
  clearSessionCookie(res, "staff");
  clearSessionCookie(res, "provider");
  clearSessionCookie(res, "superadmin");
  return res;
}
