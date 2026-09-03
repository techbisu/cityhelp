/**
 * CityHelp — AI execution layer
 *
 * For each AI task, looks up the tenant's configured AiProvider + model from AiTaskRoute,
 * decrypts the API key, calls the OpenAI-compatible endpoint via fetch(), logs usage
 * to AiUsageLog, and falls back gracefully on error.
 *
 * Tasks:
 *  - extract_grocery: text → item list (used for typed grocery lists)
 *  - read_photo: image URL/base64 → item list
 *  - transcribe_voice: audio URL/base64 → text
 *  - parse_loose: free text → normalized fields ("half kg" → 500g)
 *  - classify_custom: text → service classification
 *  - free_chat: conversation → response
 *
 * If no provider configured for a task → return null and the bot saves as custom order.
 * If provider errors → log to AiUsageLog with success=false, return null, bot falls back.
 *
 * Also exposes a z-ai-web-dev-sdk fallback for tenants who haven't configured their own key.
 */
import { db } from "./db";
import { decrypt } from "./crypto";
import { safeParse } from "./utils";

export interface AiTaskResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  usageCalls: number;
  usageTokens: number;
  providerLabel?: string;
  modelName?: string;
}

type TaskName = "extract_grocery" | "read_photo" | "transcribe_voice" | "parse_loose" | "classify_custom" | "free_chat";

/**
 * Run an AI task for a tenant.
 * Returns { ok: false } if not configured or failed — caller should fall back gracefully.
 */
export async function runAiTask<T = unknown>(
  tenantId: string,
  task: TaskName,
  input: { text?: string; imageUrl?: string; audioUrl?: string; history?: Array<{ role: string; content: string }> }
): Promise<AiTaskResult<T>> {
  const route = await db.aiTaskRoute.findUnique({
    where: { tenantId_task: { tenantId, task } },
    include: { provider: true },
  });

  // No route or no provider configured → graceful skip
  if (!route || !route.providerId || !route.provider) {
    return { ok: false, error: "not_configured", usageCalls: 0, usageTokens: 0 };
  }

  // Try primary provider
  const result = await callProvider<T>(route.provider, route.modelName || "gpt-4o-mini", task, input);
  if (result.ok) {
    await logUsage(tenantId, task, route.provider.label, route.modelName || "", result);
    // Increment usage counters
    await db.aiTaskRoute.update({
      where: { task },
      data: {
        usageCalls: { increment: 1 },
        usageTokens: { increment: result.usageTokens },
        usageToday: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
    return { ...result, providerLabel: route.provider.label, modelName: route.modelName };
  }

  // Try fallback provider if configured — separate lookup since relation isn't in schema
  if (route.fallbackProviderId && route.fallbackModel) {
    const fallbackProvider = await db.aiProvider.findUnique({
      where: { id: route.fallbackProviderId },
    });
    if (fallbackProvider) {
      const fallbackResult = await callProvider<T>(fallbackProvider, route.fallbackModel, task, input);
      if (fallbackResult.ok) {
        await logUsage(tenantId, task, fallbackProvider.label, route.fallbackModel, fallbackResult);
        return { ...fallbackResult, providerLabel: fallbackProvider.label, modelName: route.fallbackModel };
      }
    }
  }

  // Both failed → graceful degrade
  await logUsage(tenantId, task, route.provider.label, route.modelName || "", result);
  return result;
}

async function callProvider<T>(
  provider: { baseUrl: string; apiKeyCipher: string; supportsChat: boolean; supportsImage: boolean; supportsAudio: boolean },
  model: string,
  task: TaskName,
  input: { text?: string; imageUrl?: string; audioUrl?: string; history?: Array<{ role: string; content: string }> }
): Promise<AiTaskResult<T>> {
  let apiKey: string;
  try {
    apiKey = decrypt(provider.apiKeyCipher);
  } catch {
    return { ok: false, error: "decrypt_failed", usageCalls: 0, usageTokens: 0 };
  }

  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  // Build the system prompt + user content based on task
  const { systemPrompt, userContent } = buildPrompt(task, input);

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 800,
  };

  try {
    const start = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `http_${res.status}: ${errText.slice(0, 200)}`, usageCalls: 0, usageTokens: 0 };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const tokensIn = data.usage?.prompt_tokens || 0;
    const tokensOut = data.usage?.completion_tokens || 0;

    // Parse the structured response based on task
    const parsed = parseTaskResponse<T>(task, content);
    return {
      ok: true,
      data: parsed,
      usageCalls: 1,
      usageTokens: tokensIn + tokensOut,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch_failed", usageCalls: 0, usageTokens: 0 };
  }
}

function buildPrompt(task: TaskName, input: { text?: string; imageUrl?: string; audioUrl?: string; history?: Array<{ role: string; content: string }> }): { systemPrompt: string; userContent: string | Array<Record<string, unknown>> } {
  switch (task) {
    case "extract_grocery":
      return {
        systemPrompt: "You are a grocery list parser. Given free-text input, return a JSON array of items with name and qty fields. Normalize quantities ('half kg' → '500g', '2 packets' → '2'). Respond ONLY with the JSON array, no other text.",
        userContent: input.text || "",
      };
    case "read_photo":
      return {
        systemPrompt: "You are an OCR + extraction model for handwritten grocery lists. Read the image and return a JSON array of items with name and qty. Respond ONLY with the JSON array.",
        userContent: [
          { type: "text", text: "Read this grocery list and extract items as JSON array [{name, qty}]" },
          { type: "image_url", image_url: { url: input.imageUrl } },
        ],
      };
    case "transcribe_voice":
      return {
        systemPrompt: "Transcribe the audio accurately in the original language. Preserve item names, quantities, and any specific instructions. Respond ONLY with the transcript.",
        userContent: input.audioUrl ? `Audio URL: ${input.audioUrl}` : (input.text || ""),
      };
    case "parse_loose":
      return {
        systemPrompt: 'You normalize loose free-text answers into structured fields. Parse "half kg" → "500g", "tomorrow morning" → "tomorrow 9am-12pm". Return JSON.',
        userContent: input.text || "",
      };
    case "classify_custom":
      return {
        systemPrompt: "You classify incoming requests into one of: cake, grocery, chicken, parcel, ride, repair, team, custom. Return only the category name.",
        userContent: input.text || "",
      };
    case "free_chat":
      return {
        systemPrompt: "You are a helpful assistant for a local delivery/service business. Help the customer with their request.",
        userContent: input.text || "",
      };
  }
}

function parseTaskResponse<T>(task: TaskName, content: string): T {
  if (task === "extract_grocery" || task === "read_photo") {
    // Try to extract JSON array from the response
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        // fall through
      }
    }
    return [] as unknown as T;
  }
  if (task === "classify_custom") {
    const trimmed = content.trim().toLowerCase();
    const valid = ["cake", "grocery", "chicken", "parcel", "ride", "repair", "team", "custom"];
    const match = valid.find((v) => trimmed.includes(v));
    return (match || "custom") as unknown as T;
  }
  return content as unknown as T;
}

