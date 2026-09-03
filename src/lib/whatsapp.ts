/**
 * CityHelp — WhatsApp Cloud API client
 *
 * Handles:
 *  - Webhook signature verification (HMAC SHA-256, "sha256=" prefix)
 *  - Outbound message sending (text, interactive buttons, list)
 *  - Media download + storage (S3/Supabase in prod; local in dev)
 *
 * Env vars:
 *   WHATSAPP_APP_SECRET         — for verifying incoming webhooks
 *   WHATSAPP_ACCESS_TOKEN       — for sending outbound messages
 *   WHATSAPP_PHONE_NUMBER_ID    — sender phone number ID
 *   WHATSAPP_API_VERSION        — default "v21.0"
 */
import crypto from "crypto";

const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

export function isWhatsAppConfigured(): boolean {
  return !!(APP_SECRET && ACCESS_TOKEN && PHONE_NUMBER_ID);
}

/**
 * Verify an incoming WhatsApp webhook signature.
 * WhatsApp sends X-Hub-Signature-256: "sha256=<hex>".
 *
 * Returns true if the signature matches HMAC(APP_SECRET, rawBody).
 */
export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!APP_SECRET || !signatureHeader) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const expected = signatureHeader.slice(prefix.length);
  const computed = crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(computed, "hex"));
}

interface WaSendResponse {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a text message via WhatsApp Cloud API.
 * phone: E.164 format, e.g. "+919833300001" (the API strips the +).
 */
export async function sendWhatsAppText(phone: string, text: string): Promise<WaSendResponse> {
  if (!isWhatsAppConfigured()) {
    return { ok: false, error: "whatsapp_not_configured" };
  }
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone.replace("+", ""),
        type: "text",
        text: { body: text, preview_url: false },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: JSON.stringify(data) };
    }
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Send an interactive button message.
 * buttons: [{ id, label }] — max 3.
 */
export async function sendWhatsAppButtons(
  phone: string,
  text: string,
  buttons: Array<{ id: string; label: string }>
): Promise<WaSendResponse> {
  if (!isWhatsAppConfigured()) return { ok: false, error: "whatsapp_not_configured" };
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone.replace("+", ""),
        type: "interactive",
        interactive: {
          type: "button",
          body: { text },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.label },
            })),
          },
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: JSON.stringify(data) };
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Send an interactive list message.
 */
export async function sendWhatsAppList(
  phone: string,
  bodyText: string,
  buttonText: string,
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
): Promise<WaSendResponse> {
  if (!isWhatsAppConfigured()) return { ok: false, error: "whatsapp_not_configured" };
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone.replace("+", ""),
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: {
            button: buttonText,
            sections: sections.map((s) => ({
              title: s.title,
              rows: s.rows.slice(0, 10).map((r) => ({
                id: r.id,
                title: r.title,
                description: r.description || "",
              })),
            })),
          },
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: JSON.stringify(data) };
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Download a media asset from WhatsApp (by media ID) for storage.
 * Returns the binary buffer + mime type.
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!isWhatsAppConfigured()) return null;
  try {
    // Step 1: get the media URL
    const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const meta = await metaRes.json();
    if (!meta.url) return null;
    // Step 2: download the binary
    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const buf = Buffer.from(await binRes.arrayBuffer());
    return { buffer: buf, mimeType: meta.mime_type || "application/octet-stream" };
  } catch {
    return null;
  }
}
