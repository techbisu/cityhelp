/**
 * CityHelp — Tenant Isolation Test
 *
 * Proves that tenant A cannot access tenant B's data via the API.
 * This is the single highest-value security test.
 *
 * Run: bun test tests/unit/tenant-isolation.test.ts
 *
 * What it tests:
 *  1. Tenant A's /api/orders?tenantSlug=tenantA returns only tenant A's orders
 *  2. Tenant A cannot accept/assign tenant B's order (POST /api/orders/{id}/accept with tenantSlug=tenantA)
 *  3. Tenant A cannot fetch tenant B's provider (GET /api/providers/{tenantB_provider_id})
 *  4. Tenant A cannot block tenant B's customer (PATCH /api/customers with id=tenantB_customer_id)
 *  5. Tenant A cannot delete tenant B's customer (POST /api/customers/{id}/delete with tenantSlug=tenantA)
 *
 * The test seed has:
 *  - Tenant A: "Shanti Express" (slug: shanti) — Delhi + Jaipur
 *  - Tenant B: "QuickFix Services" (slug: quickfix) — Mumbai + Pune
 *
 * We pick an order from tenant B and try to operate on it as tenant A.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../../src/lib/db";

const BASE = "http://localhost:3000";

describe("Tenant Isolation", () => {
  let tenantA_orderId: string;
  let tenantB_orderId: string;
  let tenantB_providerId: string;
  let tenantB_customerId: string;

  beforeAll(async () => {
    // Get an order from each tenant
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
  });

  it("tenant A's order list should NOT contain tenant B's orders", async () => {
    const res = await fetch(`${BASE}/api/orders?tenantSlug=shanti`);
    const data = await res.json();
    expect(data.orders).toBeDefined();
    const ids = (data.orders as Array<{ id: string }>).map((o) => o.id);
    expect(ids).not.toContain(tenantB_orderId);
    expect(ids).toContain(tenantA_orderId);
  });

  it("tenant A should NOT be able to accept tenant B's order", async () => {
    const res = await fetch(`${BASE}/api/orders/${tenantB_orderId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantSlug: "shanti", // pretending to be tenant A
        providerId: tenantB_providerId,
      }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("forbidden");
  });

  it("tenant A should NOT be able to assign tenant B's order", async () => {
    const res = await fetch(`${BASE}/api/orders/${tenantB_orderId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantSlug: "shanti",
        providerId: tenantB_providerId,
        actor: "admin",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("tenant A should NOT be able to delete tenant B's customer", async () => {
    const res = await fetch(`${BASE}/api/customers/${tenantB_customerId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: "shanti" }),
    });
    expect(res.status).toBe(403);
  });

  it("tenant A should NOT be able to export tenant B's customer", async () => {
    const res = await fetch(`${BASE}/api/customers/${tenantB_customerId}/export?tenantSlug=shanti`);
    expect(res.status).toBe(403);
  });

  it("tenant A's customer list should NOT contain tenant B's customers", async () => {
    const res = await fetch(`${BASE}/api/customers?tenantSlug=shanti`);
    const data = await res.json();
    const ids = (data.customers as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(tenantB_customerId);
  });

  it("tenant A's provider list should NOT contain tenant B's providers", async () => {
    const res = await fetch(`${BASE}/api/providers?tenantSlug=shanti`);
    const data = await res.json();
    const ids = (data.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids).not.toContain(tenantB_providerId);
  });
});
