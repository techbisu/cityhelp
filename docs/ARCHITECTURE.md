# CityHelp — Architecture & Feature Documentation

## 1. WhatsApp Interactive Templates

### What we use now

CityHelp uses **WhatsApp Cloud API's free-form interactive messages** (buttons and lists). These do NOT require pre-approval from Meta — they work immediately when a business has a verified WhatsApp Business number.

### Message types used

| Type | When | Template needed? | Approval needed? |
|------|------|------------------|------------------|
| **Text message** | Bot replies, status updates | No | No |
| **Interactive buttons** | Language pick, confirm, charges agree, payment request, quote accept/decline, rating | No | No |
| **Interactive list** | Main service menu | No | No |
| **Location request** | Asking for address | No | No |

### When you DO need a pre-approved template

WhatsApp requires pre-approved **message templates** ONLY for:

1. **Outbound messages to customers who haven't messaged you in the last 24 hours** (the "24-hour customer service window")
2. **Automated notifications sent outside the conversation flow** (e.g., promotional broadcasts)

### Current approach (no templates needed)

All bot messages are sent within the **24-hour customer service window** (the customer initiated the conversation by messaging the business). This means free-form text, buttons, and lists all work without template approval.

If the business needs to send a message >24h after the customer's last message, they need either:
- The customer to message again first (resetting the 24h window), OR
- A pre-approved template for that notification

**Status updates** (accepted/picked/delivered) are sent immediately after the customer's last message (they just placed an order), so they're within the 24h window. No templates needed for the current flow.

### Templates CityHelp would need in Phase 2

| Template name | Purpose | When |
|---------------|---------|------|
| `order_status_update` | Status change notification | If sending >24h after last customer message |
| `payment_reminder` | Payment pending reminder | 1 hour after payment request with no payment |
| `daily_digest` | Daily order summary | Daily at 9 AM for business owners |

### How to create a template (when needed)

1. Meta Business Suite → WhatsApp Manager → Message Templates
2. Create template with parameters: `Your order #{{1}} has been {{2}}`
3. Submit for review (1-48 hours)
4. Once approved, send via API with parameters

---

## 2. When Email Is Needed

### Email triggers

| Trigger | When | Condition | Template |
|---------|------|-----------|----------|
| **Escalation alert** | Order not accepted in 2 min | `escalationEmail=true` AND `plan.featureEmail=true` AND `RESEND_API_KEY` set | `sendEscalationEmail()` |
| **Daily digest** | 9 AM IST daily | `dailyDigest=true` AND `plan.featureEmail=true` | `sendDailyDigest()` |
| **Plan limit warning** | 80% or 100% of monthly limit | `limitWarning=true` AND `plan.featureEmail=true` | `sendPlanLimitWarning()` |
| **Payment receipt** | Razorpay payment captured | Razorpay webhook fires | `sendPaymentReceipt()` |
| **Weekly report** | Monday 9 AM IST | `weeklyReport=true` AND `plan.featureEmail=true` | `sendWeeklyReport()` |

### Graceful degradation

- No `RESEND_API_KEY` → all emails silently skip, nothing breaks
- Plan without `featureEmail` → emails skip (Free/Starter plans)
- Email is ONLY for business owners/staff — never for customers (they use WhatsApp)

---

## 3. How the PWA App Works Like a Calling Ringtone

### Detection (how the provider knows there's a job)

```
New order → broadcast to matching providers
    ↓
Two parallel channels:
    ├─ WebSocket push (Cloudflare Worker → Durable Object → provider's WS)
    │   └─ Instant (<100ms) if connected
    └─ Polling fallback (every 5s → GET /api/providers/[id]/incoming)
        └─ Queries OrderBroadcast table
```

### The Ring Screen

Full-screen takeover with:
- **Pulsing concentric rings** — 3 CSS animated circles (scale 0.8× → 2.4×, opacity 70% → 0%, staggered delays)
- **45-second countdown** — turns red below 10s, auto-rejects at 0
- **Giant Accept (emerald, 80px, glow shadow)** / **Reject (rose, 64px)** buttons
- **Dark gradient background** (zinc-950 → black)

### Audio (ringtone)

- **App open**: `navigator.vibrate([400,200,400,200,400])` loops every 1.5s
- **App closed/backgrounded**: Web Push notification with `urgency: "high"` triggers:
  - Phone's default notification sound
  - Vibration pattern
  - Persistent notification (stays until tapped)
  - Action buttons: "✅ Accept" / "❌ Reject" (Android)
- **Custom ringtone** (future): `new Audio("/sounds/ringtone.mp3").play()` — works after user grants notification permission (counts as interaction for autoplay policy)

### Platform support

| Feature | Android Chrome | iOS Safari | Desktop |
|---------|---------------|------------|---------|
| Vibration | Full | Not supported | Not supported |
| Push notification sound | Default tone | Default tone | Browser notification sound |
| Notification actions | Accept/Reject buttons | Tap to open | Accept/Reject buttons |
| Full-screen ring | Yes | Yes | Yes |
| PWA install | Yes | Yes | N/A |

### Race-safe accept

1. Provider taps Accept → `POST /api/orders/[id]/accept`
2. Prisma `$transaction`: re-reads status, flips to `accepted` only if still `broadcast`
3. If another provider got there first: `409 already_taken` → "Already taken" toast
4. Customer gets WhatsApp confirmation
5. Other providers: WebSocket `order_accepted` event → their ring screens close

### PWA installation

- Service worker (`public/sw.js`) registered on every page load
- Android Chrome: "Add to Home Screen" prompt
- iOS Safari: Share → Add to Home Screen
- Opens fullscreen, own app icon, appears in app switcher
