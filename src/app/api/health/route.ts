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
    });
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
