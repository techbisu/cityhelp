/**
 * CityHelp — WhatsApp Cloud API client (PER-TENANT)
 *
 * Each tenant (business) connects their OWN WhatsApp Business number:
 *   - waPhoneNumberId   — their sender phone number ID
 *   - waAccessToken     — their access token (encrypted at rest)
 *   - waAppSecret       — their Meta app secret (encrypted, for webhook signature verification)
 *   - waVerifyToken     — their custom verify token (for webhook handshake)
 *
 * All send functions take a tenantId and look up the tenant's credentials from DB.
 * Webhook verification identifies the tenant by phone_number_id, then uses that tenant's app_secret.
 *
 * If a tenant hasn't configured WhatsApp, send functions return { ok: false, skipped: true }
 * and the calling code should gracefully degrade (log to console in dev).
 */
import crypto from "crypto";
import { db } from "./db";
import { encrypt, decrypt, maskKey } from "./crypto";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

// ── Tenant credential management ────────────────────────

interface TenantWaCredentials {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

/**
 * Get a tenant's decrypted WhatsApp credentials.
 * Returns null if not configured.
 */
export async function getTenantWaCredentials(tenantId: string): Promise<TenantWaCredentials | null> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: {
      waPhoneNumberId: true,
      waAccessTokenCipher: true,
      waAppSecretCipher: true,
      waVerifyToken: true,
      waConfigured: true,
    },
  });
  if (!tenant || !tenant.waConfigured || !tenant.waPhoneNumberId || !tenant.waAccessTokenCipher || !tenant.waAppSecretCipher) {
    return null;
  }
  try {
    return {
      phoneNumberId: tenant.waPhoneNumberId,
      accessToken: decrypt(tenant.waAccessTokenCipher),
      appSecret: decrypt(tenant.waAppSecretCipher),
      verifyToken: tenant.waVerifyToken || "",
    };
  } catch {
    return null;
  }
}

/**
 * Save a tenant's WhatsApp credentials (encrypts at rest).
 */
export async function saveTenantWaCredentials(
  tenantId: string,
  creds: {
    phoneNumberId: string;
    accessToken: string;
    appSecret: string;
    verifyToken?: string;
    businessName?: string;
  }
): Promise<void> {
  const verifyToken = creds.verifyToken || generateVerifyToken();
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      waPhoneNumberId: creds.phoneNumberId,
      waAccessTokenCipher: encrypt(creds.accessToken),
      waAccessTokenMask: maskKey(creds.accessToken),
      waAppSecretCipher: encrypt(creds.appSecret),
      waVerifyToken: verifyToken,
      waBusinessName: creds.businessName || null,
      waConfigured: true,
      waTestedAt: new Date(),
      waTestStatus: "ok",
    },
  });
}

/**
 * Clear a tenant's WhatsApp credentials.
 */
export async function clearTenantWaCredentials(tenantId: string): Promise<void> {
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      waPhoneNumberId: null,
      waAccessTokenCipher: null,
      waAccessTokenMask: null,
      waAppSecretCipher: null,
      waVerifyToken: null,
      waConfigured: false,
      waVerified: false,
      waTestStatus: "untested",
      waTestedAt: null,
    },
  });
}

/**
 * Generate a random verify token for the webhook handshake.
 */
export function generateVerifyToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── Per-tenant checks ───────────────────────────────────

/**
 * Check if a tenant has WhatsApp configured.
 */
export async function isTenantWaConfigured(tenantId: string): Promise<boolean> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { waConfigured: true },
  });
  return !!tenant?.waConfigured;
}

/**
 * Count how many tenants have WhatsApp configured (for platform health).
 */
export async function getConfiguredWaTenantCount(): Promise<number> {
  return db.tenant.count({ where: { waConfigured: true } });
}

// ── Webhook signature verification ──────────────────────

/**
 * Verify an incoming WhatsApp webhook signature using a SPECIFIC tenant's app secret.
 * WhatsApp sends X-Hub-Signature-256: "sha256=<hex>".
 *
 * The appSecret is the tenant's own Meta app secret.
 */
export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!appSecret || !signatureHeader) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const expected = signatureHeader.slice(prefix.length);
  const computed = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(computed, "hex"));
  } catch {
    return false; // length mismatch
  }
}

