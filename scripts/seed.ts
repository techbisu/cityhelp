/**
 * CityHelp seed — 2 tenants, multiple cities, providers, services, sample orders.
 * Run: bun run scripts/seed.ts
 */
import { db } from "../src/lib/db";
import { hashPin, hashPassword } from "../src/lib/crypto";

async function main() {
  console.log("🌱 Seeding CityHelp…");

  // ── Plans ──────────────────────────────────────────────
  const free = await db.plan.create({
    data: {
      name: "Free",
      priceMonthly: 0,
      limitCities: 1,
      limitOrders: 100,
      limitWhatsApp: 1,
      limitSeats: 2,
      featureWorkflow: false,
      featureEmail: false,
      featureApi: false,
    },
  });
  const starter = await db.plan.create({
    data: {
      name: "Starter",
      priceMonthly: 99900,
      limitCities: 3,
      limitOrders: 1500,
      limitWhatsApp: 2,
      limitSeats: 5,
      featureWorkflow: true,
      featureEmail: false,
      featureApi: false,
    },
  });
  const pro = await db.plan.create({
    data: {
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

  // ── Tenant 1: Shanti Express ──
  const t1 = await db.tenant.create({
    data: {
      name: "Shanti Express",
      slug: "shanti",
      status: "active",
      planId: starter.id,
      accentColor: "#10b981",
      waBusinessName: "Shanti Express",
      waVerified: false,
      waConfigured: false,
    },
  });
  const t1Delhi = await db.city.create({ data: { tenantId: t1.id, name: "Delhi", state: "Delhi" } });
  const t1Jaipur = await db.city.create({ data: { tenantId: t1.id, name: "Jaipur", state: "Rajasthan" } });

  // ── Tenant 2: QuickFix Services ──
  const t2 = await db.tenant.create({
    data: {
      name: "QuickFix Services",
      slug: "quickfix",
      status: "active",
      planId: pro.id,
      accentColor: "#10b981",
      waBusinessName: "QuickFix",
      waVerified: false,
      waConfigured: false,
    },
  });
  const t2Mumbai = await db.city.create({ data: { tenantId: t2.id, name: "Mumbai", state: "Maharashtra" } });
  const t2Pune = await db.city.create({ data: { tenantId: t2.id, name: "Pune", state: "Maharashtra" } });

  // ── Services tenant 1 ──
  const svcCake = await db.service.create({
    data: {
      tenantId: t1.id, key: "cake", kind: "order", icon: "🎂", orderIdx: 1,
      labels: JSON.stringify({ en: "Birthday Cake", hi: "जन्मदिन का केक" }),
      questions: JSON.stringify({ en: "What cake would you like? (flavor, weight, message)", hi: "आपको कौन सा केक चाहिए?" }),
    },
  });
  const svcGrocery = await db.service.create({
    data: {
      tenantId: t1.id, key: "grocery", kind: "order", icon: "🛒", orderIdx: 2,
      labels: JSON.stringify({ en: "Grocery", hi: "किराना" }),
      questions: JSON.stringify({ en: "Send your grocery list — type, voice, or photo", hi: "अपनी किराने की लिस्ट भेजें" }),
    },
  });
  const svcChicken = await db.service.create({
    data: { tenantId: t1.id, key: "chicken", kind: "order", icon: "🍗", orderIdx: 3, labels: JSON.stringify({ en: "Chicken / Meat", hi: "चिकन / मीट" }) },
  });
  const svcParcel = await db.service.create({
    data: { tenantId: t1.id, key: "parcel", kind: "order", icon: "📦", orderIdx: 4, labels: JSON.stringify({ en: "Send Parcel", hi: "पार्सल भेजें" }) },
  });
  await db.service.create({ data: { tenantId: t1.id, key: "team", kind: "team", icon: "👥", orderIdx: 7, labels: JSON.stringify({ en: "Talk to our team", hi: "हमारी टीम से बात करें" }) } });
  await db.service.create({ data: { tenantId: t1.id, key: "custom", kind: "custom", icon: "➕", orderIdx: 8, labels: JSON.stringify({ en: "Something else", hi: "कुछ और" }) } });

  // ── Services tenant 2 ──
  const svcRide = await db.service.create({
    data: { tenantId: t2.id, key: "ride", kind: "book", icon: "🚗", orderIdx: 5, labels: JSON.stringify({ en: "Book Ride", hi: "राइड बुक करें" }) },
  });
  const svcRepair = await db.service.create({
    data: { tenantId: t2.id, key: "repair", kind: "book", icon: "🧰", orderIdx: 6, labels: JSON.stringify({ en: "AC / Appliance Repair", hi: "एसी / उपकरण रिपेयर" }) },
  });

  // ── Staff ──
  await db.staff.create({ data: { tenantId: t1.id, email: "owner@shanti.express", name: "Rahul (Owner)", role: "owner", permissions: "full", passwordHash: hashPassword("demo1234") } });
  await db.staff.create({ data: { tenantId: t1.id, email: "staff@shanti.express", name: "Priya (Staff)", role: "staff", permissions: "orders_only", passwordHash: hashPassword("demo1234") } });
  await db.staff.create({ data: { tenantId: t2.id, email: "owner@quickfix.services", name: "Imran (Owner)", role: "owner", permissions: "full", passwordHash: hashPassword("demo1234") } });

  // ── Super Admin ──
  await db.superAdmin.create({ data: { email: "super@cityhelp.app", name: "Platform Owner", passwordHash: hashPassword("super1234"), twoFactorEnabled: false } });

  // ── Providers ──
  const p1 = await db.provider.create({
    data: { tenantId: t1.id, cityId: t1Delhi.id, name: "Vikram Singh", phone: "+919811100001", pinHash: hashPin("1234"), serviceIds: JSON.stringify([svcGrocery.id, svcCake.id, svcChicken.id]), zone: "Jawahar Nagar", isOnline: true, rating: 4.8, jobsDone: 142, earnings: 2840000, avgAcceptSec: 18 },
  });
  const p2 = await db.provider.create({
    data: { tenantId: t1.id, cityId: t1Delhi.id, name: "Anjali Verma", phone: "+919811100002", pinHash: hashPin("1234"), serviceIds: JSON.stringify([svcGrocery.id, svcParcel.id]), zone: "Lajpat Nagar", isOnline: true, rating: 4.9, jobsDone: 211, earnings: 4120000, avgAcceptSec: 12 },
  });
  await db.provider.create({
    data: { tenantId: t1.id, cityId: t1Jaipur.id, name: "Mahesh Kumar", phone: "+919811100003", pinHash: hashPin("1234"), serviceIds: JSON.stringify([svcCake.id, svcGrocery.id]), zone: "Vaishali Nagar", isOnline: false, rating: 4.6, jobsDone: 88, earnings: 1760000, avgAcceptSec: 24 },
  });
  const p4 = await db.provider.create({
    data: { tenantId: t2.id, cityId: t2Mumbai.id, name: "Sandeep Patil", phone: "+919822200001", pinHash: hashPin("1234"), serviceIds: JSON.stringify([svcRide.id]), zone: "Andheri West", isOnline: true, rating: 4.7, jobsDone: 305, earnings: 6100000, avgAcceptSec: 9 },
  });
  await db.provider.create({
    data: { tenantId: t2.id, cityId: t2Mumbai.id, name: "Ramesh Yadav", phone: "+919822200002", pinHash: hashPin("1234"), serviceIds: JSON.stringify([svcRepair.id]), zone: "Bandra", isOnline: true, rating: 4.9, jobsDone: 178, earnings: 3560000, avgAcceptSec: 22 },
  });

  // ── Customers ──
  const c1 = await db.customer.create({
    data: { tenantId: t1.id, phone: "+919833300001", name: "Aditya", language: "en", addresses: JSON.stringify([
      { label: "Jawahar Nagar", text: "12, Jawahar Nagar, Delhi - 110007", lat: 28.6862, lng: 77.2072, area: "Jawahar Nagar" },
      { label: "Office", text: "Connaught Place, Block A, Delhi", lat: 28.6315, lng: 77.2167, area: "Connaught Place" },
    ]), totalOrders: 14, lifetimeValue: 84000 },
  });
  const c2 = await db.customer.create({
    data: { tenantId: t1.id, phone: "+919833300002", name: "Sneha", language: "hi", totalOrders: 6, lifetimeValue: 32000 },
  });
  const c3 = await db.customer.create({
    data: { tenantId: t2.id, phone: "+919844400001", name: "Ravi", language: "en", totalOrders: 3, lifetimeValue: 18000 },
  });

  // ── Sample Orders ──
  const now = new Date();
  await db.order.create({
    data: {
      tenantId: t1.id, cityId: t1Delhi.id, customerId: c1.id, serviceId: svcGrocery.id, code: "1001", status: "delivered", kind: "order",
      items: JSON.stringify([{ name: "Basmati Rice 1kg", qty: 2 }, { name: "Toor Dal 500g", qty: 1 }, { name: "Sunflower Oil 1L", qty: 1 }]),
      timing: "Today evening", addressText: "12, Jawahar Nagar, Delhi - 110007", addressArea: "Jawahar Nagar", addressLat: 28.6862, addressLng: 77.2072,
      acceptedById: p1.id, acceptedAt: new Date(now.getTime() - 1000*60*60*26), pickedAt: new Date(now.getTime() - 1000*60*60*25), deliveredAt: new Date(now.getTime() - 1000*60*60*24),
      quoteAmount: 44000, source: "bot",
      activity: { create: [
        { tenantId: t1.id, actor: "bot", action: "created", detail: "Order created via WhatsApp" },
        { tenantId: t1.id, actor: "system", action: "broadcast", detail: "Broadcast to 2 providers" },
        { tenantId: t1.id, actor: `provider:${p1.id}`, action: "accepted", detail: "Accepted in 18s" },
        { tenantId: t1.id, actor: `provider:${p1.id}`, action: "picked", detail: "Picked up from store" },
        { tenantId: t1.id, actor: `provider:${p1.id}`, action: "delivered", detail: "Delivered to customer" },
      ]},
    },
  });
  await db.order.create({
    data: {
      tenantId: t1.id, cityId: t1Delhi.id, customerId: c2.id, serviceId: svcCake.id, code: "1002", status: "delivered", kind: "order",
      items: JSON.stringify([{ name: "Chocolate Truffle 500g", qty: 1, note: "Happy Birthday Riya" }]),
      preferredShop: "Bakers Junction", timing: "Tomorrow morning", addressText: "Lajpat Nagar, Delhi", addressArea: "Lajpat Nagar",
      acceptedById: p2.id, acceptedAt: new Date(now.getTime() - 1000*60*60*50), pickedAt: new Date(now.getTime() - 1000*60*60*48), deliveredAt: new Date(now.getTime() - 1000*60*60*47),
      quoteAmount: 65000, source: "bot",
    },
  });
  await db.order.create({
    data: {
      tenantId: t1.id, cityId: t1Delhi.id, customerId: c1.id, serviceId: svcGrocery.id, code: "1024", status: "broadcast", kind: "order",
      items: JSON.stringify([{ name: "Milk 1L", qty: 3 }, { name: "Bread", qty: 2 }, { name: "Eggs", qty: 12 }]),
      timing: "ASAP", addressText: "12, Jawahar Nagar, Delhi - 110007", addressArea: "Jawahar Nagar", source: "bot",
      broadcasts: { create: [{ providerId: p1.id, status: "pending" }, { providerId: p2.id, status: "pending" }] },
    },
  });
  await db.order.create({
    data: {
      tenantId: t1.id, cityId: t1Delhi.id, customerId: c2.id, serviceId: svcParcel.id, code: "1025", status: "escalated", kind: "order",
      items: JSON.stringify([{ name: "Documents envelope", qty: 1 }]),
      description: "Pickup from home, deliver to RK Puram office", timing: "Today evening",
      addressText: "Lajpat Nagar, Delhi", addressArea: "Lajpat Nagar", escalatedAt: new Date(now.getTime() - 1000*60*3), source: "bot",
    },
  });
  await db.order.create({
    data: {
      tenantId: t2.id, cityId: t2Mumbai.id, customerId: c3.id, serviceId: svcRide.id, code: "2001", status: "accepted", kind: "book",
      description: "Pickup Andheri station, drop Bandra Linking Road", timing: "Today 4-6pm",
      addressText: "Andheri Station West, Mumbai", addressArea: "Andheri West",
      acceptedById: p4.id, acceptedAt: new Date(now.getTime() - 1000*60*4), quoteAmount: 28000, source: "bot",
    },
  });

  await db.notificationSetting.create({ data: { tenantId: t1.id } });
  await db.notificationSetting.create({ data: { tenantId: t2.id } });

  console.log("✅ Seed complete.");
  console.log("   Tenant 1: Shanti Express (slug: shanti)");
  console.log("   Tenant 2: QuickFix Services (slug: quickfix)");
  console.log("   Super admin: super@cityhelp.app / super1234");
  console.log("   Provider PIN: 1234");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await db.$disconnect(); });
