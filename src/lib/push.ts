/**
 * CityHelp — Web Push notifications (VAPID)
 *
 * Sends push notifications to subscribed providers when new jobs come in.
 * Requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars (generated via `web-push generate-vapid-keys`).
 *
 * If keys are missing, push is silently skipped — no feature breaks.
 */
import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:notifications@cityhelp.app";

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVAPIDDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

export function isPushConfigured(): boolean {
  return configured;
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
}

/**
 * Send a push notification to a subscribed provider.
 * subscriptionJson is the PushSubscription JSON stored in Provider.pushSubscription.
 */
export async function sendPush(subscriptionJson: string, payload: PushPayload): Promise<{ ok: boolean; error?: string }> {
  if (!configured) return { ok: false, error: "push_not_configured" };
  try {
    const subscription = JSON.parse(subscriptionJson);
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload),
      {
        TTL: 60,
        urgency: "high",
        topic: payload.tag,
      }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Send a push to all online providers in a tenant/city about a new job.
 * Called when a new order is broadcast.
 */
export async function notifyProvidersOfNewJob(
  tenantId: string,
  cityId: string,
  job: { id: string; code: string; service: string; area: string }
): Promise<{ sent: number; failed: number }> {
  if (!configured) return { sent: 0, failed: 0 };
  const { db } = await import("./db");
  const providers = await db.provider.findMany({
    where: {
      tenantId,
      cityId,
      isOnline: true,
      isActive: true,
      NOT: { pushSubscription: null },
    },
    select: { id: true, pushSubscription: true, name: true },
  });
  let sent = 0, failed = 0;
  for (const p of providers) {
    if (!p.pushSubscription) continue;
    const result = await sendPush(p.pushSubscription, {
      title: `📦 New job #${job.code}`,
      body: `${job.service} · ${job.area}`,
      tag: `job-${job.id}`,
      data: { orderId: job.id, providerId: p.id },
      actions: [
        { action: "accept", title: "✅ Accept" },
        { action: "reject", title: "❌ Reject" },
      ],
    });
    if (result.ok) sent++; else failed++;
  }
  return { sent, failed };
}
