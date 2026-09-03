/**
 * Vercel build hook — runs before the Next.js build.
 *
 * Steps:
 *   1. Generate Prisma client
 *   2. Run database migrations (safe — only applies pending)
 *   3. Run idempotent seed (safe — only creates missing records)
 *   4. Deploy Cloudflare Worker (realtime WebSocket service)
 *   5. Next.js build (handled by Vercel after this script)
 *
 * This is safe to run on every deploy. It will NOT:
 *   - Delete any data
 *   - Overwrite any existing records
 *   - Reset any passwords or PINs
 *
 * Configure in Vercel dashboard → Settings → Build Command:
 *   bun run scripts/vercel-build.ts && next build
 *
 * Required env vars (set in Vercel):
 *   DATABASE_URL               — Neon Postgres connection string
 *   CF_ACCOUNT_ID              — Cloudflare account ID
 *   CF_API_TOKEN               — Cloudflare API token (Workers deploy permission)
 *   BROADCAST_SECRET           — Shared secret for Worker broadcast auth
 *
 * If CF_ACCOUNT_ID or CF_API_TOKEN are not set, the Worker deploy is skipped
 * (the app still builds — realtime is optional, polling is the fallback).
 */
import { execSync } from "child_process";
import { existsSync } from "fs";

console.log("🚀 CityHelp Vercel build hook starting...");

// ── Step 1: Generate Prisma client ──
console.log("  → Generating Prisma client...");
execSync("bun run db:generate", { stdio: "inherit" });

// ── Step 2: Run migrations (safe — only applies pending) ──
console.log("  → Running database migrations...");
const dbUrl = process.env.DATABASE_URL || "";
if (dbUrl.startsWith("postgresql://")) {
  // Neon Postgres — use migrate deploy (safe, applies pending migrations only)
  try {
    execSync("bunx prisma migrate deploy", { stdio: "inherit" });
  } catch {
    console.log("  ⚠️  Migration skipped (may need to run: bunx prisma migrate dev --name init first)");
  }
} else {
  // SQLite (local) — db push
  execSync("bun run db:push", { stdio: "inherit" });
}

// ── Step 3: Idempotent seed (safe — only creates missing records) ──
console.log("  → Running idempotent seed...");
try {
  execSync("bun run scripts/seed-idempotent.ts", { stdio: "inherit" });
} catch {
  console.log("  ⚠️  Seed skipped (non-fatal)");
}

// ── Step 4: Deploy Cloudflare Worker (realtime WebSocket service) ──
const cfAccountId = process.env.CF_ACCOUNT_ID || "";
const cfApiToken = process.env.CF_API_TOKEN || "";
const broadcastSecret = process.env.BROADCAST_SECRET || "";

if (cfAccountId && cfApiToken) {
  console.log("  → Deploying Cloudflare Worker (realtime)...");

  // Set env vars for wrangler (non-interactive mode)
  const wranglerEnv = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: cfAccountId,
    CLOUDFLARE_API_TOKEN: cfApiToken,
  };

  try {
    // Install wrangler if not present
    if (!existsSync("./node_modules/.bin/wrangler")) {
      console.log("    → Installing wrangler...");
      execSync("bun add -d wrangler", { stdio: "inherit", env: wranglerEnv });
    }

    // Deploy the Worker
    // wrangler reads wrangler.toml from mini-services/realtime/
    // We pass the broadcast secret as a var (wrangler.toml has the placeholder)
    execSync(
      `bunx wrangler deploy mini-services/realtime/worker.ts ` +
      `--name cityhelp-realtime ` +
      `--compatibility-date 2024-09-25 ` +
      `--compatibility-flag nodejs_compat ` +
      `--var BROADCAST_SECRET:${broadcastSecret || "cityhelp-dev-broadcast-secret"}`,
      { stdio: "inherit", env: wranglerEnv, cwd: process.cwd() }
    );

    // Also deploy Durable Object migrations
    // wrangler handles DO migrations automatically on deploy when defined in wrangler.toml
    // But since we're using CLI flags instead of wrangler.toml, we need to use the toml
    execSync(
      `bunx wrangler deploy --config mini-services/realtime/wrangler.toml`,
      { stdio: "inherit", env: wranglerEnv, cwd: process.cwd() }
    );

    console.log("  ✅ Cloudflare Worker deployed");
  } catch (e) {
    console.log("  ⚠️  Cloudflare Worker deploy failed (non-fatal — app will use polling fallback)");
    console.log(`     Error: ${e instanceof Error ? e.message : String(e)}`);
  }
} else {
  console.log("  ⏭️  Cloudflare Worker deploy skipped (CF_ACCOUNT_ID or CF_API_TOKEN not set)");
  console.log("     The app will use polling fallback for real-time updates.");
  console.log("     To enable: set CF_ACCOUNT_ID and CF_API_TOKEN in Vercel env vars.");
}

console.log("✅ Build hook complete. Starting Next.js build...");
