"use client";

import { useEffect, useState, useCallback } from "react";
import { useApp } from "@/stores/app";
import { cn, formatINR, timeAgo, formatDuration, mapsLink, safeParse, ORDER_STATUS } from "@/lib/utils";
import { ArrowLeft, Phone, PhoneOff, Check, X, Package, MapPin, Plus, History, Bell, Battery, Volume2, Settings, ChevronRight, Clock, Star } from "lucide-react";
import { toast } from "sonner";

interface ProviderInfo {
  id: string;
  name: string;
  phone: string;
  tenantSlug: string;
  tenantName: string;
  tenantAccent: string;
  cityId: string;
  cityName: string;
  zone: string;
  isOnline: boolean;
  rating: number;
  jobsDone: number;
  earnings: number;
}

interface OrderItem { name: string; qty?: string | number }

interface Job {
  id: string;
  code: string;
  status: string;
  kind: string;
  items: string;
  description: string | null;
  preferredShop: string | null;
  timing: string | null;
  addressText: string | null;
  addressArea: string | null;
  addressLat: number | null;
  addressLng: number | null;
  customer: { name: string | null; phone: string; language: string };
  service: { id: string; icon: string; key: string; labels: string; defaultDeliveryCharge?: number | null; defaultServiceCharge?: number | null } | null;
  city: { name: string };
  acceptedBy: { name: string; phone: string; zone: string } | null;
  quoteAmount: number | null;
  // charges
  deliveryCharge: number | null;
  serviceCharge: number | null;
  addonsCharge: number | null;
  itemsTotal: number | null;
  totalAmount: number | null;
  chargesConfirmed: boolean;
  deliveredAt: string | null;
  // payments
  paymentAmount: number | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  paymentRequestedAt: string | null;
  upiPaymentLink: string | null;
  createdAt: string;
  acceptedAt: string | null;
}

