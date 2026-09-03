/**
 * GET /api/providers/[id]/feedback
 * Returns the provider's feedback config (Google review URL, enabled flag).
 *
 * PATCH /api/providers/[id]/feedback
 * Body: { googleReviewUrl?, feedbackEnabled? }
 * Saves the provider's feedback settings.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const provider = await db.provider.findUnique({
    where: { id },
    select: { googleReviewUrl: true, feedbackEnabled: true, name: true },
  });
  if (!provider) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    googleReviewUrl: provider.googleReviewUrl,
    feedbackEnabled: provider.feedbackEnabled,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { googleReviewUrl, feedbackEnabled } = body;

  const update: Record<string, unknown> = {};
  if (googleReviewUrl !== undefined) {
    // Validate URL if provided
    if (googleReviewUrl && !/^https?:\/\//.test(googleReviewUrl)) {
      return NextResponse.json({ error: "Invalid URL — must start with http:// or https://" }, { status: 400 });
    }
    update.googleReviewUrl = googleReviewUrl || null;
  }
  if (typeof feedbackEnabled === "boolean") {
    update.feedbackEnabled = feedbackEnabled;
  }

  await db.provider.update({ where: { id }, data: update });
  return NextResponse.json({ ok: true });
}