/**
 * Identify which tenant an incoming webhook is for, by looking up phone_number_id.
 * Returns the tenant + decrypted app secret for verification.
 */
export async function identifyTenantByPhoneNumberId(phoneNumberId: string): Promise<{
  tenantId: string;
  tenantSlug: string;
  appSecret: string;
} | null> {
  const tenant = await db.tenant.findFirst({
    where: { waPhoneNumberId: phoneNumberId, waConfigured: true },
    select: { id: true, slug: true, waAppSecretCipher: true },
  });
  if (!tenant || !tenant.waAppSecretCipher) return null;
  try {
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      appSecret: decrypt(tenant.waAppSecretCipher),
    };
  } catch {
    return null;
  }
}

/**
 * Find a tenant by their verify token (for the GET webhook handshake).
 */
export async function findTenantByVerifyToken(verifyToken: string): Promise<{ tenantId: string; tenantSlug: string } | null> {
  const tenant = await db.tenant.findFirst({
    where: { waVerifyToken: verifyToken, waConfigured: true },
    select: { id: true, slug: true },
  });
  if (!tenant) return null;
  return { tenantId: tenant.id, tenantSlug: tenant.slug };
}

// ── Send functions (per-tenant) ─────────────────────────

interface WaSendResponse {
  ok: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a text message via WhatsApp Cloud API using a tenant's credentials.
 */
export async function sendWhatsAppText(tenantId: string, phone: string, text: string): Promise<WaSendResponse> {
  const creds = await getTenantWaCredentials(tenantId);
  if (!creds) return { ok: false, skipped: true, error: "whatsapp_not_configured" };
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${creds.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
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
    if (!res.ok) return { ok: false, error: JSON.stringify(data) };
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Send an interactive button message using a tenant's credentials.
 */
export async function sendWhatsAppButtons(
  tenantId: string,
  phone: string,
  text: string,
  buttons: Array<{ id: string; label: string }>
): Promise<WaSendResponse> {
  const creds = await getTenantWaCredentials(tenantId);
  if (!creds) return { ok: false, skipped: true, error: "whatsapp_not_configured" };
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${creds.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
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
 * Send an interactive list message using a tenant's credentials.
 */
export async function sendWhatsAppList(
  tenantId: string,
  phone: string,
  bodyText: string,
  buttonText: string,
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
): Promise<WaSendResponse> {
  const creds = await getTenantWaCredentials(tenantId);
  if (!creds) return { ok: false, skipped: true, error: "whatsapp_not_configured" };
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${creds.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
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
 * Download a media asset from WhatsApp using a tenant's credentials.
 */
export async function downloadWhatsAppMedia(tenantId: string, mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const creds = await getTenantWaCredentials(tenantId);
  if (!creds) return null;
  try {
    const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    const meta = await metaRes.json();
    if (!meta.url) return null;
    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    const buf = Buffer.from(await binRes.arrayBuffer());
    return { buffer: buf, mimeType: meta.mime_type || "application/octet-stream" };
  } catch {
    return null;
  }
}

/**
 * Test a tenant's WhatsApp connection by sending a test message to the business number itself.
 * Returns { ok: true } if the API accepts the request.
 */
export async function testTenantWaConnection(tenantId: string): Promise<{ ok: boolean; error?: string }> {
  const creds = await getTenantWaCredentials(tenantId);
  if (!creds) return { ok: false, error: "not_configured" };
  try {
    // Hit the phone number endpoint to verify the token works
    const url = `https://graph.facebook.com/${API_VERSION}/${creds.phoneNumberId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (!res.ok) {
      const data = await res.json();
      return { ok: false, error: JSON.stringify(data) };
    }
    const data = await res.json();
    if (data.error) return { ok: false, error: JSON.stringify(data.error) };
    // Mark as tested + verified
    await db.tenant.update({
      where: { id: tenantId },
      data: {
        waTestedAt: new Date(),
        waTestStatus: "ok",
        waVerified: true,
      },
    });
    return { ok: true };
  } catch (e) {
    await db.tenant.update({
      where: { id: tenantId },
      data: { waTestedAt: new Date(), waTestStatus: "fail" },
    });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
