/**
 * GET /api/whatsapp/webhook  — WhatsApp verification handshake
 *   ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<num>
 *
 * POST /api/whatsapp/webhook — incoming messages/events
 *   - Verifies X-Hub-Signature-256 HMAC
 *   - Dedupes by message ID (waMessageId unique on BotSession)
 *   - Routes to the bot engine
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyWhatsAppSignature, isWhatsAppConfigured } from "@/lib/whatsapp";
import { safeParse, reverseGeocodeStub } from "@/lib/utils";
import { rateLimitOr429, getClientIp } from "@/lib/rate-limit";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "cityhelp_verify_token_dev";

// ── GET: verification handshake ─────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new NextResponse(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "verification_failed" }, { status: 403 });
}

// ── POST: incoming webhook ──────────────────────────────
export async function POST(req: NextRequest) {
  // Rate limit by IP
  const ip = getClientIp(req);
  const rl = rateLimitOr429(req, `wa-webhook:${ip}`, { max: 100, windowMs: 60 * 1000 });
  if (rl) return rl;

  // Get raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  // Verify signature (skip in dev if WhatsApp isn't configured, for testing)
  if (isWhatsAppConfigured()) {
    if (!verifyWhatsAppSignature(rawBody, signature)) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // WhatsApp webhook structure: entry[].changes[].value
  const entries = body?.entry || [];
  const results: Array<{ ok: boolean; message?: string }> = [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;

      // Status updates (sent/delivered/read) — acknowledge but no action
      if (value.statuses) {
        results.push({ ok: true, message: "status_update_ignored" });
        continue;
      }

      // Incoming messages
      const messages = value.messages || [];
      for (const msg of messages) {
        const msgId = msg.id;
        if (!msgId) continue;

        // ── DEDUP: check if we already processed this message ID ──
        const existing = await db.botSession.findFirst({
          where: { waMessageId: msgId },
          select: { id: true },
        });
        if (existing) {
          results.push({ ok: true, message: "duplicate_ignored" });
          continue;
        }

        // Resolve tenant from the WA phone number ID
        const waPhoneNumberId = value.metadata?.phone_number_id;
        const tenant = await db.tenant.findFirst({
          where: { waPhoneNumberId: waPhoneNumberId || "shanti-wa-001" },
          include: { services: { where: { isActive: true } }, cities: { where: { isActive: true } } },
        });
        if (!tenant) {
          results.push({ ok: false, message: "tenant_not_found" });
          continue;
        }

        const phone = msg.from;
        if (!phone) continue;

        // Mark this message ID as seen (upsert session)
        let session = await db.botSession.findUnique({
          where: { tenantId_phone: { tenantId: tenant.id, phone } },
        });
        if (!session) {
          session = await db.botSession.create({
            data: { tenantId: tenant.id, phone, waMessageId: msgId },
          });
        } else {
          // Update waMessageId on the existing session (acts as dedup ledger)
          await db.botSession.update({
            where: { id: session.id },
            data: { waMessageId: msgId, lastMessageAt: new Date() },
          });
        }

        // Parse message type and forward to the bot engine
        const msgType = msg.type;
        let botPayload: Record<string, unknown> = {};

        if (msgType === "text") {
          botPayload = { message: msg.text?.body || "" };
        } else if (msgType === "button") {
          botPayload = { button: msg.button?.text || msg.button?.payload };
        } else if (msgType === "interactive") {
          const ic = msg.interactive;
          if (ic.type === "button_reply") botPayload = { button: ic.button_reply?.id };
          else if (ic.type === "list_reply") botPayload = { button: ic.list_reply?.id };
        } else if (msgType === "location") {
          botPayload = {
            location: {
              lat: msg.location?.latitude,
              lng: msg.location?.longitude,
            },
          };
        } else if (msgType === "audio" || msgType === "voice") {
          botPayload = { mediaType: "voice", mediaId: msg.audio?.id || msg.voice?.id, message: "[voice note]" };
        } else if (msgType === "image") {
          botPayload = { mediaType: "image", mediaId: msg.image?.id, message: "[photo]" };
        } else {
          botPayload = { message: `[${msgType}]` };
        }

        // Call the bot engine (internal HTTP call to /api/bot/send)
        try {
          const botRes = await fetch(`${req.nextUrl.origin}/api/bot/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenantSlug: tenant.slug, phone, ...botPayload }),
          });
          const botData = await botRes.json();

          // Send replies back via WhatsApp (if configured)
          if (isWhatsAppConfigured()) {
            const { sendWhatsAppText, sendWhatsAppButtons, sendWhatsAppList } = await import("@/lib/whatsapp");
            for (const reply of botData.replies || []) {
              if (reply.kind === "text") {
                await sendWhatsAppText(phone, reply.text);
              } else if (reply.kind === "buttons" && reply.buttons) {
                await sendWhatsAppButtons(phone, reply.text, reply.buttons);
              } else if (reply.kind === "list" && reply.sections) {
                await sendWhatsAppList(phone, reply.text, reply.listButton || "Menu", reply.sections);
              }
            }
          }
          results.push({ ok: true, message: "processed" });
        } catch (e) {
          results.push({ ok: false, message: e instanceof Error ? e.message : "bot_error" });
        }
      }
    }
  }

  // WhatsApp expects a 200 OK quickly
  return NextResponse.json({ processed: results.length, results });
}
