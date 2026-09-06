/**
 * CityHelp — Bot engine (shared function)
 *
 * Extracted from /api/bot/send/route.ts so the WhatsApp webhook can call it
 * directly without an internal HTTP fetch (which doubles cold-start latency
 * and consumes extra serverless function invocations on Vercel).
 *
 * Also used by the /api/bot/send route (which is called by the BotApp simulator).
 */
import { db } from "./db";
import { safeParse, reverseGeocodeStub } from "./utils";
import { rateLimit, sweepIfNeeded } from "./rate-limit";
import { createOrderWithRetry } from "./order-code";
import {
  agreeToCharges,
  declineCharges,
  submitReview,
  acceptQuote,
  declineQuote,
} from "./order-actions";
import { broadcastNewOrder } from "./realtime";
import { notifyProvidersOfNewJob } from "./push";
import { maybeSendUsageWarning } from "./plan";

export interface BotReply {
  kind: "text" | "buttons" | "list";
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  listTitle?: string;
  listButton?: string;
}

export interface BotResult {
  replies: BotReply[];
  session: { state: string };
  order?: unknown;
  error?: string;
}

interface BotPayload {
  tenantSlug: string;
  phone: string;
  message?: string;
  button?: string;
  location?: { lat: number; lng: number };
  mediaType?: "voice" | "image";
  mediaUrl?: string;
  mediaId?: string;
}

// ── Deadline helper ──
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("deadline_exceeded")), ms)
    ),
  ]);
}

/**
 * Process a bot message. Called by:
 *   1. /api/bot/send route (from BotApp simulator)
 *   2. /api/whatsapp/webhook (directly, no HTTP fetch)
 *
 * Returns replies + session state.
 */
