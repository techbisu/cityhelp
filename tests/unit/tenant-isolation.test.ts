/**
 * CityHelp — Tenant Isolation Test
 *
 * Proves that tenant A cannot access tenant B's data via the API.
 * Tests both authenticated access (with session cookie) and unauthenticated access (should be 401).
 *
 * Run: bun test tests/unit/tenant-isolation.test.ts
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../../src/lib/db";

const BASE = "http://localhost:3000";

// Helper: login as staff and return cookie header
async function loginAsStaff(tenantSlug: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/staff/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantSlug, email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  // Extract Set-Cookie header
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No Set-Cookie header");
  // Return the first cookie (the session cookie)
  return setCookie.split(";")[0];
}

describe("Tenant Isolation", () => {
  let tenantA_orderId: string;
  let tenantB_orderId: string;
  let tenantB_providerId: string;
  let tenantB_customerId: string;
  let staffCookieA: string;

  beforeAll(async () => {
    // Get IDs from DB
    const tenantA = await db.tenant.findUnique({ where: { slug: "shanti" } });
    const tenantB = await db.tenant.findUnique({ where: { slug: "quickfix" } });
    if (!tenantA || !tenantB) throw new Error("Seed data missing — run bun run scripts/seed.ts first");

    const aOrder = await db.order.findFirst({ where: { tenantId: tenantA.id } });
    const bOrder = await db.order.findFirst({ where: { tenantId: tenantB.id } });
    const bProvider = await db.provider.findFirst({ where: { tenantId: tenantB.id } });
    const bCustomer = await db.customer.findFirst({ where: { tenantId: tenantB.id } });
    if (!aOrder || !bOrder || !bProvider || !bCustomer) throw new Error("Seed data incomplete");
    tenantA_orderId = aOrder.id;
    tenantB_orderId = bOrder.id;
    tenantB_providerId = bProvider.id;
    tenantB_customerId = bCustomer.id;

    // Login as Shanti Express staff
    staffCookieA = await loginAsStaff("shanti", "owner@shanti.express", "demo1234");
  });

  // ── Unauthenticated access should be rejected ──
  it("unauthenticated request to /api/orders should return 401", async () => {
    const res = await fetch(`${BASE}/api/orders?tenantSlug=shanti`);
    expect(res.status).toBe(401);
  });

  it("unauthenticated request to /api/providers should return 401", async () => {
    const res = await fetch(`${BASE}/api/providers?tenantSlug=shanti`);
    expect(res.status).toBe(401);
  });

  it("unauthenticated request to /api/customers should return 401", async () => {
    const res = await fetch(`${BASE}/api/customers?tenantSlug=shanti`);
    expect(res.status).toBe(401);
  });

  // ── Authenticated: tenant A cannot see tenant B's data ──
  it("tenant A's order list should NOT contain tenant B's orders", async () => {
    const res = await fetch(`${BASE}/api/orders?tenantSlug=shanti`, {
      headers: { Cookie: staffCookieA },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = (data.orders as Array<{ id: string }>).map((o) => o.id);
    expect(ids).not.toContain(tenantB_orderId);
    expect(ids).toContain(tenantA_orderId);
  });

  it("tenant A should NOT be able to accept tenant B's order", async () => {
    const res = await fetch(`${BASE}/api/orders/${tenantB_orderId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffCookieA },
      body: JSON.stringify({ tenantSlug: "shanti", providerId: tenantB_providerId }),
    });
    expect([403, 404]).toContain(res.status);
  });

  it("tenant A should NOT be able to delete tenant B's customer", async () => {
    const res = await fetch(`${BASE}/api/customers/${tenantB_customerId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffCookieA },
      body: JSON.stringify({ tenantSlug: "shanti" }),
    });
    expect(res.status).toBe(403);
  });

  it("tenant A should NOT be able to export tenant B's customer", async () => {
    const res = await fetch(`${BASE}/api/customers/${tenantB_customerId}/export?tenantSlug=shanti`, {
      headers: { Cookie: staffCookieA },
    });
    expect(res.status).toBe(403);
  });

  it("tenant A's customer list should NOT contain tenant B's customers", async () => {
    const res = await fetch(`${BASE}/api/customers?tenantSlug=shanti`, {
      headers: { Cookie: staffCookieA },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = (data.customers as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(tenantB_customerId);
  });

  it("tenant A's provider list should NOT contain tenant B's providers", async () => {
    const res = await fetch(`${BASE}/api/providers?tenantSlug=shanti`, {
      headers: { Cookie: staffCookieA },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = (data.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids).not.toContain(tenantB_providerId);
  });
});
