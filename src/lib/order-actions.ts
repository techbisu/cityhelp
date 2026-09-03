/**
 * CityHelp — Shared order action functions
 *
 * These functions are called directly by the bot engine (instead of internal HTTP fetch)
 * to avoid cold-start latency on Vercel serverless.
 *
 * The bot state machine calls these when a customer taps a button (charges_agree,
 * charges_cancel, rate_N_, quote_accept, quote_decline).
 */
import { db } from "./db";
import { sendWhatsAppText, sendWhatsAppButtons } from "./whatsapp";

/**
 * Customer agrees to charges (called when they tap "✅ Agree" on WhatsApp).
 * Sets chargesConfirmed = true on the order.
 */
export async function agreeToCharges(orderId: string, tenantId: string): Promise<void> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { acceptedBy: true } });
  if (!order || order.tenantId !== tenantId) return;

  await db.order.update({
    where: { id: orderId },
    data: { chargesConfirmed: true },
  });
  await db.activity.create({
    data: {
      tenantId: order.tenantId, orderId,
      actor: "customer",
      action: "charges_agreed",
      detail: `Customer agreed to charges (total ₹${(order.totalAmount || 0) / 100})`,
    },
  });

  // Notify the provider via realtime
  try {
    const { broadcastToTenant } = await import("./realtime");
    await broadcastToTenant(order.tenantId, "charges_agreed", { orderId, code: order.code });
  } catch { /* WS service may be down */ }
}

/**
 * Customer declines charges (called when they tap "❌ Cancel" on WhatsApp).
 * Cancels the order.
 */
export async function declineCharges(orderId: string, tenantId: string): Promise<void> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.tenantId !== tenantId) return;

  await db.order.update({
    where: { id: orderId },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: "Customer declined charges",
    },
  });
  await db.activity.create({
    data: {
      tenantId: order.tenantId, orderId,
      actor: "customer",
      action: "charges_declined",
      detail: "Customer declined charges — order cancelled",
    },
  });
}

/**
 * Customer submits a rating for a delivered order.
 * Creates a Review, updates the provider's average rating, sends Google review link.
 */
export async function submitReview(
  orderId: string,
  tenantId: string,
  rating: number,
  comment?: string
): Promise<{ ok: boolean; googleReviewUrl?: string; error?: string }> {
  if (rating < 1 || rating > 5) return { ok: false, error: "invalid_rating" };

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { customer: true, acceptedBy: true },
  });
  if (!order || order.tenantId !== tenantId) return { ok: false, error: "not_found" };
  if (order.status !== "delivered") return { ok: false, error: "not_delivered" };
  if (!order.acceptedById) return { ok: false, error: "no_provider" };

  // Check if review already exists
  const existing = await db.review.findUnique({ where: { orderId } });
  if (existing) return { ok: false, error: "already_submitted" };

  // Create review
  const review = await db.review.create({
    data: {
      tenantId: order.tenantId,
      orderId,
      providerId: order.acceptedById,
      customerId: order.customerId,
      rating,
      comment: comment || null,
    },
  });

  // Update provider's average rating
  const allReviews = await db.review.findMany({
    where: { providerId: order.acceptedById, tenantId: order.tenantId },
    select: { rating: true },
  });
  const avgRating = allReviews.length > 0
    ? allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length
    : 5.0;
  await db.provider.update({
    where: { id: order.acceptedById },
    data: { rating: Math.round(avgRating * 10) / 10 },
  });

  await db.activity.create({
    data: {
      tenantId: order.tenantId, orderId,
      providerId: order.acceptedById,
      actor: "customer",
      action: "review_submitted",
      detail: `${rating}★${comment ? ` — "${comment.slice(0, 80)}"` : ""}`,
    },
  });

  // Send Google review link if provider has one
  const googleReviewUrl = order.acceptedBy?.googleReviewUrl;
  if (googleReviewUrl) {
    const message = `🙏 Thank you for your ${rating}★ rating!\n\nIf you have a moment, please also leave a review on Google — it helps us a lot:\n${googleReviewUrl}`;
    await sendWhatsAppText(order.tenantId, order.customer.phone, message);
  }

  return { ok: true, googleReviewUrl };
}

/**
 * Customer accepts a quote (called when they tap "✅ Accept" on WhatsApp).
 * Transitions the order to "accepted" with the quoting provider.
 */
export async function acceptQuote(orderId: string, tenantId: string): Promise<{ ok: boolean; error?: string }> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.tenantId !== tenantId) return { ok: false, error: "not_found" };
  if (order.status !== "quoted") return { ok: false, error: "not_quoted" };
  if (!order.acceptedById) return { ok: false, error: "no_provider" };

  await db.order.update({
    where: { id: orderId },
    data: {
      status: "accepted",
      acceptedAt: new Date(),
      quoteStatus: "accepted",
    },
  });
  await db.activity.create({
    data: {
      tenantId, orderId,
      providerId: order.acceptedById,
      actor: "customer",
      action: "quote_accepted",
      detail: `Customer accepted quote of ₹${(order.quoteAmount || 0) / 100}`,
    },
  });

  // Notify customer
  await sendWhatsAppText(tenantId, order.customerId, `✅ Quote accepted! Your order is now confirmed. The provider will reach out shortly.`);

  return { ok: true };
}

/**
 * Customer declines a quote (called when they tap "❌ Decline" on WhatsApp).
 */
export async function declineQuote(orderId: string, tenantId: string): Promise<{ ok: boolean; error?: string }> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.tenantId !== tenantId) return { ok: false, error: "not_found" };
  if (order.status !== "quoted") return { ok: false, error: "not_quoted" };

  await db.order.update({
    where: { id: orderId },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: "Customer declined quote",
      quoteStatus: "declined",
    },
  });
  await db.activity.create({
    data: {
      tenantId, orderId,
      actor: "customer",
      action: "quote_declined",
      detail: `Customer declined quote of ₹${(order.quoteAmount || 0) / 100}`,
    },
  });

  return { ok: true };
}