export async function handleBotMessage(payload: BotPayload): Promise<BotResult> {
  const { tenantSlug, phone, message, button, location, mediaType, mediaUrl, mediaId } = payload;

  if (!tenantSlug || !phone) {
    return { replies: [], session: { state: "error" }, error: "tenantSlug and phone required" };
  }

  // Rate limit
  sweepIfNeeded();
  const rlPhone = rateLimit(`bot:${tenantSlug}:${phone}`, { max: 30, windowMs: 60 * 1000 });
  if (!rlPhone.ok) return { replies: [{ kind: "text", text: "⏳ Too many messages. Please wait a minute." }], session: { state: "rate_limited" } };
  const rlTenant = rateLimit(`bot-tenant:${tenantSlug}`, { max: 200, windowMs: 60 * 60 * 1000 });
  if (!rlTenant.ok) return { replies: [{ kind: "text", text: "⏳ Service busy. Please try again shortly." }], session: { state: "rate_limited" } };

  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    include: {
      services: { where: { isActive: true } },
      cities: { where: { isActive: true } },
    },
  });
  if (!tenant) return { replies: [], session: { state: "error" }, error: "tenant not found" };

  // Find or create customer
  let customer = await db.customer.findUnique({
    where: { tenantId_phone: { tenantId: tenant.id, phone } },
  });
  if (!customer) {
    customer = await db.customer.create({
      data: { tenantId: tenant.id, phone, language: "en" },
    });
  }

  // Find or create session
  let session = await db.botSession.findUnique({
    where: { tenantId_phone: { tenantId: tenant.id, phone } },
  });
  if (!session) {
    session = await db.botSession.create({
      data: { tenantId: tenant.id, customerId: customer.id, phone },
    });
  }

  const lang = (customer.language as "en" | "hi") || "en";
  const replies: BotReply[] = [];

  // ── Handle charges agree/cancel ──
  if (button && button.startsWith("charges_agree_")) {
    const orderId = button.slice("charges_agree_".length);
    try { await agreeToCharges(orderId, tenant.id); } catch { /* */ }
    replies.push({ kind: "text", text: "✅ Charges agreed. The provider will send a payment link shortly." });
    return { replies, session: { state: session.state } };
  }
  if (button && button.startsWith("charges_cancel_")) {
    const orderId = button.slice("charges_cancel_".length);
    try { await declineCharges(orderId, tenant.id); } catch { /* */ }
    replies.push({ kind: "text", text: "❌ Order cancelled. Type *menu* to start a new order." });
    return { replies, session: { state: session.state } };
  }

  // ── Handle rating buttons ──
  if (button && button.startsWith("rate_")) {
    const match = button.match(/^rate_(\d+)_(.+)$/);
    if (match) {
      const rating = parseInt(match[1], 10);
      const orderId = match[2];
      try {
        const result = await submitReview(orderId, tenant.id, rating);
        if (result.ok) {
          replies.push({ kind: "text", text: `🙏 Thank you for your ${rating}★ rating!${result.googleReviewUrl ? "\n\nWe've also sent you a link to review us on Google!" : ""}` });
        } else if (result.error === "already_submitted") {
          replies.push({ kind: "text", text: "You've already rated this order. Thank you! 🙏" });
        } else {
          replies.push({ kind: "text", text: "Thanks for your feedback! 🙏" });
        }
      } catch { replies.push({ kind: "text", text: "Thanks for your feedback! 🙏" }); }
      return { replies, session: { state: session.state } };
    }
  }

  // ── Handle quote accept/decline ──
  if (button && button.startsWith("quote_accept_")) {
    const orderId = button.slice("quote_accept_".length);
    try {
      const result = await acceptQuote(orderId, tenant.id);
      replies.push({ kind: "text", text: result.ok ? "✅ Quote accepted! Your order is confirmed." : "This quote is no longer valid." });
    } catch { replies.push({ kind: "text", text: "Something went wrong." }); }
    return { replies, session: { state: session.state } };
  }
  if (button && button.startsWith("quote_decline_")) {
    const orderId = button.slice("quote_decline_".length);
    try { await declineQuote(orderId, tenant.id); } catch { /* */ }
    replies.push({ kind: "text", text: "❌ Quote declined. Type *menu* to start a new order." });
    return { replies, session: { state: session.state } };
  }

  // ── Handle "cancel" / "menu" ──
  const text = (message || "").trim().toLowerCase();
  if (text === "cancel" || text === "❌ cancel" || text === "cancel order") {
    await db.botSession.update({
      where: { id: session.id },
      data: { state: "menu", draftService: null, draftItems: "[]", draftTiming: null, draftShop: null, draftAddress: null, draftLat: null, draftLng: null },
    });
    replies.push({ kind: "text", text: "❌ Order cancelled. Type *menu* to start again." });
    const menuRows = buildMenuList(tenant.services, lang);
    replies.push({ kind: "list", text: t(tenant, lang, "menu_title"), listTitle: t(tenant, lang, "menu_title"), listButton: t(tenant, lang, "menu_button"), sections: [{ title: "Services", rows: menuRows }] });
    return { replies, session: { state: "menu" } };
  }

  if (text === "menu" || text === "start" || text === "hi" || text === "hello") {
    await db.botSession.update({
      where: { id: session.id },
      data: { state: "menu", draftService: null, draftItems: "[]", draftTiming: null, draftShop: null, draftAddress: null, draftLat: null, draftLng: null },
    });
    const menuRows = buildMenuList(tenant.services, lang);
    replies.push({ kind: "list", text: t(tenant, lang, "menu_title"), listTitle: t(tenant, lang, "menu_title"), listButton: t(tenant, lang, "menu_button"), sections: [{ title: "Services", rows: menuRows }] });
    return { replies, session: { state: "menu" } };
  }

  // ── State machine (simplified for extraction — delegates to the main flow) ──
  // For the full state machine, the /api/bot/send route still has the complete logic.
  // This function handles the webhook path which mostly processes button taps and text.
  // The route handler will be updated to call this function.
  //
  // For now, return a placeholder that tells the webhook to fall back to the route.
  return { replies: [], session: { state: session.state }, error: "needs_full_handler" };
}

// ── Translation ──
function t(tenant: { waBusinessName: string | null }, lang: "en" | "hi", key: string, vars?: Record<string, string>): string {
  const name = tenant.waBusinessName || "CityHelp";
  const en: Record<string, string> = {
    menu_title: "What would you like today?",
    menu_button: "📋 View Menu",
  };
  const hi: Record<string, string> = {
    menu_title: "आज क्या चाहिए?",
    menu_button: "📋 मेनू देखें",
  };
  const dict = lang === "hi" ? hi : en;
  let s = dict[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

// ── Menu builder ──
function buildMenuList(services: Array<{ id: string; key: string; kind: string; icon: string; labels: string }>, lang: "en" | "hi") {
  const order = ["cake", "grocery", "chicken", "parcel", "ride", "repair", "team", "custom"];
  return services
    .filter((s) => s.kind !== "custom" || s.key === "custom")
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    .map((s) => {
      const labels = safeParse<Record<string, string>>(s.labels, {});
      return {
        id: `svc_${s.id}`,
        title: `${s.icon} ${labels[lang] || labels.en || s.key}`,
        description: s.kind === "order" ? "Order now" : s.kind === "book" ? "Book a slot" : s.kind === "team" ? "Talk to us" : "Tell us what you need",
      };
    });
}
