/**
 * Vercel build hook — runs before the Next.js build.
 *
 * 1. Generates Prisma client
 * 2. Runs database migrations (safe — only applies pending migrations)
 * 3. Runs idempotent seed (safe — only creates records that don't exist)
 *
 * This is safe to run on every deploy. It will NOT:
 *   - Delete any data
 *   - Overwrite any existing records
 *   - Reset any passwords or PINs
 *
 * Configure in vercel.json or Vercel dashboard → Settings → Build Command:
 *   bun run scripts/vercel-build.ts && next build
 */
import { execSync } from "child_process";

console.log("🚀 CityHelp Vercel build hook starting...");

// Step 1: Generate Prisma client
console.log("  → Generating Prisma client...");
execSync("bun run db:generate", { stdio: "inherit" });

// Step 2: Run migrations (safe — only applies pending)
console.log("  → Running database migrations...");
const dbUrl = process.env.DATABASE_URL || "";
if (dbUrl.startsWith("postgresql://")) {
  // Neon Postgres — use migrate deploy (safe, applies pending migrations only)
  try {
    execSync("bunx prisma migrate deploy", { stdio: "inherit" });
  } catch (e) {
    console.log("  ⚠️  Migration skipped (may need to run: bunx prisma migrate dev --name init first)");
  }
} else {
  // SQLite (local) — db push
  execSync("bun run db:push", { stdio: "inherit" });
}

// Step 3: Idempotent seed (safe — only creates missing records)
console.log("  → Running idempotent seed...");
try {
  execSync("bun run scripts/seed-idempotent.ts", { stdio: "inherit" });
} catch (e) {
  console.log("  ⚠️  Seed skipped (non-fatal)");
}

console.log("✅ Build hook complete. Starting Next.js build...");
