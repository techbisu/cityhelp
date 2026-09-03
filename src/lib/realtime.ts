/**
 * CityHelp — Realtime broadcast helper
 *
 * Talks to the Cloudflare Worker (Durable Objects) for WebSocket fan-out.
 * The Worker URL is configurable via WS_SERVICE_URL env var.
 *
 * Auth: sends Bearer token (BROADCAST_SECRET) so only the Next.js app can broadcast.
 *
 * Events:
 *  - "new_order"      → broadcast to all online providers in a city
 *  - "order_accepted" → broadcast to all providers (so they can dismiss the ring)
 *  - "order_status"   → broadcast to tenant admins (live order feed)
 *  - "escalation"     → broadcast to tenant owner/staff
 *  - "charges_agreed" → broadcast to the provider who set charges
 */
const WS_SERVICE_URL = process.env.WS_SERVICE_URL || "http://localhost:3003";
const BROADCAST_SECRET = process.env.BROADCAST_SECRET || "cityhelp-dev-broadcast-secret";

interface BroadcastEvent {
  type: string;
  tenantId?: string;
  cityId?: string;
  payload: unknown;
}

/**
 * Broadcast an event to all connected WebSocket clients matching the filter.
 */
export async function broadcast(event: BroadcastEvent): Promise<void> {
  try {
    const res = await fetch(`${WS_SERVICE_URL}/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BROADCAST_SECRET}`,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.error(`[Realtime] Broadcast failed: ${res.status}`);
    }
  } catch {
    // Worker may be down — fail silently (polling is the fallback)
  }
}

/** Convenience: broadcast a new order to providers in a city */
export async function broadcastNewOrder(tenantId: string, cityId: string, order: { id: string; code: string; service?: string }): Promise<void> {
  await broadcast({
    type: "new_order",
    tenantId,
    cityId,
    payload: order,
  });
}

/** Convenience: broadcast order accepted (so other providers dismiss their ring) */
export async function broadcastOrderAccepted(tenantId: string, orderId: string, providerId: string): Promise<void> {
  await broadcast({
    type: "order_accepted",
    tenantId,
    payload: { orderId, providerId },
  });
}

/** Convenience: broadcast order status change to tenant admins */
export async function broadcastOrderStatus(tenantId: string, orderId: string, status: string): Promise<void> {
  await broadcast({
    type: "order_status",
    tenantId,
    payload: { orderId, status },
  });
}

/** Convenience: broadcast escalation to tenant admins/owner */
export async function broadcastToTenant(tenantId: string, eventType: string, payload: unknown): Promise<void> {
  await broadcast({
    type: eventType,
    tenantId,
    payload,
  });
}
