/**
 * GET /api — service info
 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    name: "CityHelp API",
    version: "1.0.0",
    description: "Multi-tenant WhatsApp ordering & booking platform",
    health: "/api/health",
    docs: "/api/health",
  });
}
