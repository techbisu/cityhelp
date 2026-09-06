/**
 * GET /api/health — health check endpoint
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    // Test DB connection
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        database: "ok",
      },
    }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        timestamp: new Date().toISOString(),
        services: { database: "error" },
      },
      { status: 503 }
    );
  }
}
