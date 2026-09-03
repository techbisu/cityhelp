/**
 * CityHelp — Realtime WebSocket mini-service
 *
 * Runs on port 3003. Uses socket.io.
 * Frontend connects via: io("/?XTransformPort=3003")
 *
 * Rooms:
 *  - tenant:{tenantId}       — all clients in a tenant (admins + providers)
 *  - tenant:{tenantId}:city:{cityId} — providers in a specific city
 *  - provider:{providerId}   — a single provider
 *
 * HTTP endpoint POST /broadcast (internal) — server-to-server broadcast.
 *
 * Events emitted to clients:
 *  - "new_order"      → providers in a city get the incoming job
 *  - "order_accepted" → all providers in tenant dismiss their ring
 *  - "order_status"   → admins update their live feed
 *  - "escalation"     → admins/owner get an escalation alert
 */
import { createServer } from "http";
import { Server } from "socket.io";

const PORT = 3003;

const httpServer = createServer((req, res) => {
  // CORS + JSON
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/broadcast") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const event = JSON.parse(body);
        const { type, tenantId, cityId, payload } = event;
        // Fan-out to the right rooms
        if (cityId && tenantId) {
          io.to(`tenant:${tenantId}:city:${cityId}`).emit(type, payload);
        } else if (tenantId) {
          io.to(`tenant:${tenantId}`).emit(type, payload);
        } else {
          io.emit(type, payload);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, type }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_json" }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, connections: io.engine.clientsCount }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  // Default path "/socket.io/" — leaves "/" free for our HTTP routes
});

io.on("connection", (socket) => {
  console.log(`[WS] connected: ${socket.id}`);

  // Client sends "subscribe" events to join rooms
  socket.on("subscribe", (rooms: string[] | string) => {
    const arr = Array.isArray(rooms) ? rooms : [rooms];
    for (const r of arr) {
      // Validate room name pattern
      if (/^(tenant:[a-z0-9]+|tenant:[a-z0-9]+:city:[a-z0-9]+|provider:[a-z0-9]+)$/i.test(r)) {
        socket.join(r);
      }
    }
  });

  socket.on("unsubscribe", (rooms: string[] | string) => {
    const arr = Array.isArray(rooms) ? rooms : [rooms];
    for (const r of arr) socket.leave(r);
  });

  socket.on("disconnect", () => {
    console.log(`[WS] disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[CityHelp Realtime] listening on port ${PORT}`);
});
