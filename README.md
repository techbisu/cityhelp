# CityHelp

**Multi-tenant SaaS platform for WhatsApp-based local delivery/service businesses.**

Any local delivery or service business can offer WhatsApp-based ordering & booking across multiple cities, with a provider app for accepting jobs and a premium admin dashboard.

Built as ONE Next.js application: Tailwind + shadcn/ui, Prisma (SQLite for dev / Supabase target for production), web push notifications, dark-first premium ops aesthetic.

## Apps (all in one)

The app shell at `/` lets you switch between four roles:

1. **Customer WhatsApp Bot** — interactive phone-frame simulator of the customer experience (language pick → menu list → order/book flow → address → confirm). Demonstrates grocery accumulation via text/voice/photo, saved addresses, location pin reverse-geocoding, and the full deterministic state machine.
2. **Provider App (PWA)** — mobile-first provider experience with PIN login (lockout after 5 tries), onboarding wizard, full-screen incoming-call ring screen (pulsing concentric rings + 45s countdown + vibration), race-safe accept, job detail with Maps link + tap-to-call, custom requests inbox with quote sending, and manual job creation.
3. **Tenant Admin Dashboard** — premium ops dashboard with stat cards + sparklines, live orders feed, kanban board with drag-and-drop (drop on provider = manual assign), dense table view with filters, escalation center (one-click assign), providers CRUD, customers with block, services editor with preview chat, cities management, WhatsApp settings, AI BYOK configuration, team, notifications, and ⌘K command palette.
4. **Super Admin Console** — platform-wide view with tenants list (suspend/restore/impersonate), plans CRUD (changes apply live), usage & revenue (MRR/churn), filterable audit log, and platform health dashboard with the 14-point security checklist.

## Demo Credentials

| Role | Login | Password |
|------|-------|----------|
| Provider (any) | `+919811100001`, `+919811100002`, `+919822200001` | PIN `1234` |
| Tenant Admin | `owner@shanti.express` or `owner@quickfix.services` | `demo1234` |
| Super Admin | `super@cityhelp.app` | `super1234` |

## Architecture

### Multi-tenancy
Every entity carries a `tenantId`. The Prisma schema enforces cascade deletes and unique constraints per-tenant (`@@unique([tenantId, phone])`, `@@unique([tenantId, slug])`, etc.). All API routes require `tenantSlug` and resolve it to a tenant before any query — a tenant can NEVER access another tenant's data even by guessing IDs.

### Race-safe order acceptance
The accept endpoint uses a Prisma `$transaction` to atomically check the order's current status before flipping it to `accepted`. If another provider got there first, the second request gets HTTP 409 `already_taken`.

### Bot state machine
Customer conversations are tracked in a `BotSession` row keyed on `(tenantId, phone)`. The state machine walks: `language → menu → service_draft → shop → timing → address → confirm → done`. At any step, typing "cancel" or "menu" resets to menu. Old button taps politely re-show the current step. Voice/photo/free-text inputs that fail AI processing degrade gracefully to "saved as custom order for a human".

### AI BYOK
Each tenant configures their own OpenAI-compatible providers (OpenAI, Groq, DeepSeek, Mistral, OpenRouter, vLLM) with a label, base URL, and encrypted API key (AES-256-GCM). Task routing assigns a provider+model to each AI task (extract grocery, read photo, transcribe voice, parse loose, classify custom, free-chat) with an optional fallback. If no model is configured or the provider errors, the bot saves the input as a custom order — it never fails.

### Encryption at rest
All third-party keys (AI, WhatsApp, email) are encrypted with AES-256-GCM using a master key from `CITYHELP_MASTER_KEY` env var. Keys are masked to last 4 chars in the UI and never returned to the browser. Master-key rotation re-encrypts all keys.

## Tech Stack
- **Next.js 16** App Router (TypeScript)
- **Tailwind CSS 4** + shadcn/ui (New York style)
- **Prisma** ORM (SQLite dev, Postgres/Supabase production target)
- **Zustand** for shell state, **TanStack Query** patterns for server state
- **dnd-kit** for kanban drag-and-drop
- **Framer Motion** + custom CSS animations
- **Geist** font family, tabular numerals everywhere

## Database Schema

22 models covering: Plan, Tenant, City, Staff, SuperAdmin, Provider, Customer, Service, Order, OrderBroadcast, AiProvider, AiTaskRoute, AiUsageLog, BotSession, Activity, AuditLog, NotificationSetting.

Run `bun run scripts/seed.ts` to populate demo data (2 tenants, 5 providers, 6 customers, 5 sample orders, 3 plans, 1 super admin).

## Security Checklist (14 items — all implemented)

1. ✅ Webhook signature verification (HMAC X-Hub-Signature-256)
2. ✅ Duplicate webhook dedup (`waMessageId` unique on BotSession)
3. ✅ Hard tenant isolation at DB level (every query scoped by `tenantId`)
4. ✅ All keys encrypted at rest (AES-256-GCM), masked in UI, never in logs
5. ✅ Server-side input validation, rate-limited login & bot messages
6. ✅ Provider PIN: 5 tries → 15-minute lock; secure sessions
7. ✅ Security headers (CSP, no clickjacking), secrets in env only
8. ✅ Audit log of every sensitive action
9. ✅ Payment webhooks signature-verified & idempotent (Phase 2 hooks)
10. ✅ All mutations idempotent / race-safe (accept/assign via transactions)
11. ✅ PII: customer phone numbers, with tenant-level export/delete tools
12. ✅ `/api/health` endpoint + error tracking hook (Sentry-ready)
13. ✅ CI: ESLint fails on errors (no vulnerable deps in lockfile)
14. ✅ No secrets in client bundles (Next.js server-only imports)

## Out of Scope (Phase 2+)
Native mobile apps, drag-and-drop node-graph workflow builder, store catalogs & fixed pricing, UPI payments, promotional broadcasts, multi-language auto-translation. Design hooks are in place for all of these.
