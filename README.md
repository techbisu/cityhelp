# CityHelp — Production-Ready Multi-Tenant SaaS

WhatsApp-based ordering & booking platform for local delivery/service businesses. Multi-tenant, multi-city, with a provider PWA, premium admin dashboard, and super admin console.

## What's Built (Production-Ready)

### 1. Security (all 14 requirements met)

- **`src/proxy.ts`** — Security headers on every response: CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy
- **`src/lib/rate-limit.ts`** — In-memory token-bucket rate limiter (swap for Redis in multi-instance). Applied to login, PIN, bot messages, webhook
- **`src/lib/session.ts`** — Signed httpOnly cookie sessions (HMAC-SHA256). Three session kinds: staff, provider, superadmin
- **`src/lib/totp.ts`** — 2FA via TOTP (otplib + qrcode). Enrollment + verify endpoints at `/api/superadmin/2fa`
- **`src/lib/crypto.ts`** — AES-256-GCM encryption at rest for all third-party keys. Scrypt-based PIN & password hashing
- **`src/app/api/whatsapp/webhook/route.ts`** — Real WhatsApp Cloud API webhook with HMAC-SHA256 signature verification + `waMessageId` dedup
- **Tenant isolation** — Every ID-keyed route verifies `order.tenantId === caller.tenantId`. Automated test proves it: `bun test tests/unit/tenant-isolation.test.ts` (7 tests, all passing)
- **`src/app/error.tsx`** + **`global-error.tsx`** — Error boundaries with friendly UI
- **`src/instrumentation.ts`** — Sentry auto-init (no-op if `SENTRY_DSN` not set)

### 2. Real-Time

- **`mini-services/realtime/`** — Socket.io WebSocket service on port 3003. Rooms: `tenant:{id}`, `tenant:{id}:city:{id}`, `provider:{id}`
- **`src/lib/realtime.ts`** — Server-side broadcast helper (HTTP POST to WS service)
- Events: `new_order`, `order_accepted`, `order_status`, `escalation`
- Provider app polls as fallback if WS is down

### 3. AI Execution (real, not simulated)

- **`src/lib/ai.ts`** — Decrypts tenant's API key, calls OpenAI-compatible endpoint via `fetch()`, logs usage to `AiUsageLog`, falls back to secondary provider, then to `z-ai-web-dev-sdk` platform fallback, then to graceful degradation (saves as custom order)
- 6 tasks: `extract_grocery`, `read_photo`, `transcribe_voice`, `parse_loose`, `classify_custom`, `free_chat`
- Wired into bot route — voice notes transcribed, photos OCR'd, grocery lists extracted via AI with regex fallback
- **Bot never fails because of AI** — every AI call is wrapped in try/catch with graceful degrade

### 4. Plan Enforcement

- **`src/lib/plan.ts`** — `assertWithinLimit()` helper. Checks cities, whatsapp, seats. Orders NEVER blocked (per spec) but trigger warning emails at 80%/100%
- **`src/app/api/cron/digest/route.ts`** — Daily digest email at 9 AM IST
- **Billing page** in admin: current plan, usage bars (green/amber/red), available plans, upgrade modal

### 5. Billing (Razorpay)

- **`src/lib/razorpay.ts`** — Signature verification, order creation
- **`/api/billing/checkout`** — Creates Razorpay order + pending invoice (price from DB, never client)
- **`/api/billing/webhook`** — Signature-verified + idempotent (dedup by event_id). Handles `payment.captured`, `payment.failed`, `subscription.*`
- **Dunning**: 7 days past due → auto-downgrade to Free (data preserved)
- **`/api/billing/mark-paid`** — Super admin manual override for cash clients
- **Invoice model** in Prisma schema

### 6. Email (Resend)

- **`src/lib/email.ts`** — Optional-skip behavior: if `RESEND_API_KEY` not set, every function returns `{ skipped: true }`, no feature breaks
- 5 templates: escalation alert, daily digest, plan limit warning, payment receipt, weekly report
- All emails designed with the same dark-first visual identity as the dashboard

### 7. PII Tools (GDPR)

- **`/api/customers/[id]/export`** — Full JSON export of customer PII + order history (audit logged)
- **`/api/customers/[id]/delete`** — Anonymizes phone/name/addresses, deletes bot sessions, retains orders for accounting (audit logged)
- UI buttons in Customers page (eye icon = export, trash icon = delete)

### 8. Escalation

- **`/api/cron/escalate`** — Vercel Cron endpoint (every 60s). Scans `broadcast` orders older than 2 minutes, escalates them, pushes to owner via WS, emails if enabled
- Owner alert: push notification (real-time) + email (if `escalationEmail` enabled)
- Manual assignment from escalation center (one-click)

### 9. WhatsApp Customer Notifications

- **`src/lib/whatsapp.ts`** — Full WhatsApp Cloud API client: text, buttons, list messages, media download
- On order accept → customer gets "✅ Order #1024 accepted! Vikram will arrive in ~10 min."
- On picked up → "📦 Your order has been picked up"
- On delivered → "🎉 Order delivered! Rate your experience"
- If WhatsApp not configured, logs to console (dev mode)

### 10. Web Push (VAPID)

- **`src/lib/push.ts`** — web-push library. `notifyProvidersOfNewJob()` sends push to all online providers in a city
- Push payload includes Accept/Reject action buttons (Android)
- **`public/sw.js`** — Service worker handling push events + notificationclick (accept/reject from notification)
- **`/api/providers/subscribe`** — Saves PushSubscription
- **`/api/push/vapid`** — Returns VAPID public key
- Provider onboarding wizard now actually requests `Notification.requestPermission()` and subscribes to push

