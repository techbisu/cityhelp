/**
 * CityHelp Realtime — Cloudflare Worker with Durable Objects
 *
 * Free tier: 100k requests/day, always-on, global edge (Mumbai PoP)
 *
 * Architecture:
 *   - Worker: entry point, handles HTTP + WS upgrade
 *   - RealtimeRoom (Durable Object): one per tenant, holds WebSocket connections
 *
 * Rooms (client subscribes via WS message):
 *   - tenant:{tenantId}       — all clients in a tenant
 *   - tenant:{tenantId}:city:{cityId} — providers in a specific city
 *   - provider:{providerId}   — a single provider
 *
 * Deploy:
 *   cd mini-services/realtime
 *   npx wrangler deploy
 *
 * After deploy, set in Vercel:
 *   WS_SERVICE_URL=https://cityhelp-realtime.your-account.workers.dev
 *   BROADCAST_SECRET=<same secret as wrangler>
 */

// ── Durable Object: RealtimeRoom ─────────────────────────

interface SessionInfo {
  ws: WebSocket;
  rooms: Set<string>;
}

export class RealtimeRoom {
  state: DurableObjectState;
  sessions: Map<WebSocket, SessionInfo> = new Map();

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── WebSocket upgrade ──
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Accept and track
      this.state.acceptWebSocket(server);

      const session: SessionInfo = { ws: server, rooms: new Set() };
      this.sessions.set(server, session);

      // Handle subscribe/unsubscribe
      server.addEventListener("message", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.type === "subscribe" && Array.isArray(data.rooms)) {
            for (const room of data.rooms) {
              if (/^(tenant:|provider:)[a-z0-9]+/i.test(room)) {
                session.rooms.add(room);
              }
            }
          }
          if (data.type === "unsubscribe" && Array.isArray(data.rooms)) {
            for (const room of data.rooms) session.rooms.delete(room);
          }
        } catch {
          // Ignore malformed
        }
      });

      // Clean up
      server.addEventListener("close", () => {
        this.sessions.delete(server);
      });
      server.addEventListener("error", () => {
        this.sessions.delete(server);
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── Internal relay: broadcast event to all matching sessions ──
    if (url.pathname === "/relay" && request.method === "POST") {
      const event = await request.json() as {
        type: string;
        tenantId?: string;
        cityId?: string;
        payload: unknown;
      };

      const message = JSON.stringify({
        type: event.type,
        payload: event.payload,
        timestamp: Date.now(),
      });

      let sent = 0;
      for (const [, session] of this.sessions) {
        let shouldSend = false;

        // City-scoped broadcast
        if (event.cityId && event.tenantId) {
          const cityRoom = `tenant:${event.tenantId}:city:${event.cityId}`;
          shouldSend = session.rooms.has(cityRoom);
        }
        // Tenant-scoped broadcast
        if (!shouldSend && event.tenantId) {
          shouldSend = session.rooms.has(`tenant:${event.tenantId}`);
        }
        // Global broadcast
        if (!shouldSend && !event.tenantId && !event.cityId) {
          shouldSend = true;
        }

        if (shouldSend) {
          try {
            session.ws.send(message);
            sent++;
          } catch {
            // Client disconnected — will be cleaned up by close handler
          }
        }
      }

      return Response.json({ ok: true, sent });
    }

    return new Response("Not found", { status: 404 });
  }
}

// ── Worker Entry Point ───────────────────────────────────

export interface Env {
  REALTIME_ROOM: DurableObjectNamespace;
  BROADCAST_SECRET: string;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // ── Health check ──
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "cityhelp-realtime",
        runtime: "cloudflare-workers",
        timestamp: new Date().toISOString(),
      });
    }

    // ── Broadcast (server-to-server, from Next.js API) ──
    if (url.pathname === "/broadcast" && request.method === "POST") {
      // Auth: verify Bearer token
      const auth = request.headers.get("Authorization");
      const token = auth?.replace("Bearer ", "");
      if (!env.BROADCAST_SECRET || token !== env.BROADCAST_SECRET) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      const event = await request.json() as {
        type: string;
        tenantId?: string;
        cityId?: string;
        payload: unknown;
      };

      // Route to the Durable Object for this tenant
      const roomKey = event.tenantId || "global";
      const doId = env.REALTIME_ROOM.idFromName(roomKey);
      const stub = env.REALTIME_ROOM.get(doId);

      // Forward to the DO's /relay endpoint
      const relayResponse = await stub.fetch(new Request("https://internal/relay", {
        method: "POST",
        body: JSON.stringify(event),
        headers: { "Content-Type": "application/json" },
      }));

      const result = await relayResponse.json();
      return Response.json({ ok: true, type: event.type, ...result });
    }

    // ── WebSocket upgrade ──
    if (request.headers.get("Upgrade") === "websocket") {
      // Route to the DO based on tenant query param (or default "global")
      const tenantId = url.searchParams.get("tenant") || "global";
      const doId = env.REALTIME_ROOM.idFromName(tenantId);
      const stub = env.REALTIME_ROOM.get(doId);
      return stub.fetch(request);
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
};

export default worker;
