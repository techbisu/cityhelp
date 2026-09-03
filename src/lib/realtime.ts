/**
 * CityHelp — Realtime broadcast helper
 *
 * Talks to the WebSocket mini-service (mini-services/realtime) via internal HTTP.
 * The WS service broadcasts events to all connected clients (providers/admins).
 *
 * In dev, the WS service runs on port 3003 and is accessed via the gateway with
 * ?XTransformPort=3003. For server-to-server calls, we hit it directly.
 *
 * Events:
 *  - "new_order"      → broadcast to all online providers in a city
 *  - "order_accepted" → broadcast to all providers (so they can dismiss the ring)
 *  - "order_status"   → broadcast to tenant admins (live order feed)
 *  - "escalation"     → broadcast to tenant owner/staff
 *  - "provider_online"/"provider_offline" → broadcast to tenant admins
 */
const WS_SERVICE_URL = process.env.WS_SERVICE_URL || "http://localhost:3003";

interface BroadcastEvent {
  type: string;
  tenantId?: string;
  cityId?: string;
  payload: unknown;
}

/**
 * Broadcast an event to all connected WS clients matching the filter.
 * The WS service handles the actual fan-out.
 */
export async function broadcast(event: BroadcastEvent): Promise<void> {
  try {
    await fetch(`${WS_SERVICE_URL}/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // WS service may not be running in dev — fail silently
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
