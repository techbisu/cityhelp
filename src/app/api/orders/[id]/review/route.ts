/**
 * POST /api/orders/[id]/review
 *
 * Customer submits a rating + optional comment after delivery.
 * Also returns the provider's Google Business review URL (if configured).
 *
 * Body: { rating (1-5), comment?, tenantSlug }
 *
 * GET /api/orders/[id]/review
 * Returns the existing review (if any) + the provider's Google review URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      review: true,
      acceptedBy: { select: { googleReviewUrl: true, feedbackEnabled: true, name: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  return NextResponse.json({
    review: order.review,
    googleReviewUrl: order.acceptedBy?.googleReviewUrl || null,
    feedbackEnabled: order.acceptedBy?.feedbackEnabled ?? true,
    providerName: order.acceptedBy?.name,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { rating, comment, tenantSlug } = body;

  if (!rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be 1-5" }, { status: 400 });
  }

  const order = await db.order.findUnique({
    where: { id },
    include: { customer: true, tenant: true, acceptedBy: true },
  });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (order.status !== "delivered") {
    return NextResponse.json({ error: "order not delivered yet" }, { status: 400 });
  }

  // Tenant isolation
  if (tenantSlug) {
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant || order.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Check if review already exists (one per order)
  const existing = await db.review.findUnique({ where: { orderId: id } });
  if (existing) {
    return NextResponse.json({ error: "review_already_submitted", review: existing }, { status: 409 });
  }

  if (!order.acceptedById) {
    return NextResponse.json({ error: "no provider assigned" }, { status: 400 });
  }

  // Create review
  const review = await db.review.create({
    data: {
      tenantId: order.tenantId,
      orderId: id,
      providerId: order.acceptedById,
      customerId: order.customerId,
      rating,
      comment: comment || null,
    },
  });

  // Update provider's average rating
  const allReviews = await db.review.findMany({
    where: { providerId: order.acceptedById },
    select: { rating: true },
  });
  const avgRating = allReviews.length > 0
    ? allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length
    : 5.0;
  await db.provider.update({
    where: { id: order.acceptedById },
    data: { rating: Math.round(avgRating * 10) / 10 },
  });

  // Activity log
  await db.activity.create({
    data: {
      tenantId: order.tenantId,
      orderId: id,
      providerId: order.acceptedById,
      actor: "customer",
      action: "review_submitted",
      detail: `${rating}★${comment ? ` — "${comment.slice(0, 80)}"` : ""}`,
    },
  });

  // If provider has a Google review URL, send it to the customer
  let googleReviewUrl = order.acceptedBy?.googleReviewUrl;
  if (googleReviewUrl) {
    const message = `🙏 Thank you for your ${rating}★ rating!\n\nIf you have a moment, please also leave a review on Google — it helps us a lot:\n${googleReviewUrl}`;
    await sendWhatsAppText(order.tenantId, order.customer.phone, message);
  }

  return NextResponse.json({
    ok: true,
    review,
    googleReviewUrl,
    newProviderRating: avgRating,
  });
}

/**
 * PATCH /api/orders/[id]/review — mark that customer clicked the Google review link
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { tenantSlug } = body;

  const order = await db.order.findUnique({
    where: { id },
    include: { review: true },
  });
  if (!order || !order.review) {
    return NextResponse.json({ error: "no review found" }, { status: 404 });
  }

  if (tenantSlug) {
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant || order.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.review.update({
    where: { orderId: id },
    data: { googleReviewClicked: true },
  });

  return NextResponse.json({ ok: true });
}
