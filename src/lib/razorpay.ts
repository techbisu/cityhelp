/**
 * CityHelp — Razorpay billing integration
 *
 * Phase 2 per spec: "Razorpay subscription checkout with verified webhooks,
 * invoices, dunning (7 days past due → auto-downgrade to Free, data preserved),
 * manual 'mark as paid' for cash clients."
 *
 * Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 *
 * Endpoints:
 *   POST /api/billing/checkout  — create Razorpay order for plan upgrade
 *   POST /api/billing/webhook   — verified webhook (payment.captured, subscription.*)
 *   GET  /api/billing/invoices?tenantSlug=  — list invoices
 *   POST /api/billing/mark-paid  — super admin manual override (cash clients)
 */
import crypto from "crypto";

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

export function isBillingConfigured(): boolean {
  return !!(KEY_ID && KEY_SECRET);
}

export function getRazorpayKeyId(): string {
  return KEY_ID;
}

/**
 * Verify Razorpay webhook signature.
 * signature = HMAC_SHA256(webhook_secret, `${razorpay_order_id}|${razorpay_payment_id}|${razorpay_signature}`)
 * For subscription: HMAC_SHA256(webhook_secret, raw_body)
 */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

/**
 * Verify payment signature (client-side returned).
 */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!KEY_SECRET) return false;
  const expected = crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

/**
 * Create a Razorpay order for a one-time plan payment.
 */
export async function createRazorpayOrder(amount: number, currency: string = "INR", receipt: string, notes: Record<string, string> = {}): Promise<{ id: string; amount: number; currency: string } | { error: string }> {
  if (!isBillingConfigured()) return { error: "billing_not_configured" };
  try {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount, // paise
        currency,
        receipt,
        notes,
        payment_capture: 1,
      }),
    });
    const data = await res.json();
    if (!res.ok) return { error: JSON.stringify(data) };
    return { id: data.id, amount: data.amount, currency: data.currency };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "unknown" };
  }
}