async function logUsage(
  tenantId: string,
  task: string,
  providerLabel: string,
  modelName: string,
  result: AiTaskResult
) {
  await db.aiUsageLog.create({
    data: {
      tenantId,
      task,
      providerLabel,
      modelName,
      tokensIn: 0,
      tokensOut: result.usageTokens,
      latencyMs: 0,
      success: result.ok,
      error: result.error || null,
    },
  });
}

// ── z-ai-web-dev-sdk fallback (used by super-admin demo tenant if no BYOK) ──
/**
 * If a tenant hasn't configured their own AI, we can optionally fall back to the
 * platform's z-ai-web-dev-sdk. This is opt-in per tenant via `tenant.allowPlatformAi`.
 * For now we keep it simple — only used for the demo tenant "shanti".
 */
export async function runPlatformAiFallback<T>(
  task: TaskName,
  input: { text?: string; imageUrl?: string }
): Promise<AiTaskResult<T>> {
  try {
    // Dynamic import — keep it server-only
    const ZAI = await import("z-ai-web-dev-sdk").catch(() => null);
    if (!ZAI || !ZAI.default) {
      return { ok: false, error: "platform_ai_unavailable", usageCalls: 0, usageTokens: 0 };
    }
    const zai = await ZAI.default.create();
    const { systemPrompt, userContent } = buildPrompt(task, input);
    const userText = typeof userContent === "string" ? userContent : input.text || "";
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });
    const content = completion.choices?.[0]?.message?.content || "";
    const parsed = parseTaskResponse<T>(task, content);
    return { ok: true, data: parsed, usageCalls: 1, usageTokens: 500 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "platform_ai_failed", usageCalls: 0, usageTokens: 0 };
  }
}
