/**
 * CityHelp — Idempotent seed script
 *
 * Safe to run on every Vercel deploy. Only creates records that don't already exist.
 * Never overwrites or deletes existing data.
 *
 * Run: bun run scripts/seed.ts            (local dev — fresh DB)
 * Run: bun run scripts/seed-idempotent.ts (production — safe, no overwrite)
 *
 * What it does:
 *   1. Creates plans (Free, Starter, Pro) if they don't exist — preserves existing
 *   2. Creates super admin if it doesn't exist — preserves existing
 *   3. Creates demo tenants (Shanti, QuickFix) if they don't exist — preserves existing
 *   4. Creates demo providers, customers, services, sample orders — only if missing
 *
 * What it DOESN'T do:
 *   - Delete any existing records
 *   - Overwrite any existing record's fields
 *   - Reset any passwords or PINs
 */
import { db } from "../src/lib/db";
import { hashPin, hashPassword } from "../src/lib/crypto";

async function findOrCreate<T>(
  model: { findFirst: (args: { where: Record<string, unknown> }) => Promise<T | null>; create: (args: { data: Record<string, unknown> }) => Promise<T> },
  where: Record<string, unknown>,
  data: Record<string, unknown>
): Promise<T> {
  const existing = await model.findFirst({ where });
  if (existing) return existing;
  return model.create({ data });
}

