/**
 * POST /api/bot/send
 * Body: { tenantSlug, phone, message?: text, button?: id, location?: {lat,lng}, mediaType?: "voice"|"image" }
 *
 * Returns: { replies: BotReply[], session: {...}, order?: {...} }
 *
 * BotReply = { kind: "text" | "buttons" | "list", text, buttons?, sections? }
 *
 * State machine: language → menu → service_draft → address → confirm → done
 * Resilient: "cancel"/"menu" anywhere → back to menu. Old button taps → re-show current step.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParse, reverseGeocodeStub } from "@/lib/utils";
import { rateLimitOr429, getClientIp } from "@/lib/rate-limit";

interface BotReply {
  kind: "text" | "buttons" | "list";
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  listTitle?: string;
  listButton?: string;
}

const LANGUAGES: Array<{ code: string; label: string; flag: string }> = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function t(tenant: { waBusinessName: string | null }, lang: "en" | "hi", key: string, vars?: Record<string, string>): string {
  const name = tenant.waBusinessName || "CityHelp";
  const en: Record<string, string> = {
    welcome: `Welcome to *${name}*! 👋\nChoose your language:`,
    menu_title: "What would you like today?",
    menu_button: "📋 View Menu",
    ask_cake: "🎂 What cake would you like?\n_Flavor, weight, message_",
    ask_grocery: "🛒 Send your grocery list — type below, send a voice note, or photo of a handwritten list.",
    ask_grocery_summary: "Here's your list so far:",
    ask_grocery_add_more: "Send more items, or tap Done.",
    ask_chicken: "🍗 What would you like?\n_E.g. 1kg chicken curry cut, 500g mutton_",
    ask_parcel: "📦 What's the parcel?\n_Contents, pickup point, drop point_",
    ask_ride: "🚗 Where to?\n_Pickup & drop, e.g. Andheri station to Bandra_",
    ask_repair: "🧰 What needs repair?\n_E.g. LG AC not cooling, model GL-S0524_",
    ask_team: "👥 Connecting you to our team. Please describe briefly what you need.",
    ask_custom: "Please describe what you need — we'll get back with a quote.",
    ask_shop: "Any preferred shop? (optional)",
    ask_timing: "When do you need it?",
    ask_timing_book: "Pick a time slot:",
    ask_address: "📍 Share your address — send a WhatsApp location pin OR type it with landmark.",
    ask_address_confirm: "Is *{area}* correct?",
    confirm_title: "📋 *Order Summary*",
    confirm_ask: "Confirm your order?",
    placed: "✅ Order placed! Code *#{code}*\nOur partner will call you in ~10 minutes.",
    cancelled: "❌ Order cancelled. Type *menu* to start again.",
    back_to_menu: "↩️ Back to main menu.",
    nudge: "You have an unfinished order. Continue?",
    invalid: "Sorry, I didn't understand that. Tap a button below 👇",
    old_button: "That was from an older message. Here's your current step 👇",
    voice_received: "🎙️ Voice note received. Processing…",
    photo_received: "📸 Photo received. Reading the list…",
    voice_failed: "Couldn't process your voice note. Please type your list, or our team will help.",
    photo_failed: "Couldn't read the photo. Please type your list, or our team will help.",
    grocery_done: "Great! Your list is locked in.",
    ask_more: "Anything else to add? Send more items or tap Done.",
  };
  const hi: Record<string, string> = {
    welcome: `${name} में आपका स्वागत है! 👋\nअपनी भाषा चुनें:`,
    menu_title: "आज क्या चाहिए?",
    menu_button: "📋 मेनू देखें",
    ask_cake: "🎂 आपको कौन सा केक चाहिए?\n_स्वाद, वजन, संदेश_",
    ask_grocery: "🛒 अपनी किराने की लिस्ट भेजें — टाइप करें, वॉइस नोट, या फोटो।",
    ask_grocery_summary: "आपकी लिस्ट अब तक:",
    ask_grocery_add_more: "और आइटम भेजें, या हो गया दबाएं।",
    ask_chicken: "🍗 क्या चाहिए?\n_जैसे 1kg चिकन करी कट, 500g मटन_",
    ask_parcel: "📦 पार्सल क्या है?\n_सामग्री, पिकअप, ड्रॉप_",
    ask_ride: "🚗 कहाँ जाना है?\n_पिकअप और ड्रॉप_",
    ask_repair: "🧰 क्या रिपेयर करना है?\n_जैसे LG एसी ठंडा नहीं कर रहा_",
    ask_team: "👥 हमारी टीम से जोड़ रहे हैं। बताइए क्या ज़रूरत है।",
    ask_custom: "बताइए क्या चाहिए — हम कोटेशन देंगे।",
    ask_shop: "कोई पसंदीदा दुकान? (वैकल्पिक)",
    ask_timing: "कब चाहिए?",
    ask_timing_book: "टाइम स्लॉट चुनें:",
    ask_address: "📍 पता भेजें — लोकेशन पिन भेजें या टाइप करें।",
    ask_address_confirm: "क्या *{area}* सही है?",
    confirm_title: "📋 *ऑर्डर सारांश*",
    confirm_ask: "ऑर्डर कन्फर्म करें?",
    placed: "✅ ऑर्डर हो गया! कोड *#{code}*\nहमारा पार्टनर ~10 मिनट में कॉल करेगा।",
    cancelled: "❌ ऑर्डर रद्द। *मेनू* टाइप करें।",
    back_to_menu: "↩️ मुख्य मेनू।",
    nudge: "आपका ऑर्डर अधूरा है। जारी रखें?",
    invalid: "समझ नहीं आया। नीचे बटन दबाएं 👇",
    old_button: "वह पुराना था। यह रहा अभी का स्टेप 👇",
    voice_received: "🎙️ वॉइस नोट मिला। प्रोसेस हो रहा है…",
    photo_received: "📸 फोटो मिली। लिस्ट पढ़ रहे हैं…",
    voice_failed: "वॉइस प्रोसेस नहीं हो सकी। कृपया टाइप करें।",
    photo_failed: "फोटो पढ़ी नहीं जा सकी। कृपया टाइप करें।",
    grocery_done: "बढ़िया! लिस्ट हो गई।",
    ask_more: "और कुछ? आइटम भेजें या हो गया दबाएं।",
  };
  const dict = lang === "hi" ? hi : en;
  let s = dict[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

/** Merge grocery items by normalized name — sums quantities for duplicates (H9 fix) */
function mergeItems(existing: Array<{ name: string; qty?: string | number }>, newItems: Array<{ name: string; qty?: string | number }>): Array<{ name: string; qty?: string | number }> {
  const map = new Map<string, { name: string; qty?: string | number }>();
  for (const it of [...existing, ...newItems]) {
    const key = it.name.toLowerCase().trim();
    const existingEntry = map.get(key);
    if (existingEntry) {
      // Try to sum quantities if both are numeric
      const existingQty = parseFloat(String(existingEntry.qty || "0"));
      const newQty = parseFloat(String(it.qty || "0"));
      if (!isNaN(existingQty) && !isNaN(newQty)) {
        existingEntry.qty = existingQty + newQty;
      } else {
        // Can't sum — keep the newer one
        existingEntry.qty = it.qty || existingEntry.qty;
      }
    } else {
      map.set(key, { ...it });
    }
  }
  return Array.from(map.values());
}