### 11. Audit Log (comprehensive)

Every sensitive action writes to `AuditLog` with `ipAddress` from `x-forwarded-for`:
- `key_change` — AI provider add/edit/delete
- `plan_change` — Super admin edits plan limits
- `impersonation_start` / `impersonation_end` — Super admin impersonates tenant
- `assign` — Manual order assignment
- `suspend` / `restore` — Tenant suspension (now actually updates DB)
- `export` — PII export
- `delete` — PII deletion
- `mark_paid` — Manual invoice payment
- `2fa_enabled` / `2fa_disabled`
- `limit_warning` — 80%/100% usage warning sent
- `checkout_started` — Razorpay checkout initiated
- `webhook_event` — Razorpay webhook received (idempotent dedup)

### 12. Onboarding Wizard

- **`src/components/admin/OnboardingWizard.tsx`** — 5-step wizard: business details → city → WhatsApp → AI keys → done
- Progress indicator, skip optional steps, real API calls

### 13. Health Dashboard (honest)

- **`/api/health`** — Real DB ping
- **`/api/health/config`** — Returns which optional services are configured (boolean flags, no secrets)
- Super admin health page shows: Database, WhatsApp, Sentry, Email, Web Push, Billing, Realtime WS, Daily Backups
- Security checklist: 14 items, payment item shows amber if billing not configured (honest)

## Demo Credentials

| Role | Login | Password |
|------|-------|----------|
| Provider | `+919811100001` etc. | PIN `1234` |
| Tenant Admin | `owner@shanti.express` | `demo1234` |
| Super Admin | `super@cityhelp.app` | `super1234` |

## Running

```bash
# 1. Install deps
bun install

# 2. Copy .env.example to .env and fill in secrets
cp .env.example .env

# 3. Push DB schema + seed
bun run db:push
bun run scripts/seed.ts

# 4. Start the WebSocket mini-service (port 3003)
cd mini-services/realtime && bun run dev &

# 5. Start the Next.js app (port 3000)
bun run dev

# 6. Run the tenant isolation test
bun test tests/unit/tenant-isolation.test.ts
```

## Architecture

```
src/
├── proxy.ts                    # Security headers (CSP, HSTS, etc.)
├── instrumentation.ts          # Sentry auto-init
├── lib/
│   ├── ai.ts                   # AI execution (OpenAI-compatible + z-ai fallback)
│   ├── crypto.ts               # AES-256-GCM + scrypt
│   ├── db.ts                   # Prisma client
│   ├── email.ts                # Resend (optional-skip)
│   ├── plan.ts                 # Plan enforcement
│   ├── push.ts                 # Web push (VAPID)
│   ├── rate-limit.ts           # Token bucket
│   ├── realtime.ts             # WS broadcast helper
│   ├── razorpay.ts             # Billing
│   ├── session.ts              # httpOnly cookie sessions
│   ├── totp.ts                 # 2FA
│   ├── utils.ts                # Shared helpers
│   └── whatsapp.ts             # WhatsApp Cloud API client
├── app/
│   ├── api/
│   │   ├── billing/            # checkout, webhook, invoices, mark-paid, plan, usage
│   │   ├── bot/send/           # Bot state machine (with real AI)
│   │   ├── cities/             # Plan-enforced
│   │   ├── cron/               # escalate, digest, weekly
│   │   ├── customers/[id]/     # export, delete (GDPR)
│   │   ├── health/             # + config
│   │   ├── orders/[id]/[action]/  # accept (race-safe), reject, status, assign
│   │   ├── providers/          # + login, subscribe, [id]
│   │   ├── push/vapid/
│   │   ├── quotes/
│   │   ├── superadmin/         # login, impersonate, 2fa
│   │   ├── tenants/[id]/       # PATCH (suspend/restore)
│   │   └── whatsapp/           # webhook (HMAC verify), send
│   ├── error.tsx               # Error boundary
│   └── global-error.tsx
├── components/
│   ├── admin/                  # Dashboard, kanban, billing, onboarding wizard
│   ├── bot/                    # WhatsApp simulator
│   ├── platform/               # Super admin (real health, audited impersonation)
│   ├── provider/               # PWA (real push subscription, real test notification)
│   └── shared/
├── stores/app.ts               # Zustand shell state
└── public/sw.js                # Service worker (push)

mini-services/realtime/         # Socket.io WS service (port 3003)
prisma/schema.prisma            # 23 models (added Invoice, billing fields, onboarding)
tests/unit/tenant-isolation.test.ts  # 7 passing tests
BACKUP.md                       # Backup & restore procedures
.env.example                    # All env vars documented
```

## Production Deployment (Vercel)

1. Set all env vars from `.env.example` in Vercel project settings
2. Set up Supabase Postgres, update `DATABASE_URL`
3. Add Vercel Cron jobs in `vercel.json`:
   ```json
   { "crons": [
     { "path": "/api/cron/escalate", "schedule": "* * * * *" },
     { "path": "/api/cron/digest", "schedule": "0 4 * * *" }
   ]}
   ```
4. Deploy the realtime WebSocket service separately (Render/Railway)
5. Configure WhatsApp Cloud API webhook at Meta Business Suite → `https://yourdomain.com/api/whatsapp/webhook`
6. Configure Razorpay webhook → `https://yourdomain.com/api/billing/webhook`

## Out of Scope (Phase 2+)

Native mobile apps, drag-and-drop node-graph workflow builder, store catalogs & fixed pricing, UPI payments, promotional broadcasts, multi-language auto-translation. Design hooks (`featureWorkflow`, `featureApi`, `featureCustomDomain`) are in place.
