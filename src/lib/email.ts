/**
 * CityHelp — Email module (Resend)
 *
 * If RESEND_API_KEY is not set, every function silently skips (returns { skipped: true }).
 * No email feature breaks the app.
 *
 * Templates are inline HTML strings — designed with the same dark-first visual
 * identity as the dashboard (zinc-950 canvas, emerald accent).
 *
 * Env: RESEND_API_KEY, RESEND_FROM_EMAIL (default "CityHelp <notifications@cityhelp.app>")
 *      For Pro tenants with custom domain: tenant.resendApiKeyMask + tenant.customEmailDomain
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "CityHelp <notifications@cityhelp.app>";

export function isEmailConfigured(): boolean {
  return !!RESEND_API_KEY;
}

interface EmailResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  messageId?: string;
}

async function sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  if (!isEmailConfigured()) {
    console.log(`[Email:skip] To: ${to} | Subject: ${subject}`);
    return { ok: false, skipped: true, reason: "resend_not_configured" } as EmailResult;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: JSON.stringify(data) };
    return { ok: true, messageId: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ── Templates ──────────────────────────────────────────

function emailShell(title: string, bodyHtml: string, accent: string = "#10b981"): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e4e4e7">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden">
        <tr><td style="padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.08);background:linear-gradient(135deg,rgba(16,185,129,0.08),transparent)">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.25);display:flex;align-items:center;justify-content:center">
              <span style="font-size:16px">🏙️</span>
            </div>
            <div>
              <div style="color:#fafafa;font-size:14px;font-weight:600">CityHelp</div>
              <div style="color:#71717a;font-size:11px">${title}</div>
            </div>
          </div>
        </td></tr>
        <tr><td style="padding:32px">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.2)">
          <div style="color:#52525b;font-size:11px;line-height:1.6">
            You're receiving this email because you enabled notifications in CityHelp.
            <br>Manage preferences in your dashboard → Settings → Notifications.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendEscalationEmail(to: string, tenantName: string, orderCode: string, area: string): Promise<EmailResult> {
  const html = emailShell(
    "Escalation alert",
    `<div style="margin-bottom:20px">
      <div style="display:inline-block;background:rgba(244,63,94,0.15);color:#fda4af;font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid rgba(244,63,94,0.25)">⚠ Escalated</div>
    </div>
    <h1 style="color:#fafafa;font-size:20px;margin:0 0 8px;font-weight:600">Order #${orderCode} needs your attention</h1>
    <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 24px">
      No provider accepted this order within 2 minutes. It's now in your escalation center.
      Assign manually from your dashboard.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:24px">
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0">Tenant</td><td style="color:#e4e4e7;font-size:13px;padding:4px 0;text-align:right">${tenantName}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0">Order</td><td style="color:#e4e4e7;font-size:13px;padding:4px 0;text-align:right">#${orderCode}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0">Area</td><td style="color:#e4e4e7;font-size:13px;padding:4px 0;text-align:right">${area}</td></tr>
    </table>
    <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://cityhelp.app"}/app" style="display:inline-block;background:#10b981;color:#0a0a0b;font-size:13px;font-weight:600;padding:10px 20px;border-radius:10px;text-decoration:none">Open escalation center →</a>`
  );
  return sendEmail(to, `⚠ Escalation: Order #${orderCode} — ${tenantName}`, html);
}

export async function sendDailyDigest(to: string, tenantName: string, stats: {
  ordersToday: number; revenueToday: number; avgAcceptSec: number; escalationRate: number;
  topProviders: Array<{ name: string; jobs: number; earnings: number }>;
}): Promise<EmailResult> {
  const html = emailShell(
    "Daily digest",
    `<h1 style="color:#fafafa;font-size:20px;margin:0 0 4px;font-weight:600">Today at ${tenantName}</h1>
    <p style="color:#71717a;font-size:13px;margin:0 0 24px">${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr>
        <td width="50%" style="padding-right:8px">
          <div style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px">
            <div style="color:#71717a;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Orders today</div>
            <div style="color:#fafafa;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:4px">${stats.ordersToday}</div>
          </div>
        </td>
        <td width="50%" style="padding-left:8px">
          <div style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px">
            <div style="color:#71717a;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Revenue</div>
            <div style="color:#fafafa;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:4px">₹${(stats.revenueToday / 100).toLocaleString("en-IN")}</div>
          </div>
        </td>
      </tr>
      <tr>
        <td width="50%" style="padding:8px 8px 0 0">
          <div style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px">
            <div style="color:#71717a;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Avg accept</div>
            <div style="color:#fafafa;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:4px">${stats.avgAcceptSec}s</div>
          </div>
        </td>
        <td width="50%" style="padding:8px 0 0 8px">
          <div style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px">
            <div style="color:#71717a;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Escalation rate</div>
            <div style="color:#fafafa;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:4px">${stats.escalationRate}%</div>
          </div>
        </td>
      </tr>
    </table>
    ${stats.topProviders.length > 0 ? `
    <h2 style="color:#a1a1aa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Top providers today</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden">
      ${stats.topProviders.map((p, i) => `
        <tr style="${i > 0 ? "border-top:1px solid rgba(255,255,255,0.04)" : ""}">
          <td style="padding:12px 16px;color:#e4e4e7;font-size:13px">${p.name}</td>
          <td style="padding:12px 16px;color:#71717a;font-size:12px;text-align:right">${p.jobs} jobs</td>
          <td style="padding:12px 16px;color:#10b981;font-size:13px;text-align:right;font-variant-numeric:tabular-nums">₹${(p.earnings / 100).toLocaleString("en-IN")}</td>
        </tr>
      `).join("")}
    </table>
    ` : ""}
    <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://cityhelp.app"}/app" style="display:inline-block;background:#10b981;color:#0a0a0b;font-size:13px;font-weight:600;padding:10px 20px;border-radius:10px;text-decoration:none;margin-top:24px">Open dashboard →</a>`
  );
  return sendEmail(to, `📊 Daily digest — ${tenantName}`, html);
}

export async function sendPlanLimitWarning(to: string, tenantName: string, plan: string, usage: { current: number; limit: number; percent: number; resource: string }): Promise<EmailResult> {
  const html = emailShell(
    "Plan limit warning",
    `<div style="margin-bottom:20px">
      <div style="display:inline-block;background:rgba(245,158,11,0.15);color:#fcd34d;font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid rgba(245,158,11,0.25)">${usage.percent >= 100 ? "⚠ Limit reached" : "⚠ 80% reached"}</div>
    </div>
    <h1 style="color:#fafafa;font-size:20px;margin:0 0 8px;font-weight:600">${usage.resource} usage at ${usage.percent}%</h1>
    <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 24px">
      Your <strong>${plan}</strong> plan allows <strong style="color:#e4e4e7">${usage.limit.toLocaleString()}</strong> ${usage.resource} per month.
      You've used <strong style="color:#e4e4e7">${usage.current.toLocaleString()}</strong> (${usage.percent}%).
      ${usage.percent >= 100 ? "New orders will be queued but you should upgrade to continue operating smoothly." : "Consider upgrading soon to avoid disruption."}
    </p>
    <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://cityhelp.app"}/app/billing" style="display:inline-block;background:#10b981;color:#0a0a0b;font-size:13px;font-weight:600;padding:10px 20px;border-radius:10px;text-decoration:none">Upgrade plan →</a>`
  );
  return sendEmail(to, `⚠ ${usage.resource} usage at ${usage.percent}% — ${tenantName}`, html);
}

export async function sendPaymentReceipt(to: string, tenantName: string, invoice: {
  invoiceNumber: string; amount: number; plan: string; period: string; paymentMethod: string;
}): Promise<EmailResult> {
  const html = emailShell(
    "Payment receipt",
    `<div style="margin-bottom:20px">
      <div style="display:inline-block;background:rgba(16,185,129,0.15);color:#6ee7b7;font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid rgba(16,185,129,0.25)">✓ Paid</div>
    </div>
    <h1 style="color:#fafafa;font-size:20px;margin:0 0 8px;font-weight:600">Receipt for ${tenantName}</h1>
    <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 24px">Thank you for your payment. Your subscription is active.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:24px">
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0">Invoice</td><td style="color:#e4e4e7;font-size:13px;padding:4px 0;text-align:right;font-family:monospace">${invoice.invoiceNumber}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0">Plan</td><td style="color:#e4e4e7;font-size:13px;padding:4px 0;text-align:right">${invoice.plan}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0">Period</td><td style="color:#e4e4e7;font-size:13px;padding:4px 0;text-align:right">${invoice.period}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0">Payment method</td><td style="color:#e4e4e7;font-size:13px;padding:4px 0;text-align:right">${invoice.paymentMethod}</td></tr>
      <tr><td colspan="2" style="padding:12px 0 4px"><hr style="border:none;border-top:1px solid rgba(255,255,255,0.08)"></td></tr>
      <tr><td style="color:#fafafa;font-size:14px;font-weight:600;padding:8px 0">Total paid</td><td style="color:#10b981;font-size:16px;font-weight:600;padding:8px 0;text-align:right;font-variant-numeric:tabular-nums">₹${(invoice.amount / 100).toLocaleString("en-IN")}</td></tr>
    </table>`
  );
  return sendEmail(to, `✓ Payment receipt — ${invoice.invoiceNumber}`, html);
}

export async function sendWeeklyReport(to: string, tenantName: string, report: {
  totalOrders: number; totalRevenue: number; avgRating: number; topProviders: Array<{ name: string; jobs: number }>;
}): Promise<EmailResult> {
  const html = emailShell(
    "Weekly report",
    `<h1 style="color:#fafafa;font-size:20px;margin:0 0 4px;font-weight:600">Your week with ${tenantName}</h1>
    <p style="color:#71717a;font-size:13px;margin:0 0 24px">${new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr>
        <td width="33%" style="padding-right:6px"><div style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px"><div style="color:#71717a;font-size:10px;text-transform:uppercase">Orders</div><div style="color:#fafafa;font-size:20px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums">${report.totalOrders}</div></div></td>
        <td width="33%" style="padding:0 6px"><div style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px"><div style="color:#71717a;font-size:10px;text-transform:uppercase">Revenue</div><div style="color:#fafafa;font-size:20px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums">₹${(report.totalRevenue / 100).toLocaleString("en-IN")}</div></div></td>
        <td width="33%" style="padding-left:6px"><div style="background:#0a0a0b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px"><div style="color:#71717a;font-size:10px;text-transform:uppercase">Avg rating</div><div style="color:#fafafa;font-size:20px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums">${report.avgRating.toFixed(1)}⭐</div></div></td>
      </tr>
    </table>`
  );
  return sendEmail(to, `📊 Weekly report — ${tenantName}`, html);
}
