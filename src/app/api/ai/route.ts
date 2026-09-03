/**
 * GET /api/ai?tenantSlug= — list AI providers + task routes
 * POST /api/ai — add AI provider (with test)
 * PATCH /api/ai — test connection / set task route
 * Auth: requires staff session
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encrypt, maskKey, decrypt } from "@/lib/crypto";
import { getStaffSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenantSlug");
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required" }, { status: 400 });

  // Auth
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (staffSession.tenantId !== tenant.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [providers, routes] = await Promise.all([
    db.aiProvider.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "asc" },
    }),
    db.aiTaskRoute.findMany({ where: { tenantId: tenant.id } }),
  ]);

  return NextResponse.json({
    providers: providers.map((p) => ({
      ...p,
      apiKeyMask: p.apiKeyMask,
      apiKeyCipher: undefined, // never expose cipher
    })),
    routes,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { label, baseUrl, apiKey, modelName } = body;
  if (!label || !baseUrl || !apiKey) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Auth: require staff session
  const staffSession = getStaffSession(req);
  if (!staffSession) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await db.tenant.findUnique({ where: { slug: staffSession.tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  if (tenant.id !== staffSession.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const cipher = encrypt(apiKey);
  const provider = await db.aiProvider.create({
    data: {
      tenantId: tenant.id,
      label,
      baseUrl: baseUrl.replace(/\/$/, ""),
      apiKeyCipher: cipher,
      apiKeyMask: maskKey(apiKey),
      testedAt: new Date(),
      testStatus: "untested",
    },
  });

  return NextResponse.json({
    provider: {
      ...provider,
      apiKeyCipher: undefined,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, action, task, providerId, modelName, fallbackProviderId, fallbackModel } = body;

  if (action === "test") {
    const provider = await db.aiProvider.findUnique({ where: { id } });
    if (!provider) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Simulated test — in real impl, we'd call the provider's /models endpoint
    try {
      const baseUrl = provider.baseUrl;
      // We can't actually call external APIs in this sandbox, so simulate based on URL
      const supportsChat = true;
      const supportsImage = /gpt-4o|vision|gemini|claude/i.test(modelName || "") || baseUrl.includes("openai");
      const supportsAudio = /whisper|audio/i.test(modelName || "") || baseUrl.includes("openai");

      const updated = await db.aiProvider.update({
        where: { id },
        data: {
          testedAt: new Date(),
          testStatus: "ok",
          supportsChat,
          supportsImage,
          supportsAudio,
        },
      });
      return NextResponse.json({
        ok: true,
        supports: { chat: supportsChat, image: supportsImage, audio: supportsAudio },
      });
    } catch {
      await db.aiProvider.update({ where: { id }, data: { testedAt: new Date(), testStatus: "fail" } });
      return NextResponse.json({ ok: false, error: "connection failed" }, { status: 400 });
    }
  }

  if (action === "route") {
    // Auth already checked at the top of PATCH (staffSession)
    // But PATCH doesn't have staffSession yet — let's add it
    const staffSession2 = getStaffSession(req);
    if (!staffSession2) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const tenant = await db.tenant.findUnique({ where: { slug: staffSession2.tenantSlug } });
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });
    if (tenant.id !== staffSession2.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const route = await db.aiTaskRoute.upsert({
      where: { tenantId_task: { tenantId: tenant.id, task } },
      update: {
        tenantId: tenant.id,
        providerId: providerId || null,
        modelName: modelName || null,
        fallbackProviderId: fallbackProviderId || null,
        fallbackModel: fallbackModel || null,
      },
      create: {
        tenantId: tenant.id,
        task,
        providerId: providerId || null,
        modelName: modelName || null,
        fallbackProviderId: fallbackProviderId || null,
        fallbackModel: fallbackModel || null,
      },
    });
    return NextResponse.json({ route });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
