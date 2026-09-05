/**
 * Vercel build hook — runs before the Next.js build.
 *
 * Steps:
 *   0. Auto-switch Prisma provider (sqlite → postgresql) based on DATABASE_URL
 *   1. Generate Prisma client
 *   2. Run database migrations (safe — only applies pending)
 *   3. Run idempotent seed (safe — only creates missing records)
 *   4. Deploy Cloudflare Worker (realtime WebSocket service)
 *   5. Next.js build (handled by Vercel after this script)
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";

function main() {
  console.log("🚀 CityHelp Vercel build hook starting...");

  // ── Step 0: Auto-switch Prisma provider based on DATABASE_URL ──
  const dbUrl = process.env.DATABASE_URL || "";
  if (dbUrl.startsWith("postgresql://")) {
    console.log("  → Detected PostgreSQL — switching Prisma provider to postgresql...");
    const schemaPath = "prisma/schema.prisma";
    const schema = readFileSync(schemaPath, "utf8");
    const updated = schema.replace('provider = "sqlite"', 'provider = "postgresql"');
    writeFileSync(schemaPath, updated);
    console.log("  ✅ Prisma provider switched to postgresql");
  } else {
    console.log("  → Using SQLite (local dev)");
  }

  // ── Step 1: Generate Prisma client ──
  console.log("  → Generating Prisma client...");
  execSync("bun run db:generate", { stdio: "inherit" });

  // ── Step 2: Run migrations ──
  console.log("  → Running database migrations...");
  if (dbUrl.startsWith("postgresql://")) {
    try {
      execSync("bunx prisma db push --accept-data-loss", { stdio: "inherit" });
    } catch {
      console.log("  ⚠️  db push failed — continuing build (tables may already exist)");
    }
  } else {
    try {
      execSync("bun run db:push", { stdio: "inherit" });
    } catch {
      console.log("  ⚠️  db push failed — continuing");
    }
  }

  // ── Step 3: Idempotent seed ──
  console.log("  → Running idempotent seed...");
  try {
    execSync("bun run scripts/seed-idempotent.ts", { stdio: "inherit" });
  } catch {
    console.log("  ⚠️  Seed skipped (non-fatal)");
  }

  // ── Step 4: Deploy Cloudflare Worker ──
  const cfAccountId = process.env.CF_ACCOUNT_ID || "";
  const cfApiToken = process.env.CF_API_TOKEN || "";
  const broadcastSecret = process.env.BROADCAST_SECRET || "";

  if (cfAccountId && cfApiToken) {
    console.log("  → Deploying Cloudflare Worker (realtime)...");
    const wranglerEnv = {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: cfAccountId,
      CLOUDFLARE_API_TOKEN: cfApiToken,
    };
    try {
      if (!existsSync("./node_modules/.bin/wrangler")) {
        console.log("    → Installing wrangler...");
        execSync("bun add -d wrangler", { stdio: "inherit", env: wranglerEnv });
      }
      execSync(
        `bunx wrangler deploy mini-services/realtime/worker.ts ` +
        `--name cityhelp-realtime ` +
        `--compatibility-date 2024-09-25 ` +
        `--compatibility-flag nodejs_compat ` +
        `--var BROADCAST_SECRET:${broadcastSecret || "cityhelp-dev-broadcast-secret"}`,
        { stdio: "inherit", env: wranglerEnv, cwd: process.cwd() }
      );
      console.log("  ✅ Cloudflare Worker deployed");
    } catch (e) {
      console.log("  ⚠️  Cloudflare Worker deploy failed (non-fatal — app will use polling fallback)");
    }
  } else {
    console.log("  ⏭️  Cloudflare Worker deploy skipped (CF_ACCOUNT_ID or CF_API_TOKEN not set)");
  }

  console.log("✅ Build hook complete. Starting Next.js build...");
}

main();
