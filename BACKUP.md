# CityHelp — Backup & Restore

## Backup Strategy

### Database (PostgreSQL on Supabase in production)

**Automated daily backups** (Supabase managed):
- Daily full snapshot at 02:00 UTC
- Point-in-time recovery (PITR) for up to 7 days
- 7-day retention on Free tier, 30-day on Pro

**Manual backup** (for migrations or before risky changes):
```bash
# Using pg_dump (Supabase connection string)
pg_dump "$DATABASE_URL" --format=custom --file=backup-$(date +%Y%m%d).dump

# Or via Supabase CLI
supabase db dump --data-only --file=backup-$(date +%Y%m%d).sql
```

**Storage backups** (media files):
- WhatsApp voice notes / photos are stored in Supabase Storage buckets
- Each bucket has versioning enabled
- Weekly sync to a secondary region for DR

### Encryption Keys

- `CITYHELP_MASTER_KEY` — encrypts all third-party API keys at rest. **STORE OFF-PLATFORM** (AWS Secrets Manager / Doppler / 1Password).
- `CITYHELP_SESSION_SECRET` — signs session cookies. Rotate quarterly.
- `WHATSAPP_APP_SECRET`, `RAZORPAY_*`, `VAPID_*` — store in secrets manager.

### Key Rotation Procedure

1. Generate new master key: `openssl rand -base64 32`
2. Run `bun run scripts/rotate-master-key.ts` (re-encrypts all `AiProvider.apiKeyCipher` rows)
3. Update `CITYHELP_MASTER_KEY` env var
4. Redeploy
5. Verify by testing AI task execution

## Restore Procedure

### Full database restore (PITR):
```bash
# 1. Create a new Supabase project (or use a fork)
# 2. Restore from snapshot via Supabase dashboard
#    OR via CLI:
supabase db restore --timestamp "2025-01-15T02:00:00Z"

# 3. Update DATABASE_URL to point to the restored project
# 4. Redeploy
# 5. Run smoke test: curl /api/health
```

### Single-table restore (accidental delete):
```bash
# 1. Dump the table from yesterday's backup
pg_dump "$DATABASE_URL_BACKUP" --table=Order --data-only --file=orders.sql
# 2. Restore into production
psql "$DATABASE_URL" < orders.sql
```

### Customer data restore (GDPR right-to-access):
- Use GET /api/customers/{id}/export to produce a JSON export
- For full restore, replay the export JSON back via a script

## Verification

After any restore:
1. `curl https://cityhelp.app/api/health` → should return `{"status":"ok"}`
2. Login as a provider, send a test message via the bot
3. Verify the last 10 orders are visible in the admin dashboard
4. Check Sentry for any new errors post-restore

## Retention

- Customer PII: retained per tenant's `retentionDays` setting (default 365 days)
- Order data: retained indefinitely for accounting (anonymized if customer is deleted)
- Audit logs: retained for 2 years
- AI usage logs: retained for 90 days
- Bot sessions: deleted after 30 days of inactivity

## Disaster Recovery (DR)

- RPO (Recovery Point Objective): 24 hours (daily backup)
- RTO (Recovery Time Objective): 4 hours
- Secondary region: ap-south-1 (Mumbai) for low-latency India access
- Failover procedure: documented in `runbooks/failover.md`
