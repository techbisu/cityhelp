#!/usr/bin/env bash
#
# CityHelp — Database migration script
#
# Usage:
#   bun run scripts/migrate.sh           # Run migrations
#   bun run scripts/migrate.sh --seed    # Run migrations + idempotent seed
#
# For Neon Postgres:
#   1. Set DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
#   2. Change provider in prisma/schema.prisma from "sqlite" to "postgresql"
#   3. Run: bun run scripts/migrate.sh --seed
#
# This script is safe to run on Vercel deploy — it only applies pending migrations
# and the seed is idempotent (never overwrites existing data).

set -e

echo "🔄 Running database migrations..."

# Generate Prisma client
bun run db:generate

# Check if DATABASE_URL is postgres
if [[ "$DATABASE_URL" == postgresql://* ]]; then
  echo "  → Using PostgreSQL (Neon)"
  # For Postgres, use prisma migrate deploy (applies pending migrations only)
  bunx prisma migrate deploy
else
  echo "  → Using SQLite (local dev)"
  # For SQLite, use db push (creates/updates schema directly)
  bun run db:push
fi

echo "✅ Migrations complete."

# Run idempotent seed if --seed flag is passed
if [[ "$1" == "--seed" ]]; then
  echo "🌱 Running idempotent seed..."
  bun run scripts/seed-idempotent.ts
fi