function buildMenuList(tenantId: string, services: Array<{ id: string; key: string; kind: string; icon: string; labels: string }>, lang: "en" | "hi") {
  const rows = services
    .filter((s) => s.kind !== "custom" || s.key === "custom")
    .sort((a, b) => {
      const order = ["cake", "grocery", "chicken", "parcel", "ride", "repair", "team", "custom"];
      return order.indexOf(a.key) - order.indexOf(b.key);
    })
    .map((s) => {
      const labels = safeParse<Record<string, string>>(s.labels, {});
      return {
        id: `svc_${s.id}`,
        title: `${s.icon} ${labels[lang] || labels.en || s.key}`,
        description: s.kind === "order" ? "Order now" : s.kind === "book" ? "Book a slot" : s.kind === "team" ? "Talk to us" : "Tell us what you need",
      };
    });
  return rows;
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantSlug, phone, message, button, location, mediaType } = body as {
    tenantSlug: string;
    phone: string;
    message?: string;
    button?: string;
    location?: { lat: number; lng: number };
    mediaType?: "voice" | "image";
  };

  // Rate limit: 30 messages per phone per minute, 100 per tenant per hour
  const ip = getClientIp(req);
  const rlPhone = rateLimitOr429(req, `bot:${tenantSlug}:${phone}`, { max: 30, windowMs: 60 * 1000 });
  if (rlPhone) return rlPhone;
  const rlTenant = rateLimitOr429(req, `bot-tenant:${tenantSlug}`, { max: 200, windowMs: 60 * 60 * 1000 });
  if (rlTenant) return rlTenant;

  if (!tenantSlug || !phone) {
    return NextResponse.json({ error: "tenantSlug and phone required" }, { status: 400 });
  }

  // Try Redis cache first, fall back to DB
  let tenant: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const { getTenantWithServices } = await import("@/lib/cache");
    const cached = await getTenantWithServices(tenantSlug);
    if (cached) {
      const fullTenant = await db.tenant.findUnique({ where: { id: cached.id }, select: { id: true, name: true, slug: true, waBusinessName: true, waConfigured: true, accentColor: true, upiId: true, upiName: true } });
      if (fullTenant) {
        tenant = { ...fullTenant, services: cached.services, cities: cached.cities };
      }
    }
  } catch { /* cache miss — fall through to DB */ }

  if (!tenant) {
    tenant = await db.tenant.findUnique({
      where: { slug: tenantSlug },
      include: {
        services: { where: { isActive: true } },
        cities: { where: { isActive: true } },
      },
    });
  }
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

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

  // ── Handle charges agree/cancel buttons (sent by provider via /charges) ──
  if (button && button.startsWith("charges_agree_")) {
    const orderId = button.slice("charges_agree_".length);
    try {
      const { agreeToCharges } = await import("@/lib/order-actions");
      await agreeToCharges(orderId, tenant.id);
      replies.push({ kind: "text", text: "✅ Charges agreed. The provider will send a payment link shortly." });
    } catch {
      replies.push({ kind: "text", text: "Something went wrong. Please try again." });
    }
    return NextResponse.json({ replies, session: { state: session.state } });
  }
  if (button && button.startsWith("charges_cancel_")) {
    const orderId = button.slice("charges_cancel_".length);
    try {
      const { declineCharges } = await import("@/lib/order-actions");
      await declineCharges(orderId, tenant.id);
      replies.push({ kind: "text", text: "❌ Order cancelled. Type *menu* to start a new order." });
    } catch {
      replies.push({ kind: "text", text: "Something went wrong." });
    }
    return NextResponse.json({ replies, session: { state: session.state } });
  }

  // ── Handle rating buttons (rate_5_<orderId>, rate_4_, rate_3_) ──
  if (button && button.startsWith("rate_")) {
    const match = button.match(/^rate_(\d+)_(.+)$/);
    if (match) {
      const rating = parseInt(match[1], 10);
      const orderId = match[2];
      try {
        const { submitReview } = await import("@/lib/order-actions");
        const result = await submitReview(orderId, tenant.id, rating);
        if (result.ok) {
          replies.push({ kind: "text", text: `🙏 Thank you for your ${rating}★ rating!${result.googleReviewUrl ? "\n\nWe've also sent you a link to review us on Google — it really helps!" : ""}` });
        } else if (result.error === "already_submitted") {
          replies.push({ kind: "text", text: "You've already rated this order. Thank you! 🙏" });
        } else {
          replies.push({ kind: "text", text: "Thanks for your feedback! 🙏" });
        }
      } catch {
        replies.push({ kind: "text", text: "Thanks for your feedback! 🙏" });
      }
      return NextResponse.json({ replies, session: { state: session.state } });
    }
  }

  // ── Handle quote accept/decline buttons ──
  if (button && button.startsWith("quote_accept_")) {
    const orderId = button.slice("quote_accept_".length);
    try {
      const { acceptQuote } = await import("@/lib/order-actions");
      const result = await acceptQuote(orderId, tenant.id);
      if (result.ok) {
        replies.push({ kind: "text", text: "✅ Quote accepted! Your order is confirmed. The provider will reach out shortly." });
      } else {
        replies.push({ kind: "text", text: "This quote is no longer valid. Type *menu* to start a new order." });
      }
    } catch {
      replies.push({ kind: "text", text: "Something went wrong." });
    }
    return NextResponse.json({ replies, session: { state: session.state } });
  }
  if (button && button.startsWith("quote_decline_")) {
    const orderId = button.slice("quote_decline_".length);
    try {
      const { declineQuote } = await import("@/lib/order-actions");
      await declineQuote(orderId, tenant.id);
      replies.push({ kind: "text", text: "❌ Quote declined. Type *menu* to start a new order." });
    } catch {
      replies.push({ kind: "text", text: "Something went wrong." });
    }
    return NextResponse.json({ replies, session: { state: session.state } });
  }

  // ── Handle "cancel" / "menu" anywhere ────────────────────
  const text = (message || "").trim().toLowerCase();
  if (text === "cancel" || text === "❌ cancel" || text === "cancel order") {
    // Reset draft
    await db.botSession.update({
      where: { id: session.id },
      data: {
        state: "menu",
        draftService: null,
        draftItems: "[]",
        draftTiming: null,
        draftShop: null,
        draftAddress: null,
        draftLat: null,
        draftLng: null,
      },
    });
    replies.push({ kind: "text", text: t(tenant, lang, "cancelled") });
    // Show menu
    const menuRows = buildMenuList(tenant.id, tenant.services, lang);
    replies.push({
      kind: "list",
      text: t(tenant, lang, "menu_title"),
      listTitle: t(tenant, lang, "menu_title"),
      listButton: t(tenant, lang, "menu_button"),
      sections: [{ title: "Services", rows: menuRows }],
    });
    return NextResponse.json({ replies, session: { state: "menu" } });
  }

  if (text === "menu" || text === "start" || text === "hi" || text === "hello") {
    // Reset ALL draft fields (H10 fix — was only resetting draftService + draftItems)
    await db.botSession.update({
      where: { id: session.id },
      data: {
        state: "menu",
        draftService: null,
        draftItems: "[]",
        draftTiming: null,
        draftShop: null,
        draftAddress: null,
        draftLat: null,
        draftLng: null,
      },
    });
    const menuRows = buildMenuList(tenant.id, tenant.services, lang);
    replies.push({
      kind: "list",
      text: t(tenant, lang, "menu_title"),
      listTitle: t(tenant, lang, "menu_title"),
      listButton: t(tenant, lang, "menu_button"),
      sections: [{ title: "Services", rows: menuRows }],
    });
    return NextResponse.json({ replies, session: { state: "menu" } });
  }

  // ── State machine ────────────────────────────────────────
  switch (session.state) {
    case "language": {
      if (button === "lang_en") {
        await db.customer.update({ where: { id: customer.id }, data: { language: "en" } });
        const menuRows = buildMenuList(tenant.id, tenant.services, "en");
        await db.botSession.update({ where: { id: session.id }, data: { state: "menu" } });
        replies.push({
          kind: "list",
          text: t(tenant, "en", "menu_title"),
          listTitle: t(tenant, "en", "menu_title"),
          listButton: t(tenant, "en", "menu_button"),
          sections: [{ title: "Services", rows: menuRows }],
        });
      } else if (button === "lang_hi") {
        await db.customer.update({ where: { id: customer.id }, data: { language: "hi" } });
        const menuRows = buildMenuList(tenant.id, tenant.services, "hi");
        await db.botSession.update({ where: { id: session.id }, data: { state: "menu" } });
        replies.push({
          kind: "list",
          text: t(tenant, "hi", "menu_title"),
          listTitle: t(tenant, "hi", "menu_title"),
          listButton: t(tenant, "hi", "menu_button"),
          sections: [{ title: "Services", rows: menuRows }],
        });
      } else {
        replies.push({
          kind: "buttons",
          text: t(tenant, lang, "welcome"),
          buttons: [
            { id: "lang_en", label: "🇬🇧 English" },
            { id: "lang_hi", label: "🇮🇳 हिन्दी" },
          ],
        });
      }
      break;
    }

    case "menu": {
      // Handle list item tap: svc_<id>
      if (button && button.startsWith("svc_")) {
        const svcId = button.slice(4);
        const svc = tenant.services.find((s) => s.id === svcId);
        if (!svc) {
          replies.push({ kind: "text", text: t(tenant, lang, "invalid") });
          break;
        }
        await db.botSession.update({
          where: { id: session.id },
          data: { state: "service_draft", draftService: svc.id, draftItems: "[]", draftShop: null, draftTiming: null },
        });
        // Service-specific first message
        if (svc.key === "grocery") {
          replies.push({ kind: "buttons", text: t(tenant, lang, "ask_grocery"), buttons: [
            { id: "grocery_done", label: "✅ Done" },
            { id: "grocery_more", label: "➕ Add more" },
            { id: "cancel", label: "❌ Start over" },
          ]});
        } else if (svc.kind === "order") {
          replies.push({ kind: "text", text: t(tenant, lang, `ask_${svc.key}`) });
        } else if (svc.kind === "book") {
          replies.push({ kind: "text", text: t(tenant, lang, `ask_${svc.key}`) });
        } else if (svc.kind === "team") {
          replies.push({ kind: "text", text: t(tenant, lang, "ask_team") });
          // Mark as custom
          await db.botSession.update({
            where: { id: session.id },
            data: { state: "service_draft", draftService: svc.id },
          });
        } else if (svc.kind === "custom") {
          replies.push({ kind: "text", text: t(tenant, lang, "ask_custom") });
        }
      } else {
        // Re-show menu
        const menuRows = buildMenuList(tenant.id, tenant.services, lang);
        replies.push({
          kind: "list",
          text: t(tenant, lang, "old_button") + "\n" + t(tenant, lang, "menu_title"),
          listTitle: t(tenant, lang, "menu_title"),
          listButton: t(tenant, lang, "menu_button"),
          sections: [{ title: "Services", rows: menuRows }],
        });
      }
      break;
    }

    case "service_draft": {
      const svcId = session.draftService;
      if (!svcId) {
        // Reset
        await db.botSession.update({ where: { id: session.id }, data: { state: "menu" } });
        replies.push({ kind: "text", text: t(tenant, lang, "back_to_menu") });
        break;
      }
      const svc = tenant.services.find((s) => s.id === svcId);
      if (!svc) {
        await db.botSession.update({ where: { id: session.id }, data: { state: "menu", draftService: null } });
        replies.push({ kind: "text", text: t(tenant, lang, "back_to_menu") });
        break;
      }

      // ── Grocery: accumulate items until Done ──────────
      if (svc.key === "grocery") {
        if (button === "grocery_done") {
          const items = safeParse<{ name: string; qty?: string | number }[]>(session.draftItems, []);
          if (items.length === 0) {
            replies.push({ kind: "text", text: "Your list is empty. Add items first." });
            break;
          }
          replies.push({ kind: "text", text: t(tenant, lang, "grocery_done") });
          // Move to shop question
          await db.botSession.update({
            where: { id: session.id },
            data: { state: "shop" },
          });
          replies.push({
            kind: "buttons",
            text: t(tenant, lang, "ask_shop"),
            buttons: [
              { id: "shop_any", label: "🏪 Any shop" },
              { id: "shop_specify", label: "✏️ Specify" },
            ],
          });
          break;
        }
        if (button === "grocery_more" || message || mediaType) {
          const items = safeParse<{ name: string; qty?: string | number }[]>(session.draftItems, []);
          // ── Voice note: transcribe via AI, then extract items ──
          if (mediaType === "voice") {
            replies.push({ kind: "text", text: t(tenant, lang, "voice_received") });
            // Try AI transcription + extraction
            const { runAiTask, runPlatformAiFallback } = await import("@/lib/ai");
            let transcribedText = "";
            const voiceResult = await runAiTask<string>(tenant.id, "transcribe_voice", { audioUrl: body.audioUrl });
            if (voiceResult.ok && voiceResult.data) {
              transcribedText = voiceResult.data;
            } else {
              // Try platform fallback
              const fallback = await runPlatformAiFallback<string>("transcribe_voice", { text: message || "" });
              if (fallback.ok && fallback.data) transcribedText = fallback.data;
            }
            if (!transcribedText) {
              // Graceful degrade → save as custom order
              replies.push({ kind: "text", text: t(tenant, lang, "voice_failed") });
              // Save raw voice as custom order
              const lastOrder = await db.order.findFirst({ where: { tenantId: tenant.id }, orderBy: { code: "desc" } });
              const code = lastOrder ? String(parseInt(lastOrder.code, 10) + 1) : "1001";
              await db.order.create({
                data: {
                  tenantId: tenant.id,
                  cityId: tenant.cities[0]?.id || "",
                  customerId: customer.id,
                  code,
                  status: "new",
                  kind: "custom",
                  description: `[voice note — transcription failed]`,
                  timing: "ASAP",
                  source: "bot",
                  activity: { create: [{ tenantId: tenant.id, actor: "bot", action: "created", detail: "Voice note — AI transcription failed, saved for human" }] },
                },
              });
              break;
            }
            // Extract items from the transcription
            const extractResult = await runAiTask<Array<{ name: string; qty?: string | number }>>(tenant.id, "extract_grocery", { text: transcribedText });
            const newItems = extractResult.ok && extractResult.data && Array.isArray(extractResult.data) ? extractResult.data : [];
            if (newItems.length === 0) {
              replies.push({ kind: "text", text: `Transcribed: "${transcribedText}". Couldn't extract items — please type your list.` });
              break;
            }
            const merged = mergeItems(items, newItems);
            await db.botSession.update({ where: { id: session.id }, data: { draftItems: JSON.stringify(merged) } });
            const summary = merged.map((it, i) => `${i + 1}. ${it.name}${it.qty ? ` ×${it.qty}` : ""}`).join("\n");
            replies.push({ kind: "buttons", text: `${t(tenant, lang, "ask_grocery_summary")}\n\n${summary}`, buttons: [
              { id: "grocery_done", label: "✅ Done" },
              { id: "grocery_more", label: "➕ Add more" },
              { id: "cancel", label: "❌ Start over" },
            ]});
            break;
          }
          // ── Photo: OCR via AI, then extract items ──
          if (mediaType === "image") {
            replies.push({ kind: "text", text: t(tenant, lang, "photo_received") });
            const { runAiTask, runPlatformAiFallback } = await import("@/lib/ai");
            const photoResult = await runAiTask<Array<{ name: string; qty?: string | number }>>(tenant.id, "read_photo", { imageUrl: body.mediaUrl || "" });
            const newItems = photoResult.ok && photoResult.data && Array.isArray(photoResult.data) ? photoResult.data : [];
            if (newItems.length === 0) {
              // Try platform fallback
              const fallback = await runPlatformAiFallback<Array<{ name: string; qty?: string | number }>>("read_photo", { text: message || "" });
              if (fallback.ok && Array.isArray(fallback.data)) {
                newItems.push(...fallback.data);
              }
            }
            if (newItems.length === 0) {
              replies.push({ kind: "text", text: t(tenant, lang, "photo_failed") });
              break;
            }
            const merged = mergeItems(items, newItems);
            await db.botSession.update({ where: { id: session.id }, data: { draftItems: JSON.stringify(merged) } });
            const summary = merged.map((it, i) => `${i + 1}. ${it.name}${it.qty ? ` ×${it.qty}` : ""}`).join("\n");
            replies.push({ kind: "buttons", text: `${t(tenant, lang, "ask_grocery_summary")}\n\n${summary}`, buttons: [
              { id: "grocery_done", label: "✅ Done" },
              { id: "grocery_more", label: "➕ Add more" },
              { id: "cancel", label: "❌ Start over" },
            ]});
            break;
          }
          // ── Typed items: try AI extraction first, fall back to regex ──
          if (message) {
            // Try AI extraction for lenient parsing
            const { runAiTask } = await import("@/lib/ai");
            const aiResult = await runAiTask<Array<{ name: string; qty?: string | number }>>(tenant.id, "extract_grocery", { text: message });
            let newItems: Array<{ name: string; qty?: string | number }> = [];
            if (aiResult.ok && aiResult.data && Array.isArray(aiResult.data) && aiResult.data.length > 0) {
              newItems = aiResult.data;
            } else {
              // Fallback: simple regex parsing
              const lines = message.split(/\n|,|;/).map((l) => l.trim()).filter(Boolean);
              newItems = lines.map((l) => {
                const m = l.match(/^(\d+\.?\d*)\s*(?:x|×|kg|g|l|ltr|pcs|piece|pkt|pack)?\s*(.*)/i);
                if (m && m[2]) return { name: m[2], qty: m[1] };
                return { name: l, qty: 1 };
              });
            }
            const merged = mergeItems(items, newItems);
            await db.botSession.update({
              where: { id: session.id },
              data: { draftItems: JSON.stringify(merged) },
            });
            const summary = merged.map((it, i) => `${i + 1}. ${it.name}${it.qty ? ` ×${it.qty}` : ""}`).join("\n");
            replies.push({ kind: "buttons", text: `${t(tenant, lang, "ask_grocery_summary")}\n\n${summary}`, buttons: [
              { id: "grocery_done", label: "✅ Done" },
              { id: "grocery_more", label: "➕ Add more" },
              { id: "cancel", label: "❌ Start over" },
            ]});
          }
          break;
        }
      }

      // ── Other services: capture description/timing ─────
      if (button === "grocery_done") {
        // edge case
        await db.botSession.update({ where: { id: session.id }, data: { state: "shop" } });
        replies.push({
          kind: "buttons",
          text: t(tenant, lang, "ask_shop"),
          buttons: [
            { id: "shop_any", label: "🏪 Any shop" },
            { id: "shop_specify", label: "✏️ Specify" },
          ],
        });
        break;
      }

      // For order/book services, capture the message as items/description
      if (message) {
        await db.botSession.update({
          where: { id: session.id },
          data: {
            draftItems: JSON.stringify([{ name: message, qty: 1 }]),
            state: "shop",
          },
        });
        if (svc.kind === "order") {
          replies.push({
            kind: "buttons",
            text: t(tenant, lang, "ask_shop"),
            buttons: [
              { id: "shop_any", label: "🏪 Any shop" },
              { id: "shop_specify", label: "✏️ Specify" },
            ],
          });
        } else {
          // Book → ask timing directly
          await db.botSession.update({ where: { id: session.id }, data: { state: "timing" } });
          replies.push({
            kind: "buttons",
            text: t(tenant, lang, "ask_timing_book"),
            buttons: [
              { id: "slot_today_2_4", label: "Today 2–4pm" },
              { id: "slot_today_4_6", label: "Today 4–6pm" },
              { id: "slot_tmr_morn", label: "Tomorrow morning" },
              { id: "slot_custom", label: "✏️ Type own" },
            ],
          });
        }
      } else if (svc.kind === "team" || svc.kind === "custom") {
        // Wait for message
        if (!message) {
          replies.push({ kind: "text", text: t(tenant, lang, "invalid") });
        }
      } else {
        replies.push({ kind: "text", text: t(tenant, lang, "invalid") });
      }
      break;
    }

    case "shop": {
      if (button === "shop_any") {
        await db.botSession.update({
          where: { id: session.id },
          data: { draftShop: null, state: "timing" },
        });
        replies.push({
          kind: "buttons",
          text: t(tenant, lang, "ask_timing"),
          buttons: [
            { id: "slot_asap", label: "⚡ ASAP" },
            { id: "slot_today_eve", label: "🌆 Today evening" },
            { id: "slot_tmr", label: "📅 Tomorrow" },
            { id: "slot_custom", label: "✏️ Type own" },
          ],
        });
      } else if (button === "shop_specify") {
        replies.push({ kind: "text", text: "Type the shop name:" });
        // Stay in shop state, wait for text
        await db.botSession.update({ where: { id: session.id }, data: { state: "shop_text" } });
      } else {
        replies.push({ kind: "text", text: t(tenant, lang, "invalid") });
      }
      break;
    }

    case "shop_text": {
      if (message) {
        await db.botSession.update({
          where: { id: session.id },
          data: { draftShop: message, state: "timing" },
        });
        replies.push({
          kind: "buttons",
          text: t(tenant, lang, "ask_timing"),
          buttons: [
            { id: "slot_asap", label: "⚡ ASAP" },
            { id: "slot_today_eve", label: "🌆 Today evening" },
            { id: "slot_tmr", label: "📅 Tomorrow" },
            { id: "slot_custom", label: "✏️ Type own" },
          ],
        });
      }
      break;
    }

    case "timing": {
      const slotMap: Record<string, string> = {
        slot_asap: "ASAP",
        slot_today_eve: "Today evening",
        slot_tmr: "Tomorrow morning",
        slot_today_2_4: "Today 2–4pm",
        slot_today_4_6: "Today 4–6pm",
        slot_tmr_morn: "Tomorrow morning",
      };
      if (button && slotMap[button]) {
        await db.botSession.update({
          where: { id: session.id },
          data: { draftTiming: slotMap[button], state: "address" },
        });
        // Offer saved addresses
        const addresses = safeParse<Array<{ label: string; text: string; area?: string; lat?: number; lng?: number }>>(customer.addresses, []);
        const buttons = addresses.map((a, i) => ({ id: `addr_${i}`, label: `🏠 ${a.label}` }));
        buttons.push({ id: "addr_new", label: "✏️ New address" });
        replies.push({
          kind: "buttons",
          text: t(tenant, lang, "ask_address"),
          buttons,
        });
      } else if (button === "slot_custom") {
        replies.push({ kind: "text", text: "Type your preferred time:" });
        await db.botSession.update({ where: { id: session.id }, data: { state: "timing_text" } });
      } else if (message) {
        // Free text timing
        await db.botSession.update({
          where: { id: session.id },
          data: { draftTiming: message, state: "address" },
        });
        const addresses = safeParse<Array<{ label: string; text: string; area?: string; lat?: number; lng?: number }>>(customer.addresses, []);
        const buttons = addresses.map((a, i) => ({ id: `addr_${i}`, label: `🏠 ${a.label}` }));
        buttons.push({ id: "addr_new", label: "✏️ New address" });
        replies.push({
          kind: "buttons",
          text: t(tenant, lang, "ask_address"),
          buttons,
        });
      } else {
        replies.push({ kind: "text", text: t(tenant, lang, "invalid") });
      }
      break;
    }

    case "timing_text": {
      if (message) {
        await db.botSession.update({
          where: { id: session.id },
          data: { draftTiming: message, state: "address" },
        });
        const addresses = safeParse<Array<{ label: string; text: string; area?: string; lat?: number; lng?: number }>>(customer.addresses, []);
        const buttons = addresses.map((a, i) => ({ id: `addr_${i}`, label: `🏠 ${a.label}` }));
        buttons.push({ id: "addr_new", label: "✏️ New address" });
        replies.push({
          kind: "buttons",
          text: t(tenant, lang, "ask_address"),
          buttons,
        });
      }
      break;
    }

    case "address": {
      const addresses = safeParse<Array<{ label: string; text: string; area?: string; lat?: number; lng?: number }>>(customer.addresses, []);
      // Saved address tap
      if (button && button.startsWith("addr_") && button !== "addr_new") {
        const idx = parseInt(button.slice(5), 10);
        const addr = addresses[idx];
        if (addr) {
          await db.botSession.update({
            where: { id: session.id },
            data: {
              draftAddress: addr.text,
              draftLat: addr.lat || null,
              draftLng: addr.lng || null,
              state: "confirm",
            },
          });
          // Show confirmation summary
          const items = safeParse<{ name: string; qty?: string | number }[]>(session.draftItems, []);
          const svc = tenant.services.find((s) => s.id === session.draftService);
          const summary = buildOrderSummary(svc, items, session.draftShop, session.draftTiming, addr.text || null, addr.area || null, lang);
          replies.push({
            kind: "buttons",
            text: `${t(tenant, lang, "confirm_title")}\n\n${summary}\n\n${t(tenant, lang, "confirm_ask")}`,
            buttons: [
              { id: "confirm_yes", label: "✅ Confirm" },
              { id: "confirm_change", label: "✏️ Change" },
              { id: "cancel", label: "❌ Cancel" },
            ],
          });
          break;
        }
      }
      if (button === "addr_new") {
        replies.push({ kind: "text", text: t(tenant, lang, "ask_address") });
        await db.botSession.update({ where: { id: session.id }, data: { state: "address_new" } });
        break;
      }
      // Location pin received
      if (location && location.lat && location.lng) {
        const area = reverseGeocodeStub(location.lat, location.lng);
        await db.botSession.update({
          where: { id: session.id },
          data: {
            draftAddress: `${area} (pin shared)`,
            draftLat: location.lat,
            draftLng: location.lng,
            state: "address_confirm",
          },
        });
        replies.push({
          kind: "buttons",
          text: t(tenant, lang, "ask_address_confirm", { area }) || `Is *${area}* correct?`,
          buttons: [
            { id: "addr_correct", label: "✅ Correct" },
            { id: "addr_type", label: "✏️ Type instead" },
          ],
        });
        break;
      }
      // Typed address
      if (message) {
        await db.botSession.update({
          where: { id: session.id },
          data: { draftAddress: message, state: "confirm" },
        });
        const items = safeParse<{ name: string; qty?: string | number }[]>(session.draftItems, []);
        const svc = tenant.services.find((s) => s.id === session.draftService);
        const summary = buildOrderSummary(svc, items, session.draftShop, session.draftTiming, message, null, lang);
        replies.push({
          kind: "buttons",
          text: `${t(tenant, lang, "confirm_title")}\n\n${summary}\n\n${t(tenant, lang, "confirm_ask")}`,
          buttons: [
            { id: "confirm_yes", label: "✅ Confirm" },
            { id: "confirm_change", label: "✏️ Change" },
            { id: "cancel", label: "❌ Cancel" },
          ],
        });
        break;
      }
      replies.push({ kind: "text", text: t(tenant, lang, "invalid") });
      break;
    }

    case "address_new": {
      if (location && location.lat && location.lng) {
        const area = reverseGeocodeStub(location.lat, location.lng);
        await db.botSession.update({
          where: { id: session.id },
          data: {
            draftAddress: `${area} (pin shared)`,
            draftLat: location.lat,
            draftLng: location.lng,
            state: "address_confirm",
          },
        });
        replies.push({
          kind: "buttons",
          text: `Is *${area}* correct?`,
          buttons: [
            { id: "addr_correct", label: "✅ Correct" },
            { id: "addr_type", label: "✏️ Type instead" },
          ],
        });
        break;
      }
      if (message) {
        await db.botSession.update({
          where: { id: session.id },
          data: { draftAddress: message, state: "confirm" },
        });
        const items = safeParse<{ name: string; qty?: string | number }[]>(session.draftItems, []);
        const svc = tenant.services.find((s) => s.id === session.draftService);
        const summary = buildOrderSummary(svc, items, session.draftShop, session.draftTiming, message, null, lang);
        replies.push({
          kind: "buttons",
          text: `${t(tenant, lang, "confirm_title")}\n\n${summary}\n\n${t(tenant, lang, "confirm_ask")}`,
          buttons: [
            { id: "confirm_yes", label: "✅ Confirm" },
            { id: "confirm_change", label: "✏️ Change" },
            { id: "cancel", label: "❌ Cancel" },
          ],
        });
        break;
      }
      replies.push({ kind: "text", text: t(tenant, lang, "ask_address") });
      break;
    }

    case "address_confirm": {
      if (button === "addr_correct") {
        // Save address to customer
        const addresses = safeParse<Array<{ label: string; text: string; area?: string; lat?: number; lng?: number }>>(customer.addresses, []);
        const area = session.draftAddress ? session.draftAddress.split(" (")[0] : "Saved";
        const newAddr = {
          label: area,
          text: session.draftAddress || "",
          lat: session.draftLat,
          lng: session.draftLng,
          area,
        };
        const updated = [...addresses.filter((a) => a.area !== area), newAddr];
        await db.customer.update({
          where: { id: customer.id },
          data: { addresses: JSON.stringify(updated) },
        });
        await db.botSession.update({ where: { id: session.id }, data: { state: "confirm" } });
        const items = safeParse<{ name: string; qty?: string | number }[]>(session.draftItems, []);
        const svc = tenant.services.find((s) => s.id === session.draftService);
        const summary = buildOrderSummary(svc, items, session.draftShop, session.draftTiming, session.draftAddress || "", area, lang);
        replies.push({
          kind: "buttons",
          text: `${t(tenant, lang, "confirm_title")}\n\n${summary}\n\n${t(tenant, lang, "confirm_ask")}`,
          buttons: [
            { id: "confirm_yes", label: "✅ Confirm" },
            { id: "confirm_change", label: "✏️ Change" },
            { id: "cancel", label: "❌ Cancel" },
          ],
        });
        break;
      }
      if (button === "addr_type") {
        replies.push({ kind: "text", text: "Type your address with landmark:" });
        await db.botSession.update({ where: { id: session.id }, data: { state: "address_new" } });
        break;
      }
      break;
    }

    case "confirm": {
      if (button === "confirm_yes") {
        // ── PLACE ORDER ──────────────────────────────────
        const items = safeParse<{ name: string; qty?: string | number }[]>(session.draftItems, []);
        const svc = tenant.services.find((s) => s.id === session.draftService);
        const lastOrder = await db.order.findFirst({
          where: { tenantId: tenant.id },
          orderBy: { code: "desc" },
        });
        const code = lastOrder ? String(parseInt(lastOrder.code, 10) + 1) : "1001";
        const cityId = tenant.cities[0]?.id;
        if (!cityId) {
          replies.push({ kind: "text", text: "Sorry, no active city. Please contact support." });
          break;
        }
        const order = await db.order.create({
          data: {
            tenantId: tenant.id,
            cityId,
            customerId: customer.id,
            serviceId: svc?.id || null,
            code,
            status: "new",
            kind: svc?.kind || "order",
            items: JSON.stringify(items),
            description: items[0]?.name || null,
            preferredShop: session.draftShop,
            timing: session.draftTiming,
            addressText: session.draftAddress,
            addressArea: session.draftAddress ? session.draftAddress.split(" (")[0] : null,
            addressLat: session.draftLat,
            addressLng: session.draftLng,
            source: "bot",
            activity: {
              create: [
                { tenantId: tenant.id, actor: "bot", action: "created", detail: "Order created via WhatsApp" },
              ],
            },
          },
        });
        // Broadcast to matching providers
        const matchingProviders = await db.provider.findMany({
          where: {
            tenantId: tenant.id,
            cityId,
            isOnline: true,
            isActive: true,
          },
        });
        const toBroadcast = svc
          ? matchingProviders.filter((p) => {
              const sids = safeParse<string[]>(p.serviceIds, []);
              return sids.length === 0 || sids.includes(svc.id);
            })
          : matchingProviders;

        if (toBroadcast.length > 0) {
          await db.order.update({ where: { id: order.id }, data: { status: "broadcast" } });
          await db.orderBroadcast.createMany({
            data: toBroadcast.map((p) => ({ orderId: order.id, providerId: p.id, status: "pending" })),
          });
          await db.activity.create({
            data: {
              tenantId: tenant.id, orderId: order.id,
              actor: "system", action: "broadcast",
              detail: `Broadcast to ${toBroadcast.length} provider(s)`,
            },
          });
        }

        await db.botSession.update({
          where: { id: session.id },
          data: {
            state: "done",
            draftService: null,
            draftItems: "[]",
            draftShop: null,
            draftTiming: null,
            draftAddress: null,
            draftLat: null,
            draftLng: null,
          },
        });
        replies.push({ kind: "text", text: t(tenant, lang, "placed", { code }) });
        // Show menu again
        const menuRows = buildMenuList(tenant.id, tenant.services, lang);
        replies.push({
          kind: "list",
          text: t(tenant, lang, "menu_title"),
          listTitle: t(tenant, lang, "menu_title"),
          listButton: t(tenant, lang, "menu_button"),
          sections: [{ title: "Services", rows: menuRows }],
        });
        return NextResponse.json({ replies, session: { state: "done" }, order });
      }
      if (button === "confirm_change") {
        // Restart from service
        await db.botSession.update({
          where: { id: session.id },
          data: { state: "service_draft", draftItems: "[]" },
        });
        replies.push({ kind: "text", text: "Let's start over. Tell us what you need:" });
        break;
      }
      if (button === "cancel") {
        await db.botSession.update({
          where: { id: session.id },
          data: { state: "menu", draftService: null, draftItems: "[]" },
        });
        replies.push({ kind: "text", text: t(tenant, lang, "cancelled") });
        const menuRows = buildMenuList(tenant.id, tenant.services, lang);
        replies.push({
          kind: "list",
          text: t(tenant, lang, "menu_title"),
          listTitle: t(tenant, lang, "menu_title"),
          listButton: t(tenant, lang, "menu_button"),
          sections: [{ title: "Services", rows: menuRows }],
        });
      }
      break;
    }

    case "done":
    default: {
      // Show menu
      const menuRows = buildMenuList(tenant.id, tenant.services, lang);
      await db.botSession.update({ where: { id: session.id }, data: { state: "menu" } });
      replies.push({
        kind: "list",
        text: t(tenant, lang, "menu_title"),
        listTitle: t(tenant, lang, "menu_title"),
        listButton: t(tenant, lang, "menu_button"),
        sections: [{ title: "Services", rows: menuRows }],
      });
      break;
    }
  }

  // Update session lastMessageAt
  await db.botSession.update({
    where: { id: session.id },
    data: { lastMessageAt: new Date() },
  });

  return NextResponse.json({ replies, session: { state: session.state } });
}

function buildOrderSummary(
  svc: { icon: string; key: string; labels: string } | undefined,
  items: Array<{ name: string; qty?: string | number }>,
  shop: string | null,
  timing: string | null,
  address: string | null,
  area: string | null,
  lang: "en" | "hi"
): string {
  const labels = svc ? safeParse<Record<string, string>>(svc.labels, {}) : {};
  const svcName = svc ? `${svc.icon} ${labels[lang] || labels.en || svc.key}` : "Order";
  const lines = [
    `*${svcName}*`,
    "",
    "🛍️ Items:",
    ...items.map((it, i) => `  ${i + 1}. ${it.name}${it.qty ? ` ×${it.qty}` : ""}`),
  ];
  if (shop) lines.push("", `🏪 Shop: ${shop}`);
  if (timing) lines.push(`⏰ Timing: ${timing}`);
  lines.push("", `📍 Address:`, `  ${address || "—"}`);
  if (area) lines.push(`  Area: ${area}`);
  return lines.join("\n");
}