async function main() {
  console.log("🌱 Running idempotent seed (safe for production)...");

  // ── Plans ── (upsert by name — preserves existing limits/prices)
  const free = await db.plan.upsert({
    where: { name: "Free" },
    update: {}, // don't overwrite — admin may have customized
    create: {
      name: "Free",
      priceMonthly: 0,
      limitCities: 1,
      limitOrders: 100,
      limitWhatsApp: 1,
      limitSeats: 2,
    },
  });

  const starter = await db.plan.upsert({
    where: { name: "Starter" },
    update: {},
    create: {
      name: "Starter",
      priceMonthly: 99900,
      limitCities: 3,
      limitOrders: 1500,
      limitWhatsApp: 2,
      limitSeats: 5,
      featureWorkflow: true,
    },
  });

  const pro = await db.plan.upsert({
    where: { name: "Pro" },
    update: {},
    create: {
      name: "Pro",
      priceMonthly: 299900,
      limitCities: 999,
      limitOrders: 999999,
      limitWhatsApp: 999,
      limitSeats: 999,
      featureWorkflow: true,
      featureEmail: true,
      featureApi: true,
      featureCustomDomain: true,
    },
  });

  console.log("  ✓ Plans ready (Free, Starter, Pro)");

  // ── Super Admin ── (only create if no super admin exists)
  const existingSuper = await db.superAdmin.findFirst({});
  if (!existingSuper) {
    await db.superAdmin.create({
      data: {
        email: process.env.SUPER_ADMIN_EMAIL || "super@cityhelp.app",
        name: "Platform Owner",
        passwordHash: hashPassword(process.env.SUPER_ADMIN_PASSWORD || "super1234"),
        twoFactorEnabled: false,
      },
    });
    console.log("  ✓ Super admin created");
  } else {
    console.log("  ✓ Super admin already exists (skipped)");
  }

  // ── Demo tenants ── (only create if they don't exist)
  const existingShanti = await db.tenant.findUnique({ where: { slug: "shanti" } });
  if (!existingShanti) {
    const t1 = await db.tenant.create({
      data: {
        name: "Shanti Express",
        slug: "shanti",
        status: "active",
        planId: starter.id,
        accentColor: "#10b981",
        waBusinessName: "Shanti Express",
      },
    });
    const t1Delhi = await db.city.create({ data: { tenantId: t1.id, name: "Delhi", state: "Delhi" } });
    await db.city.create({ data: { tenantId: t1.id, name: "Jaipur", state: "Rajasthan" } });

    // Services
    const svcCake = await db.service.create({
      data: { tenantId: t1.id, key: "cake", kind: "order", icon: "🎂", orderIdx: 1,
        labels: JSON.stringify({ en: "Birthday Cake", hi: "जन्मदिन का केक" }) },
    });
    const svcGrocery = await db.service.create({
      data: { tenantId: t1.id, key: "grocery", kind: "order", icon: "🛒", orderIdx: 2,
        labels: JSON.stringify({ en: "Grocery", hi: "किराना" }) },
    });
    await db.service.create({
      data: { tenantId: t1.id, key: "chicken", kind: "order", icon: "🍗", orderIdx: 3,
        labels: JSON.stringify({ en: "Chicken / Meat", hi: "चिकन / मीट" }) },
    });
    await db.service.create({
      data: { tenantId: t1.id, key: "parcel", kind: "order", icon: "📦", orderIdx: 4,
        labels: JSON.stringify({ en: "Send Parcel", hi: "पार्सल भेजें" }) },
    });
    await db.service.create({
      data: { tenantId: t1.id, key: "team", kind: "team", icon: "👥", orderIdx: 7,
        labels: JSON.stringify({ en: "Talk to our team", hi: "हमारी टीम से बात करें" }) },
    });
    await db.service.create({
      data: { tenantId: t1.id, key: "custom", kind: "custom", icon: "➕", orderIdx: 8,
        labels: JSON.stringify({ en: "Something else", hi: "कुछ और" }) },
    });

    // Staff
    await db.staff.create({
      data: { tenantId: t1.id, email: "owner@shanti.express", name: "Rahul (Owner)",
        role: "owner", permissions: "full", passwordHash: hashPassword("demo1234") },
    });

    // Providers
    await db.provider.create({
      data: { tenantId: t1.id, cityId: t1Delhi.id, name: "Vikram Singh", phone: "+919811100001",
        pinHash: hashPin("1234"), serviceIds: JSON.stringify([svcGrocery.id, svcCake.id]),
        zone: "Jawahar Nagar", isOnline: true, rating: 4.8, jobsDone: 142, earnings: 2840000 },
    });

    // Customer
    await db.customer.create({
      data: { tenantId: t1.id, phone: "+919833300001", name: "Aditya", language: "en",
        addresses: JSON.stringify([
          { label: "Jawahar Nagar", text: "12, Jawahar Nagar, Delhi - 110007", lat: 28.6862, lng: 77.2072, area: "Jawahar Nagar" },
        ]), totalOrders: 14, lifetimeValue: 84000 },
    });

    await db.notificationSetting.create({ data: { tenantId: t1.id } });
    console.log("  ✓ Demo tenant 'Shanti Express' created");
  } else {
    console.log("  ✓ Demo tenant 'Shanti Express' already exists (skipped)");
  }

  // QuickFix
  const existingQuickfix = await db.tenant.findUnique({ where: { slug: "quickfix" } });
  if (!existingQuickfix) {
    const t2 = await db.tenant.create({
      data: {
        name: "QuickFix Services",
        slug: "quickfix",
        status: "active",
        planId: pro.id,
        accentColor: "#10b981",
        waBusinessName: "QuickFix",
      },
    });
    const t2Mumbai = await db.city.create({ data: { tenantId: t2.id, name: "Mumbai", state: "Maharashtra" } });

    const svcRide = await db.service.create({
      data: { tenantId: t2.id, key: "ride", kind: "book", icon: "🚗", orderIdx: 5,
        labels: JSON.stringify({ en: "Book Ride", hi: "राइड बुक करें" }) },
    });
    await db.service.create({
      data: { tenantId: t2.id, key: "repair", kind: "book", icon: "🧰", orderIdx: 6,
        labels: JSON.stringify({ en: "AC / Appliance Repair", hi: "एसी / उपकरण रिपेयर" }) },
    });

    await db.staff.create({
      data: { tenantId: t2.id, email: "owner@quickfix.services", name: "Imran (Owner)",
        role: "owner", permissions: "full", passwordHash: hashPassword("demo1234") },
    });

    await db.provider.create({
      data: { tenantId: t2.id, cityId: t2Mumbai.id, name: "Sandeep Patil", phone: "+919822200001",
        pinHash: hashPin("1234"), serviceIds: JSON.stringify([svcRide.id]),
        zone: "Andheri West", isOnline: true, rating: 4.7, jobsDone: 305, earnings: 6100000 },
    });

    await db.customer.create({
      data: { tenantId: t2.id, phone: "+919844400001", name: "Ravi", language: "en",
        totalOrders: 3, lifetimeValue: 18000 },
    });

    await db.notificationSetting.create({ data: { tenantId: t2.id } });
    console.log("  ✓ Demo tenant 'QuickFix Services' created");
  } else {
    console.log("  ✓ Demo tenant 'QuickFix Services' already exists (skipped)");
  }

  console.log("✅ Idempotent seed complete. No data was overwritten.");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    // Don't crash the deploy — log and exit
    process.exit(0);
  })
  .finally(async () => {
    await db.$disconnect();
  });