export function ProviderApp() {
  const setView = useApp((s) => s.setView);
  const providerId = useApp((s) => s.providerId);
  const providerTenantSlug = useApp((s) => s.providerTenantSlug);
  const setProvider = useApp((s) => s.setProvider);
  const clearProvider = useApp((s) => s.clearProvider);

  const [provider, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [pastJobs, setPastJobs] = useState<Job[]>([]);
  const [customRequests, setCustomRequests] = useState<Job[]>([]);
  const [incomingJob, setIncomingJob] = useState<Job | null>(null);
  const [view, setLocalView] = useState<"home" | "job" | "custom" | "new" | "history" | "onboard" | "settings">("home");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Login form state
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // ── If logged in, fetch provider info ─────────────────
  const refresh = useCallback(async () => {
    if (!providerId) return;
    const res = await fetch(`/api/providers/${providerId}?jobs=true`);
    if (!res.ok) {
      clearProvider();
      return;
    }
    const data = await res.json();
    // Map tenant relation fields to flat fields expected by the provider state
    const p = data.provider;
    const tenantData = p.tenant || {};
    setProviderInfo({
      ...p,
      tenantSlug: tenantData.slug || p.tenantSlug,
      tenantName: tenantData.name || p.tenantName,
      tenantAccent: tenantData.accentColor || p.tenantAccent,
      cityName: p.city?.name || p.cityName,
    });
    setActiveJobs(data.activeJobs);
    setPastJobs(data.pastJobs);
    setCustomRequests(data.customRequests);
  }, [providerId, clearProvider]);

  useEffect(() => {
    if (providerId) {
      refresh();
      const id = setInterval(refresh, 4000);
      return () => clearInterval(id);
    }
  }, [providerId, refresh]);

  // ── Poll for incoming broadcast jobs (uses dedicated /incoming endpoint) ──
  useEffect(() => {
    if (!provider || !provider.isOnline) return;
    let cancelled = false;
    async function checkIncoming() {
      if (cancelled || !provider) return;
      try {
        // Use the dedicated /incoming endpoint — queries OrderBroadcast for this provider only
        const res = await fetch(`/api/providers/${provider.id}/incoming`);
        if (!res.ok) return;
        const data = await res.json();
        const myBroadcasts = (data.jobs || []) as Job[];
        if (myBroadcasts.length > 0 && !incomingJob) {
          setIncomingJob(myBroadcasts[0]);
        }
      } catch {
        // silent
      }
    }
    checkIncoming();
    const id = setInterval(checkIncoming, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [provider, incomingJob]);

  // ── Login ─────────────────────────────────────────────
  async function handleLogin() {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/providers/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug: providerTenantSlug || "shanti", phone: loginPhone, pin: loginPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.message || data.error || "Login failed");
        return;
      }
      setProvider(data.provider.id, data.provider.tenantSlug);
      setProviderInfo(data.provider);
      setLocalView("onboard");
    } finally {
      setLoginLoading(false);
    }
  }

  async function toggleOnline() {
    if (!provider) return;
    const newOnline = !provider.isOnline;
    await fetch("/api/providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: provider.id, isOnline: newOnline }),
    });
    setProviderInfo({ ...provider, isOnline: newOnline });
    if (newOnline) toast.success("You're now online — ready to receive jobs");
    else toast.info("You're now offline");
  }

  async function handleAccept() {
    if (!incomingJob || !provider) return;
    const res = await fetch(`/api/orders/${incomingJob.id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: provider.id }),
    });
    const data = await res.json();
    if (res.status === 409) {
      toast.error("Already taken by another provider");
      setIncomingJob(null);
      return;
    }
    toast.success(`✅ Order #${incomingJob.code} accepted!`);
    setIncomingJob(null);
    refresh();
  }

  function handleReject() {
    if (!incomingJob || !provider) return;
    fetch(`/api/orders/${incomingJob.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: provider.id }),
    });
    toast.info("Rejected — waiting for next job");
    setIncomingJob(null);
  }

  async function updateJobStatus(job: Job, status: "picked" | "delivered") {
    await fetch(`/api/orders/${job.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, providerId: provider?.id }),
    });
    toast.success(status === "picked" ? "📦 Marked as picked up" : "✅ Marked as delivered");
    refresh();
    setSelectedJob(null);
    setLocalView("home");
  }

  // ── Render: login screen ──────────────────────────────
  if (!providerId || !provider) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <button
            onClick={() => setView("home")}
            className="text-muted-foreground hover:text-foreground text-sm mb-6 flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
              <Package className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold">Provider Login</h1>
            <p className="text-xs text-muted-foreground mt-1">Enter your phone and 4-digit PIN</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Phone</label>
              <input
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
                className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-500/40"
                placeholder="+91..."
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">4-digit PIN</label>
              <input
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value)}
                maxLength={4}
                inputMode="numeric"
                className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm tracking-[0.5em] outline-none focus:border-emerald-500/40 font-mono"
                placeholder="••••"
              />
            </div>
            {loginError && (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
                {loginError}
              </div>
            )}
            <button
              onClick={handleLogin}
              disabled={loginLoading || !loginPhone || !loginPin}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              {loginLoading ? "Signing in…" : "Sign in"}
            </button>
          </div>

          <div className="mt-6 p-3 rounded-xl bg-card/60 border border-border/60 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Demo providers</p>
            <p>+919811100001 · +919811100002 · +919822200001</p>
            <p className="mt-1">PIN: <span className="font-mono">1234</span></p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: onboarding ────────────────────────────────
  if (view === "onboard") {
    return <ProviderOnboarding provider={provider} onDone={() => setLocalView("home")} />;
  }

  // ── Render: incoming call screen (full-screen takeover) ─
  if (incomingJob) {
    return <IncomingCallScreen job={incomingJob} onAccept={handleAccept} onReject={handleReject} />;
  }

  // ── Render: job detail ────────────────────────────────
  if (view === "job" && selectedJob) {
    return (
      <JobDetail
        job={selectedJob}
        provider={provider}
        onBack={() => { setLocalView("home"); setSelectedJob(null); }}
        onUpdate={(s) => updateJobStatus(selectedJob, s)}
        refresh={refresh}
      />
    );
  }

  // ── Render: new manual job ────────────────────────────
  if (view === "new") {
    return (
      <NewJobScreen
        provider={provider}
        onBack={() => setLocalView("home")}
        onCreated={() => { setLocalView("home"); refresh(); }}
      />
    );
  }

  if (view === "history") {
    return <HistoryScreen jobs={pastJobs} onBack={() => setLocalView("home")} />;
  }

  if (view === "settings") {
    return <ProviderSettings provider={provider} onBack={() => setLocalView("home")} />;
  }

  if (view === "custom") {
    return <CustomRequestsScreen jobs={customRequests} provider={provider} onBack={() => setLocalView("home")} onSent={() => { setLocalView("home"); refresh(); }} />;
  }

  // ── Render: home ──────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header — shows tenant branding */}
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center justify-between">
          <button onClick={() => setView("home")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            {/* Tenant logo or initials */}
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ backgroundColor: `${provider.tenantAccent || "#10b981"}20`, color: provider.tenantAccent || "#10b981", border: `1px solid ${provider.tenantAccent || "#10b981"}30` }}
            >
              {provider.tenantName?.charAt(0) || "C"}
            </div>
            <div className="text-center">
              <p className="text-[11px] text-muted-foreground leading-none">{provider.tenantName}</p>
              <p className="text-xs font-medium mt-0.5">{provider.cityName} · {provider.zone}</p>
            </div>
          </div>
          <button onClick={() => clearProvider()} className="text-muted-foreground hover:text-foreground text-xs">
            Logout
          </button>
        </div>
      </header>

      <div className="px-4 py-5 space-y-5 max-w-md mx-auto">
        {/* Online toggle */}
        <div className={cn(
          "rounded-2xl p-5 border transition-colors",
          provider.isOnline ? "bg-emerald-500/10 border-emerald-500/30" : "bg-card border-border"
        )}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</p>
              <p className={cn("text-lg font-semibold mt-0.5", provider.isOnline ? "text-emerald-300" : "text-zinc-400")}>
                {provider.isOnline ? "Online" : "Offline"}
              </p>
            </div>
            <button
              onClick={toggleOnline}
              className={cn(
                "relative w-14 h-8 rounded-full transition-colors",
                provider.isOnline ? "bg-emerald-500" : "bg-zinc-700"
              )}
              aria-label="Toggle online"
            >
              <span className={cn(
                "absolute top-1 w-6 h-6 rounded-full bg-white transition-transform",
                provider.isOnline ? "translate-x-7" : "translate-x-1"
              )} />
            </button>
          </div>
          {provider.isOnline && (
            <p className="text-xs text-emerald-300/80 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
              Listening for jobs in {provider.zone}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <StatBox label="Today" value={String(activeJobs.length)} />
          <StatBox label="Total jobs" value={String(provider.jobsDone)} />
          <StatBox label="Earnings" value={formatINR(provider.earnings)} />
        </div>

        {/* Rating */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span className="text-sm font-medium">{provider.rating.toFixed(1)}</span>
            <span className="text-xs text-muted-foreground">rating</span>
          </div>
          <span className="text-xs text-muted-foreground">Avg accept: {formatDuration(18)}</span>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-4 gap-2">
          <QuickAction icon={Plus} label="New job" onClick={() => setLocalView("new")} />
          <QuickAction icon={Bell} label="Requests" badge={customRequests.length} onClick={() => setLocalView("custom")} />
          <QuickAction icon={History} label="History" onClick={() => setLocalView("history")} />
          <QuickAction icon={Settings} label="Settings" onClick={() => setLocalView("settings")} />
        </div>

        {/* Active jobs */}
        <div>
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Active jobs</h3>
          {activeJobs.length === 0 ? (
            <EmptyState icon={Package} title="No active jobs" desc="New jobs will appear here" />
          ) : (
            <div className="space-y-2">
              {activeJobs.map((job) => (
                <JobCard key={job.id} job={job} onClick={() => { setSelectedJob(job); setLocalView("job"); }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl bg-card border border-border">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tnum mt-0.5">{value}</p>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick, badge }: { icon: typeof Plus; label: string; onClick: () => void; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className="relative p-3 rounded-xl bg-card border border-border hover:border-emerald-500/30 transition-colors flex flex-col items-center gap-1.5"
    >
      <Icon className="w-5 h-5 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {badge && badge > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 text-zinc-950 text-[10px] font-semibold flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}

function EmptyState({ icon: Icon, title, desc }: { icon: typeof Plus; title: string; desc: string }) {
  return (
    <div className="p-6 rounded-xl border border-dashed border-border/60 text-center">
      <Icon className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-50" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
    </div>
  );
}

function JobCard({ job, onClick }: { job: Job; onClick: () => void }) {
  const items = safeParse<OrderItem[]>(job.items, []);
  const labels = job.service ? safeParse<Record<string, string>>(job.service.labels, {}) : {};
  const svcName = job.service ? `${job.service.icon} ${labels.en || job.service.key}` : "Order";
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-xl bg-card border border-border hover:border-emerald-500/30 transition-colors"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium">#{job.code}</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", ORDER_STATUS[job.status as keyof typeof ORDER_STATUS]?.bg, ORDER_STATUS[job.status as keyof typeof ORDER_STATUS]?.color)}>
          {ORDER_STATUS[job.status as keyof typeof ORDER_STATUS]?.label || job.status}
        </span>
      </div>
      <p className="text-sm font-medium mb-1">{svcName}</p>
      {items.length > 0 && <p className="text-xs text-muted-foreground">{items.length} item(s) · {items[0]?.name}…</p>}
      {job.description && <p className="text-xs text-muted-foreground truncate">{job.description}</p>}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
          <MapPin className="w-3 h-3" /> {job.addressArea || "—"}
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </button>
  );
}

function IncomingCallScreen({ job, onAccept, onReject }: { job: Job; onAccept: () => void; onReject: () => void }) {
  const [seconds, setSeconds] = useState(45);
  const items = safeParse<OrderItem[]>(job.items, []);
  const labels = job.service ? safeParse<Record<string, string>>(job.service.labels, {}) : {};
  const svcName = job.service ? `${job.service.icon} ${labels.en || job.service.key}` : "New Job";

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(id);
          onReject();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [onReject]);

  // Vibrate if supported
  useEffect(() => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([400, 200, 400, 200, 400]);
      const id = setInterval(() => navigator.vibrate([400, 200, 400, 200, 400]), 1500);
      return () => clearInterval(id);
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black flex flex-col items-center justify-between p-6 overflow-hidden">
      {/* Pulsing rings background */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute w-64 h-64 rounded-full border-2 border-emerald-500/40 animate-ring-pulse" />
        <div className="absolute w-64 h-64 rounded-full border-2 border-emerald-500/40 animate-ring-pulse-2" />
        <div className="absolute w-64 h-64 rounded-full border-2 border-emerald-500/40 animate-ring-pulse-3" />
      </div>

      {/* Top: caller info */}
      <div className="relative z-10 text-center pt-8">
        <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-400 mb-2">Incoming Job</p>
        <h1 className="text-3xl font-bold text-white mb-1">{svcName}</h1>
        <p className="text-zinc-400 text-sm">Order #{job.code} · {job.city.name}</p>
        <p className="text-zinc-500 text-xs mt-2">
          {job.customer.name || job.customer.phone}
        </p>
      </div>

      {/* Middle: job summary */}
      <div className="relative z-10 w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 space-y-2 animate-scale-in">
        {items.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Items</p>
            <p className="text-sm text-white">
              {items.slice(0, 3).map((it) => it.name).join(", ")}
              {items.length > 3 && ` +${items.length - 3} more`}
            </p>
          </div>
        )}
        {job.description && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Description</p>
            <p className="text-sm text-white line-clamp-2">{job.description}</p>
          </div>
        )}
        <div className="flex gap-3">
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Address</p>
            <p className="text-sm text-white">{job.addressArea || job.addressText || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Timing</p>
            <p className="text-sm text-white">{job.timing || "ASAP"}</p>
          </div>
        </div>
      </div>

      {/* Bottom: countdown + actions */}
      <div className="relative z-10 w-full max-w-sm space-y-4 pb-4">
        <div className="text-center">
          <p className="text-[11px] text-zinc-500 mb-1">Auto-reject in</p>
          <p className={cn("text-2xl font-bold tnum", seconds < 10 ? "text-rose-400" : "text-white")}>
            {seconds}s
          </p>
        </div>

        <div className="flex items-center justify-center gap-8">
          <button
            onClick={onReject}
            className="flex flex-col items-center gap-2 group"
            aria-label="Reject"
          >
            <div className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-400 flex items-center justify-center transition-colors group-active:scale-95">
              <PhoneOff className="w-7 h-7 text-white" />
            </div>
            <span className="text-xs text-zinc-400">Reject</span>
          </button>

          <button
            onClick={onAccept}
            className="flex flex-col items-center gap-2 group"
            aria-label="Accept"
          >
            <div className="w-20 h-20 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center transition-colors group-active:scale-95 shadow-[0_0_30px_rgba(16,185,129,0.4)]">
              <Check className="w-9 h-9 text-zinc-950" strokeWidth={3} />
            </div>
            <span className="text-xs text-emerald-300 font-medium">Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function JobDetail({ job, onBack, onUpdate, provider, refresh }: { job: Job; onBack: () => void; onUpdate: (s: "picked" | "delivered") => void; provider: ProviderInfo | null; refresh?: () => void }) {
  const items = safeParse<OrderItem[]>(job.items, []);
  const labels = job.service ? safeParse<Record<string, string>>(job.service.labels, {}) : {};
  const svcName = job.service ? `${job.service.icon} ${labels.en || job.service.key}` : "Order";
  const [paymentModal, setPaymentModal] = useState<"none" | "request" | "confirm">("none");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"upi" | "cash">("upi");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [localJob, setLocalJob] = useState(job);

  // Sync local job when prop changes
  useEffect(() => { setLocalJob(job); }, [job]);

  async function requestPayment() {
    if (!provider || !paymentAmount) return;
    setPaymentLoading(true);
    try {
      const res = await fetch(`/api/orders/${localJob.id}/payment-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: provider.id,
          amount: paymentAmount,
          tenantSlug: provider.tenantSlug,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`💳 Payment link sent to customer on WhatsApp (₹${paymentAmount})`);
        setLocalJob({
          ...localJob,
          paymentStatus: "requested",
          paymentAmount: Math.round(parseFloat(paymentAmount) * 100),
          paymentMethod: "upi",
          paymentRequestedAt: new Date().toISOString(),
          upiPaymentLink: data.payment?.upiLink,
        });
        setPaymentModal("none");
        setPaymentAmount("");
      } else {
        toast.error(data.message || data.error || "Failed to send payment link");
      }
    } finally {
      setPaymentLoading(false);
    }
  }

  async function confirmPayment() {
    if (!provider) return;
    setPaymentLoading(true);
    try {
      const res = await fetch(`/api/orders/${localJob.id}/payment-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: provider.id,
          tenantSlug: provider.tenantSlug,
          method: paymentMethod,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("✅ Payment confirmed — customer notified");
        setLocalJob({
          ...localJob,
          paymentStatus: "paid",
        });
        setPaymentModal("none");
      } else {
        toast.error(data.error || "Failed to confirm payment");
      }
    } finally {
      setPaymentLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-xs text-muted-foreground">Order #{localJob.code}</p>
            <h2 className="text-sm font-medium">{svcName}</h2>
          </div>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4 max-w-md mx-auto">
        {/* Status */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
          <span className="text-xs text-muted-foreground">Current status</span>
          <span className={cn("text-xs px-2 py-0.5 rounded-full", ORDER_STATUS[localJob.status as keyof typeof ORDER_STATUS]?.bg, ORDER_STATUS[localJob.status as keyof typeof ORDER_STATUS]?.color)}>
            {ORDER_STATUS[localJob.status as keyof typeof ORDER_STATUS]?.label || localJob.status}
          </span>
        </div>

        {/* Customer */}
        <div className="p-4 rounded-xl bg-card border border-border">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Customer</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{localJob.customer.name || "Unknown"}</p>
              <p className="text-xs text-muted-foreground">{localJob.customer.phone}</p>
            </div>
            <a
              href={`tel:${localJob.customer.phone}`}
              className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-emerald-300 hover:bg-emerald-500/25 transition-colors"
            >
              <Phone className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Items / Description */}
        {items.length > 0 && (
          <div className="p-4 rounded-xl bg-card border border-border">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Items ({items.length})</p>
            <ul className="space-y-1">
              {items.map((it, i) => (
                <li key={i} className="text-sm flex items-baseline gap-2">
                  <span className="text-muted-foreground text-xs">{i + 1}.</span>
                  <span className="flex-1">{it.name}</span>
                  {it.qty && <span className="text-xs text-muted-foreground tnum">×{it.qty}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {localJob.description && (
          <div className="p-4 rounded-xl bg-card border border-border">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Description</p>
            <p className="text-sm">{localJob.description}</p>
          </div>
        )}

        {/* Address */}
        <div className="p-4 rounded-xl bg-card border border-border">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Address</p>
          <p className="text-sm">{localJob.addressText}</p>
          {localJob.addressArea && <p className="text-xs text-muted-foreground mt-1">Area: {localJob.addressArea}</p>}
          <a
            href={mapsLink(localJob.addressLat, localJob.addressLng, localJob.addressText)}
            target="_blank"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200"
          >
            <MapPin className="w-3.5 h-3.5" /> Open in Google Maps
          </a>
        </div>

        {/* Timing */}
        {localJob.timing && (
          <div className="p-4 rounded-xl bg-card border border-border">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Timing</p>
            <p className="text-sm flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-muted-foreground" /> {localJob.timing}
            </p>
          </div>
        )}

        {/* Charges section (before payment) */}
        <ChargesSection
          job={localJob}
          provider={provider}
          onChargesSet={(updated) => { setLocalJob({ ...localJob, ...updated }); }}
        />

        {/* Payment section */}
        <PaymentSection
          job={localJob}
          onRequest={() => setPaymentModal("request")}
          onConfirm={() => setPaymentModal("confirm")}
        />

        {/* Actions */}
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-background/95 backdrop-blur-xl border-t border-border">
          <div className="flex gap-2">
            {localJob.status === "accepted" && (
              <button
                onClick={() => onUpdate("picked")}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Package className="w-4 h-4" /> Picked up
              </button>
            )}
            {localJob.status === "picked" && (
              <button
                onClick={() => onUpdate("delivered")}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> Delivered
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Payment request modal */}
      {paymentModal === "request" && (
        <div className="fixed inset-0 bg-black/60 z-30 flex items-end sm:items-center justify-center" onClick={() => setPaymentModal("none")}>
          <div className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Request payment</h3>
            <p className="text-xs text-muted-foreground mb-4">Customer will get a UPI payment link on WhatsApp.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Amount (₹)</label>
                <input
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2.5 text-lg tnum outline-none focus:border-emerald-500/40"
                  autoFocus
                />
              </div>
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                <p className="font-medium mb-1">💳 How it works:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-emerald-300/80">
                  <li>UPI link sent to customer's WhatsApp</li>
                  <li>Customer pays via any UPI app (PhonePe/GPay/Paytm)</li>
                  <li>Customer shares screenshot on WhatsApp</li>
                  <li>You tap "Confirm Payment" once you see it</li>
                </ol>
              </div>
              <button
                onClick={requestPayment}
                disabled={paymentLoading || !paymentAmount}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm"
              >
                {paymentLoading ? "Sending…" : `Send ₹${paymentAmount || "0"} payment link`}
              </button>
              <button onClick={() => setPaymentModal("none")} className="w-full text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment confirm modal */}
      {paymentModal === "confirm" && (
        <div className="fixed inset-0 bg-black/60 z-30 flex items-end sm:items-center justify-center" onClick={() => setPaymentModal("none")}>
          <div className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Confirm payment received</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {localJob.paymentAmount
                ? `Expected: ₹${(localJob.paymentAmount / 100).toLocaleString("en-IN")}`
                : "Enter the amount you received."}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Payment method</label>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => setPaymentMethod("upi")}
                    className={cn("flex-1 py-2 rounded-lg text-sm border", paymentMethod === "upi" ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" : "border-border")}
                  >
                    💳 UPI
                  </button>
                  <button
                    onClick={() => setPaymentMethod("cash")}
                    className={cn("flex-1 py-2 rounded-lg text-sm border", paymentMethod === "cash" ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" : "border-border")}
                  >
                    💵 Cash
                  </button>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                <p>⚠️ Make sure you've verified the payment screenshot before confirming.</p>
              </div>
              <button
                onClick={confirmPayment}
                disabled={paymentLoading}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm"
              >
                {paymentLoading ? "Confirming…" : "✅ Confirm payment received"}
              </button>
              <button onClick={() => setPaymentModal("none")} className="w-full text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Payment section — shows payment status + action buttons
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Charges section — provider sets delivery/service charges, customer confirms
// ─────────────────────────────────────────────────────────────

function ChargesSection({ job, provider, onChargesSet }: { job: Job; provider: ProviderInfo | null; onChargesSet: (updated: Partial<Job>) => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [deliveryCharge, setDeliveryCharge] = useState("");
  const [serviceCharge, setServiceCharge] = useState("");
  const [addonsCharge, setAddonsCharge] = useState("");
  const [itemsTotal, setItemsTotal] = useState("");
  const [loading, setLoading] = useState(false);

  const isOrder = job.kind === "order";
  const isBook = job.kind === "book";

  // Pre-fill with service defaults when modal opens
  useEffect(() => {
    if (modalOpen) {
      if (isOrder) {
        setDeliveryCharge(job.deliveryCharge ? String(job.deliveryCharge / 100) : (job.service?.defaultDeliveryCharge ? String(job.service.defaultDeliveryCharge / 100) : ""));
        setItemsTotal(job.itemsTotal ? String(job.itemsTotal / 100) : "");
      }
      if (isBook) {
        setServiceCharge(job.serviceCharge ? String(job.serviceCharge / 100) : (job.service?.defaultServiceCharge ? String(job.service.defaultServiceCharge / 100) : ""));
        setAddonsCharge(job.addonsCharge ? String(job.addonsCharge / 100) : "");
      }
    }
  }, [modalOpen]);

  const totalRupees = job.totalAmount ? (job.totalAmount / 100) : 0;

  async function sendCharges() {
    if (!provider) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = { providerId: provider.id, tenantSlug: provider.tenantSlug };
      if (isOrder) {
        body.deliveryCharge = deliveryCharge || 0;
        body.itemsTotal = itemsTotal || 0;
      }
      if (isBook) {
        body.serviceCharge = serviceCharge || 0;
        body.addonsCharge = addonsCharge || 0;
      }
      const res = await fetch(`/api/orders/${job.id}/charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("📋 Charges sent to customer — waiting for agreement");
        setModalOpen(false);
        // Update local job with the new charges
        if (data.charges) {
          onChargesSet({
            deliveryCharge: data.charges.deliveryCharge,
            serviceCharge: data.charges.serviceCharge,
            addonsCharge: data.charges.addonsCharge,
            itemsTotal: data.charges.itemsTotal,
            totalAmount: data.charges.totalAmount,
            chargesConfirmed: data.charges.chargesConfirmed,
          });
        }
      } else {
        toast.error(data.error || "Failed to set charges");
      }
    } finally {
      setLoading(false);
    }
  }

  // No charges set yet
  if (!job.totalAmount || job.totalAmount === 0) {
    return (
      <div className="p-4 rounded-xl border border-dashed border-border bg-card/50">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Charges</p>
        <p className="text-sm text-muted-foreground mb-3">No charges set yet</p>
        <button
          onClick={() => setModalOpen(true)}
          className="w-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"
        >
          💰 Set charges
        </button>

        {modalOpen && (
          <ChargesModal
            isOrder={isOrder}
            isBook={isBook}
            deliveryCharge={deliveryCharge}
            setDeliveryCharge={setDeliveryCharge}
            serviceCharge={serviceCharge}
            setServiceCharge={setServiceCharge}
            addonsCharge={addonsCharge}
            setAddonsCharge={setAddonsCharge}
            itemsTotal={itemsTotal}
            setItemsTotal={setItemsTotal}
            loading={loading}
            onSend={sendCharges}
            onClose={() => setModalOpen(false)}
          />
        )}
      </div>
    );
  }

  // Charges set, waiting for customer agreement
  if (!job.chargesConfirmed) {
    return (
      <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-wider text-amber-300">Charges (waiting for customer)</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 animate-live-dot">Pending</span>
        </div>
        <ChargesBreakdown job={job} />
        <button
          onClick={() => setModalOpen(true)}
          className="w-full mt-3 text-xs py-2 rounded-lg border border-border hover:border-emerald-500/30"
        >
          ✏️ Edit charges
        </button>

        {modalOpen && (
          <ChargesModal
            isOrder={isOrder}
            isBook={isBook}
            deliveryCharge={deliveryCharge}
            setDeliveryCharge={setDeliveryCharge}
            serviceCharge={serviceCharge}
            setServiceCharge={setServiceCharge}
            addonsCharge={addonsCharge}
            setAddonsCharge={setAddonsCharge}
            itemsTotal={itemsTotal}
            setItemsTotal={setItemsTotal}
            loading={loading}
            onSend={sendCharges}
            onClose={() => setModalOpen(false)}
          />
        )}
      </div>
    );
  }

  // Charges confirmed by customer
  return (
    <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wider text-emerald-300">Charges</p>
        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
          <Check className="w-3 h-3" /> Agreed
        </span>
      </div>
      <ChargesBreakdown job={job} />
    </div>
  );
}

function ChargesBreakdown({ job }: { job: Job }) {
  const totalRupees = (job.totalAmount || 0) / 100;
  return (
    <div>
      {job.kind === "order" && (
        <>
          {job.itemsTotal && job.itemsTotal > 0 && (
            <div className="flex justify-between text-xs py-0.5">
              <span className="text-muted-foreground">🛍️ Items</span>
              <span className="tnum">₹{(job.itemsTotal / 100).toFixed(0)}</span>
            </div>
          )}
          {job.deliveryCharge && job.deliveryCharge > 0 && (
            <div className="flex justify-between text-xs py-0.5">
              <span className="text-muted-foreground">🚚 Delivery</span>
              <span className="tnum">₹{(job.deliveryCharge / 100).toFixed(0)}</span>
            </div>
          )}
        </>
      )}
      {job.kind === "book" && (
        <>
          {job.serviceCharge && job.serviceCharge > 0 && (
            <div className="flex justify-between text-xs py-0.5">
              <span className="text-muted-foreground">🔧 Service</span>
              <span className="tnum">₹{(job.serviceCharge / 100).toFixed(0)}</span>
            </div>
          )}
          {job.addonsCharge && job.addonsCharge > 0 && (
            <div className="flex justify-between text-xs py-0.5">
              <span className="text-muted-foreground">➕ Add-ons</span>
              <span className="tnum">₹{(job.addonsCharge / 100).toFixed(0)}</span>
            </div>
          )}
        </>
      )}
      <div className="flex justify-between text-sm font-semibold pt-2 mt-1 border-t border-border/40">
        <span>Total</span>
        <span className="tnum">₹{totalRupees.toFixed(0)}</span>
      </div>
    </div>
  );
}

function ChargesModal({
  isOrder, isBook,
  deliveryCharge, setDeliveryCharge,
  serviceCharge, setServiceCharge,
  addonsCharge, setAddonsCharge,
  itemsTotal, setItemsTotal,
  loading, onSend, onClose,
}: {
  isOrder: boolean; isBook: boolean;
  deliveryCharge: string; setDeliveryCharge: (v: string) => void;
  serviceCharge: string; setServiceCharge: (v: string) => void;
  addonsCharge: string; setAddonsCharge: (v: string) => void;
  itemsTotal: string; setItemsTotal: (v: string) => void;
  loading: boolean; onSend: () => void; onClose: () => void;
}) {
  // Compute live total
  const total = (isOrder ? (parseFloat(deliveryCharge || "0") + parseFloat(itemsTotal || "0")) : 0)
              + (isBook ? (parseFloat(serviceCharge || "0") + parseFloat(addonsCharge || "0")) : 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-30 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-1">Set charges</h3>
        <p className="text-xs text-muted-foreground mb-4">Customer will see the breakdown and must agree before payment.</p>

        <div className="space-y-3">
          {isOrder && (
            <>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Items total (₹)</label>
                <input
                  value={itemsTotal}
                  onChange={(e) => setItemsTotal(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm tnum outline-none focus:border-emerald-500/40"
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground mt-1">Estimated cost of items (customer pays actual at delivery)</p>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Delivery charge (₹)</label>
                <input
                  value={deliveryCharge}
                  onChange={(e) => setDeliveryCharge(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm tnum outline-none focus:border-emerald-500/40"
                />
              </div>
            </>
          )}
          {isBook && (
            <>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Service charge (₹)</label>
                <input
                  value={serviceCharge}
                  onChange={(e) => setServiceCharge(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm tnum outline-none focus:border-emerald-500/40"
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground mt-1">Base charge for the service (visit + labor)</p>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Add-ons cost (₹)</label>
                <input
                  value={addonsCharge}
                  onChange={(e) => setAddonsCharge(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm tnum outline-none focus:border-emerald-500/40"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Spare parts, materials, etc.</p>
              </div>
            </>
          )}

          {/* Live total */}
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex justify-between items-center">
            <span className="text-xs text-emerald-300">Total customer pays</span>
            <span className="text-lg font-semibold tnum text-emerald-300">₹{total.toFixed(0)}</span>
          </div>

          <button
            onClick={onSend}
            disabled={loading}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm"
          >
            {loading ? "Sending…" : "📋 Send charges to customer"}
          </button>
          <button onClick={onClose} className="w-full text-xs text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function PaymentSection({ job, onRequest, onConfirm }: { job: Job; onRequest: () => void; onConfirm: () => void }) {
  const paymentAmountRupees = job.paymentAmount ? (job.paymentAmount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;

  // No payment requested yet
  if (!job.paymentStatus || job.paymentStatus === "none") {
    return (
      <div className="p-4 rounded-xl border border-dashed border-border bg-card/50">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Payment</p>
        <p className="text-sm text-muted-foreground mb-3">No payment requested yet</p>
        <button
          onClick={onRequest}
          className="w-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"
        >
          💳 Request payment
        </button>
      </div>
    );
  }

  // Payment requested, waiting
  if (job.paymentStatus === "requested") {
    return (
      <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-wider text-amber-300">Payment requested</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 animate-live-dot">Waiting</span>
        </div>
        {paymentAmountRupees && (
          <p className="text-2xl font-semibold tnum mb-1">₹{paymentAmountRupees}</p>
        )}
        <p className="text-xs text-muted-foreground mb-3">
          UPI link sent to customer. Ask them to share the screenshot after paying.
        </p>
        <button
          onClick={onConfirm}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"
        >
          ✅ Confirm payment received
        </button>
      </div>
    );
  }

  // Payment confirmed
  if (job.paymentStatus === "paid") {
    return (
      <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-wider text-emerald-300">Payment</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
            <Check className="w-3 h-3" /> Paid
          </span>
        </div>
        {paymentAmountRupees && (
          <p className="text-2xl font-semibold tnum mb-1">₹{paymentAmountRupees}</p>
        )}
        <p className="text-xs text-muted-foreground">via {job.paymentMethod || "UPI"} · customer notified</p>
      </div>
    );
  }

  return null;
}

function NewJobScreen({ provider, onBack, onCreated }: { provider: ProviderInfo; onBack: () => void; onCreated: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!phone || !description) {
      toast.error("Phone and description required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug: provider.tenantSlug,
          phone,
          customerName: name,
          kind: "custom",
          description,
          addressText: address,
          timing: "ASAP",
          source: "manual",
          manualProviderId: provider.id,
          quoteAmount: price ? parseInt(price, 10) * 100 : 0,
        }),
      });
      const data = await res.json();
      if (data.order) {
        toast.success(`✅ Order #${data.order.code} created — customer notified`);
        onCreated();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-sm font-medium">New manual job</h2>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4 max-w-md mx-auto">
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
          Customer will instantly get a WhatsApp confirmation with the order code.
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Customer phone *</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91..." className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-500/40" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Customer name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-500/40" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Description *</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What does the customer need?" className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-500/40 resize-none" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-500/40" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Price (₹)</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="0" className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-500/40 tnum" />
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !phone || !description}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-3 rounded-xl text-sm"
        >
          {loading ? "Creating…" : "Create job & notify customer"}
        </button>
      </div>
    </div>
  );
}

function HistoryScreen({ jobs, onBack }: { jobs: Job[]; onBack: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-sm font-medium">Past jobs</h2>
        </div>
      </header>
      <div className="px-4 py-4 space-y-2 max-w-md mx-auto">
        {jobs.length === 0 ? (
          <EmptyState icon={History} title="No past jobs yet" desc="Your completed jobs will appear here" />
        ) : (
          jobs.map((job) => {
            const labels = job.service ? safeParse<Record<string, string>>(job.service.labels, {}) : {};
            const svcName = job.service ? `${job.service.icon} ${labels.en || job.service.key}` : "Order";
            return (
              <div key={job.id} className="p-3 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">#{job.code} · {svcName}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(job.deliveredAt || job.createdAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{job.customer.name || job.customer.phone} · {job.addressArea}</p>
                {job.quoteAmount && <p className="text-xs text-emerald-300 mt-1">{formatINR(job.quoteAmount)}</p>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function CustomRequestsScreen({ jobs, provider, onBack, onSent }: { jobs: Job[]; provider: ProviderInfo; onBack: () => void; onSent: () => void }) {
  const [quoteFor, setQuoteFor] = useState<Job | null>(null);
  const [amount, setAmount] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");

  async function sendQuote() {
    if (!quoteFor || !amount) return;
    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: quoteFor.id, amount: parseInt(amount, 10) * 100, deliveryTime }),
    });
    if (res.ok) {
      toast.success("Quote sent to customer on WhatsApp");
      setQuoteFor(null);
      setAmount("");
      setDeliveryTime("");
      onSent();
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-sm font-medium">Custom requests</h2>
        </div>
      </header>

      <div className="px-4 py-4 space-y-2 max-w-md mx-auto">
        {jobs.length === 0 ? (
          <EmptyState icon={Bell} title="No custom requests" desc="Unquoted custom orders will appear here" />
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="p-3 rounded-xl bg-card border border-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">#{job.code}</span>
                <span className="text-[10px] text-muted-foreground">{timeAgo(job.createdAt)}</span>
              </div>
              <p className="text-sm mb-2">{job.description}</p>
              <p className="text-xs text-muted-foreground mb-2">{job.customer.name || job.customer.phone}</p>
              <div className="flex gap-2">
                <button className="flex-1 text-xs py-1.5 rounded-lg bg-card border border-border hover:border-emerald-500/30 transition-colors">
                  💬 Ask question
                </button>
                <button
                  onClick={() => setQuoteFor(job)}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                >
                  💰 Send quote
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {quoteFor && (
        <div className="fixed inset-0 bg-black/60 z-30 flex items-end sm:items-center justify-center" onClick={() => setQuoteFor(null)}>
          <div className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">Send quote for #{quoteFor.code}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Amount (₹)</label>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="0" className="w-full mt-1 bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-500/40 tnum" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Delivery time</label>
                <input value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} placeholder="e.g. in 30 minutes" className="w-full mt-1 bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-500/40" />
              </div>
              <button onClick={sendQuote} disabled={!amount} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm">
                Send quote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Provider Settings — UPI IDs + Google review URL + feedback toggle
// ─────────────────────────────────────────────────────────────

function ProviderSettings({ provider, onBack }: { provider: ProviderInfo; onBack: () => void }) {
  const [upiIds, setUpiIds] = useState<Array<{ id: string; vpa: string; label: string; isDefault: boolean }>>([]);
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [newVpa, setNewVpa] = useState("");
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => {
    fetch(`/api/providers/${provider.id}/upi-ids`).then((r) => r.json()).then((d) => setUpiIds(d.upiIds || []));
    fetch(`/api/providers/${provider.id}/feedback`).then((r) => r.json()).then((d) => {
      setGoogleReviewUrl(d.googleReviewUrl || "");
      setFeedbackEnabled(d.feedbackEnabled ?? true);
    });
  }, [provider.id]);

  async function addUpi() {
    if (!newVpa || !/^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+$/.test(newVpa)) {
      toast.error("Invalid UPI ID format (e.g. name@bank)");
      return;
    }
    const newUpis = [...upiIds, {
      id: Math.random().toString(36).slice(2),
      vpa: newVpa,
      label: newLabel || newVpa.split("@")[0],
      isDefault: upiIds.length === 0, // first one is default
    }];
    await saveUpis(newUpis);
    setNewVpa("");
    setNewLabel("");
  }

  async function removeUpi(id: string) {
    const filtered = upiIds.filter((u) => u.id !== id);
    // If we removed the default, make the first one default
    if (!filtered.find((u) => u.isDefault) && filtered.length > 0) {
      filtered[0].isDefault = true;
    }
    await saveUpis(filtered);
  }

  async function setDefault(id: string) {
    const updated = upiIds.map((u) => ({ ...u, isDefault: u.id === id }));
    await saveUpis(updated);
  }

  async function saveUpis(newUpis: Array<{ id: string; vpa: string; label: string; isDefault: boolean }>) {
    setLoading(true);
    try {
      const res = await fetch(`/api/providers/${provider.id}/upi-ids`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upiIds: newUpis }),
      });
      if (res.ok) {
        setUpiIds(newUpis);
        toast.success("UPI IDs updated");
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveFeedback() {
    setLoading(true);
    try {
      await fetch(`/api/providers/${provider.id}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleReviewUrl, feedbackEnabled }),
      });
      toast.success("Feedback settings saved");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-sm font-medium">Settings</h2>
        </div>
      </header>

      <div className="px-4 py-4 space-y-5 max-w-md mx-auto">
        {/* UPI IDs */}
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-sm font-medium mb-1">UPI IDs</p>
          <p className="text-xs text-muted-foreground mb-3">Add multiple UPI IDs. The default one is used for payment links.</p>

          {upiIds.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {upiIds.map((upi) => (
                <div key={upi.id} className={cn(
                  "p-2.5 rounded-lg border flex items-center gap-2",
                  upi.isDefault ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"
                )}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono truncate">{upi.vpa}</p>
                    <p className="text-[10px] text-muted-foreground">{upi.label}</p>
                  </div>
                  {upi.isDefault ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">Default</span>
                  ) : (
                    <button onClick={() => setDefault(upi.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground">
                      Set default
                    </button>
                  )}
                  <button onClick={() => removeUpi(upi.id)} className="text-rose-400 hover:text-rose-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new UPI */}
          <div className="space-y-2 pt-2 border-t border-border/40">
            <input
              value={newVpa}
              onChange={(e) => setNewVpa(e.target.value)}
              placeholder="yourname@okhdfcbank"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-emerald-500/40"
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (e.g. Personal, Business)"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/40"
            />
            <button
              onClick={addUpi}
              disabled={!newVpa || loading}
              className="w-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-medium py-2 rounded-lg"
            >
              + Add UPI ID
            </button>
          </div>
        </div>

        {/* Google review URL */}
        <div className="p-4 rounded-xl border border-border bg-card">
          <p className="text-sm font-medium mb-1">Google Business review</p>
          <p className="text-xs text-muted-foreground mb-3">After delivery, customers get a link to review you on Google. Get this from your Google Business profile.</p>
          <input
            value={googleReviewUrl}
            onChange={(e) => setGoogleReviewUrl(e.target.value)}
            placeholder="https://g.page/r/CXXXX/review"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-emerald-500/40"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Tip: Go to Google Business Profile → Ask for reviews → copy the link.
          </p>
        </div>

        {/* Feedback toggle */}
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Ask customers for feedback</p>
              <p className="text-xs text-muted-foreground">After delivery, ask for a 1-5★ rating on WhatsApp</p>
            </div>
            <button
              onClick={() => setFeedbackEnabled(!feedbackEnabled)}
              className={cn("relative w-10 h-6 rounded-full transition-colors", feedbackEnabled ? "bg-emerald-500" : "bg-zinc-700")}
            >
              <span className={cn("absolute top-1 w-4 h-4 rounded-full bg-white transition-transform", feedbackEnabled ? "translate-x-5" : "translate-x-1")} />
            </button>
          </div>
        </div>

        <button
          onClick={saveFeedback}
          disabled={loading}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm"
        >
          {loading ? "Saving…" : "Save feedback settings"}
        </button>
      </div>
    </div>
  );
}

function ProviderOnboarding({ provider, onDone }: { provider: ProviderInfo; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      icon: Bell,
      title: "Enable notifications",
      desc: "We'll alert you loudly when a new job comes in — even when your phone is locked.",
    },
    {
      icon: Battery,
      title: "Allow unrestricted battery",
      desc: "Android may kill the app in the background. Go to Settings → Apps → CityHelp → Battery → Unrestricted.",
    },
    {
      icon: Volume2,
      title: "Test alert",
      desc: "We'll send a test notification. Make sure your phone is not on silent.",
    },
    {
      icon: Check,
      title: "All set!",
      desc: "You're ready to receive jobs. Go online to start.",
    },
  ];
  const Step = steps[step];
  const Icon = Step.icon;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/60 px-4 py-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Step {step + 1} of {steps.length}</span>
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground">Skip</button>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mb-6">
          <Icon className="w-10 h-10 text-emerald-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">{Step.title}</h2>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">{Step.desc}</p>
      </div>
      <div className="p-4 space-y-2">
        {step === 0 && (
          <button onClick={async () => {
            // Request notification permission + subscribe to push
            try {
              const perm = await Notification.requestPermission();
              if (perm === "granted") {
                toast.success("🔔 Notifications enabled");
                // Try to subscribe to web push
                try {
                  const vapidRes = await fetch("/api/push/vapid");
                  const vapidData = await vapidRes.json();
                  if (vapidData.configured && "serviceWorker" in navigator) {
                    const reg = await navigator.serviceWorker.ready;
                    const subscription = await reg.pushManager.subscribe({
                      userVisibleOnly: true,
                      applicationServerKey: vapidData.publicKey,
                    });
                    await fetch("/api/providers/subscribe", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ providerId: provider.id, subscription }),
                    });
                    toast.success("Push notifications subscribed");
                  }
                } catch (e) {
                  // Push optional — don't block onboarding
                  console.log("Push subscription failed:", e);
                }
              } else {
                toast.info("Notifications blocked — you can still receive jobs in-app");
              }
            } catch {
              toast.info("Notifications not available on this device");
            }
            setStep(1);
          }} className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-3 rounded-xl text-sm">
            Allow notifications
          </button>
        )}
        {step === 1 && (
          <button onClick={() => setStep(2)} className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-3 rounded-xl text-sm">
            Got it — I've set unrestricted battery
          </button>
        )}
        {step === 2 && (
          <button onClick={() => {
            // Send a real local notification as a test
            try {
              if ("Notification" in window && Notification.permission === "granted") {
                new Notification("CityHelp test alert", {
                  body: "🔔 If you can hear this, you're ready to receive jobs!",
                  tag: "test",
                });
                toast.success("🔊 Test notification sent — check your notifications");
              } else {
                toast.info("Notifications not granted — you'll still see jobs in the app");
              }
            } catch {
              toast.info("Could not send test notification");
            }
            setStep(3);
          }} className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-3 rounded-xl text-sm">
            Send test alert
          </button>
        )}
        {step === 3 && (
          <button onClick={onDone} className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-3 rounded-xl text-sm">
            Start receiving jobs
          </button>
        )}
      </div>
    </div>
  );
}
