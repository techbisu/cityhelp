/**
 * GET /api/whatsapp/webhook  — WhatsApp verification handshake (PER-TENANT)
 *
 *   Each tenant configures this same webhook URL in their Meta app,
 *   with their OWN verify token. We look up the tenant by verify token.
 *
 *   ?hub.mode=subscribe&hub.verify_token=<tenant_token>&hub.challenge=<num>
 *
 * POST /api/whatsapp/webhook — incoming messages/events (PER-TENANT)
 *
 *   1. Extract metadata.phone_number_id from the payload
 *   2. Look up the tenant by phone_number_id
 *   3. Verify X-Hub-Signature-256 using THAT tenant's app_secret
 *   4. Dedup by message ID (waMessageId)
 *   5. Route to the bot engine for that tenant
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyWhatsAppSignature,
  identifyTenantByPhoneNumberId,
  findTenantByVerifyToken,
  sendWhatsAppText,
  sendWhatsAppButtons,
  sendWhatsAppList,
} from "@/lib/whatsapp";
import { rateLimitOr429, getClientIp } from "@/lib/rate-limit";
import { downloadAndStoreMedia } from "@/lib/storage";

// ── GET: per-tenant verification handshake ──────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token) {
    // Look up which tenant this verify token belongs to
    const tenant = await findTenantByVerifyToken(token);
    if (tenant) {
      return new NextResponse(challenge || "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    // Also check global fallback verify token (for backwards compat / platform-level testing)
    const globalToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (globalToken && token === globalToken) {
      return new NextResponse(challenge || "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }
  return NextResponse.json({ error: "verification_failed" }, { status: 403 });
}

// ── POST: incoming webhook ──────────────────────────────
export async function POST(req: NextRequest) {
  // Rate limit by IP
  const ip = getClientIp(req);
  const rl = rateLimitOr429(req, `wa-webhook:${ip}`, { max: 100, windowMs: 60 * 1000 });
  if (rl) return rl;

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

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

      // Identify the tenant by phone_number_id
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) {
        results.push({ ok: false, message: "no_phone_number_id" });
        continue;
      }

      const tenantInfo = await identifyTenantByPhoneNumberId(phoneNumberId);
      if (!tenantInfo) {
        results.push({ ok: false, message: "tenant_not_found_for_phone_number" });
        continue;
      }

      // Verify the signature using THIS tenant's app secret
      if (!verifyWhatsAppSignature(rawBody, signature, tenantInfo.appSecret)) {
        return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
      }

      // Load the full tenant (with services + cities for the bot)
      const tenant = await db.tenant.findUnique({
        where: { id: tenantInfo.tenantId },
        include: { services: { where: { isActive: true } }, cities: { where: { isActive: true } } },
      });
      if (!tenant) {
        results.push({ ok: false, message: "tenant_not_found" });
        continue;
      }

      // Incoming messages
      const messages = value.messages || [];
      for (const msg of messages) {
        const msgId = msg.id;
        if (!msgId) continue;

        // ── DEDUP: try to insert into WaMessage table (unique on waMessageId) ──
        // If it already exists, this is a duplicate delivery — skip.
        try {
          await db.waMessage.create({
            data: {
              tenantId: tenant.id,
              waMessageId: msgId,
              phone: msg.from || "unknown",
            },
          });
        } catch {
          // P2002 = unique constraint violation = duplicate message
          results.push({ ok: true, message: "duplicate_ignored" });
          continue;
        }

        const phone = msg.from;
        if (!phone) continue;

        // Upsert session (no longer storing waMessageId here — dedup is in WaMessage table)
        let session = await db.botSession.findUnique({
          where: { tenantId_phone: { tenantId: tenant.id, phone } },
        });
        if (!session) {
          session = await db.botSession.create({
            data: { tenantId: tenant.id, phone },
          });
        } else {
          await db.botSession.update({
            where: { id: session.id },
            data: { lastMessageAt: new Date() },
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
          const mediaId = msg.audio?.id || msg.voice?.id;
          const mimeType = msg.audio?.mime_type || msg.voice?.mime_type || "audio/mp4";
          let mediaUrl = "";
          // Download from WhatsApp and store in Cloudinary/R2
          if (mediaId) {
            const mediaData = await downloadWhatsAppMedia(tenant.id, mediaId);
            if (mediaData) {
              const stored = await downloadAndStoreMedia(tenant.id, mediaData.buffer, mediaId, mediaData.mimeType || mimeType);
              if (stored) mediaUrl = stored.url;
            }
          }
          botPayload = { mediaType: "voice", mediaId, mediaUrl, message: "[voice note]" };
        } else if (msgType === "image") {
          const mediaId = msg.image?.id;
          const mimeType = msg.image?.mime_type || "image/jpeg";
          let mediaUrl = "";
          if (mediaId) {
            const mediaData = await downloadWhatsAppMedia(tenant.id, mediaId);
            if (mediaData) {
              const stored = await downloadAndStoreMedia(tenant.id, mediaData.buffer, mediaId, mediaData.mimeType || mimeType);
              if (stored) mediaUrl = stored.url;
            }
          }
          botPayload = { mediaType: "image", mediaId, mediaUrl, message: "[photo]" };
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

          // Send replies back via WhatsApp using the tenant's own credentials
          for (const reply of botData.replies || []) {
            if (reply.kind === "text") {
              await sendWhatsAppText(tenant.id, phone, reply.text);
            } else if (reply.kind === "buttons" && reply.buttons) {
              await sendWhatsAppButtons(tenant.id, phone, reply.text, reply.buttons);
            } else if (reply.kind === "list" && reply.sections) {
              await sendWhatsAppList(tenant.id, phone, reply.text, reply.listButton || "Menu", reply.sections);
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
