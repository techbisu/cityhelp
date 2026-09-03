"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useApp } from "@/stores/app";
import { cn, formatINR, timeAgo, formatDuration, mapsLink, safeParse, ORDER_STATUS, type OrderStatus } from "@/lib/utils";
import {
  ArrowLeft, LayoutDashboard, Package, AlertTriangle, Users, User, Settings, Bot, Building2, Bell,
  Search, Plus, TrendingUp, Clock, Phone, MapPin, ChevronDown, X, Sparkles, Zap, Activity,
  Filter, Check, Ban, MoreVertical, Pencil, Trash2, Power, Star, Shield, Key, Eye, EyeOff,
  Globe, MessageSquare, CheckCircle2, AlertCircle, Loader2, GripVertical, ArrowRight, CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext, type DragEndEvent, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

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
  customer: { id: string; name: string | null; phone: string; language: string; addresses: string };
  service: { id: string; icon: string; key: string; labels: string } | null;
  city: { id: string; name: string };
  acceptedBy: { id: string; name: string; phone: string; zone: string } | null;
  broadcasts: Array<{ id: string; status: string; provider: { id: string; name: string; phone: string } }>;
  activity: Array<{ id: string; actor: string; action: string; detail: string | null; createdAt: string }>;
  quoteAmount: number | null;
  quoteStatus: string | null;
  source: string;
  createdAt: string;
  acceptedAt: string | null;
  pickedAt: string | null;
  deliveredAt: string | null;
  escalatedAt: string | null;
}

interface Provider {
  id: string;
  name: string;
  phone: string;
  isOnline: boolean;
  isActive: boolean;
  rating: number;
  jobsDone: number;
  earnings: number;
  avgAcceptSec: number;
  zone: string | null;
  city: { id: string; name: string };
  services: Array<{ id: string; key: string; icon: string; labels: string }>;
  serviceIds: string[];
}

interface Customer {
  id: string;
  name: string | null;
  phone: string;
  language: string;
  isBlocked: boolean;
  totalOrders: number;
  lifetimeValue: number;
  _count: { orders: number };
  createdAt: string;
}

interface Service {
  id: string;
  key: string;
  kind: string;
  icon: string;
  orderIdx: number;
  isActive: boolean;
  labels: string;
  questions: string;
}

interface CityT { id: string; name: string; state: string | null; isActive: boolean }

interface Stats {
  cards: {
    ordersToday: number;
    revenueToday: number;
    avgAcceptSec: number;
    escalationRate: number;
    activeProviders: number;
    totalProviders: number;
    totalCustomers: number;
    acceptedOrders: number;
    escalatedOrders: number;
  };
  sparklines: {
    orders: number[];
    revenue: number[];
    escalation: number[];
    accept: number[];
  };
  liveOrders: Job[];
}

// ─────────────────────────────────────────────────────────────
// Main AdminApp
// ─────────────────────────────────────────────────────────────

export function AdminApp() {
  const setView = useApp((s) => s.setView);
  const adminTenantSlug = useApp((s) => s.adminTenantSlug);
  const adminStaffEmail = useApp((s) => s.adminStaffEmail);
  const adminCityId = useApp((s) => s.adminCityId);
  const setAdminTenant = useApp((s) => s.setAdminTenant);
  const setAdminCity = useApp((s) => s.setAdminCity);
  const clearAdmin = useApp((s) => s.clearAdmin);
  const isImpersonating = useApp((s) => s.isImpersonating);
  const setImpersonation = useApp((s) => s.setImpersonation);

  const [page, setPage] = useState<"dashboard" | "orders" | "escalation" | "providers" | "customers" | "services" | "cities" | "whatsapp" | "ai" | "billing" | "team" | "notifications" | "onboarding">("dashboard");
  const [tenant, setTenant] = useState<{ name: string; slug: string; accentColor: string; waBusinessName: string | null; waVerified: boolean } | null>(null);
  const [cities, setCities] = useState<CityT[]>([]);
  const [orders, setOrders] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Login state
  const [loginEmail, setLoginEmail] = useState("owner@shanti.express");
  const [loginPassword, setLoginPassword] = useState("demo1234");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const effectiveSlug = adminTenantSlug || (isImpersonating ? useApp.getState().impersonatedTenantSlug : null);

  // ── Fetch tenant info ──────────────────────────────────
  const refresh = useCallback(async () => {
    if (!effectiveSlug) return;
    const [tRes, cRes] = await Promise.all([
      fetch("/api/tenants").then((r) => r.json()),
      fetch(`/api/cities?tenantSlug=${effectiveSlug}`).then((r) => r.json()),
    ]);
    const t = tRes.tenants?.find((x: { slug: string }) => x.slug === effectiveSlug);
    if (t) setTenant(t);
    setCities(cRes.cities || []);
  }, [effectiveSlug]);

  useEffect(() => {
    if (effectiveSlug) refresh();
  }, [effectiveSlug, refresh]);

  // ── Cmd+K ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Not logged in ──────────────────────────────────────
  if (!adminStaffEmail || !effectiveSlug) {
    return (
      <AdminLogin
        onBack={() => setView("home")}
        email={loginEmail}
        password={loginPassword}
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
        error={loginError}
        loading={loginLoading}
        onSubmit={async () => {
          setLoginLoading(true);
          setLoginError(null);
          try {
            // Try each tenant to find the staff
            const tenantsRes = await fetch("/api/tenants").then((r) => r.json());
            let found = false;
            for (const t of tenantsRes.tenants || []) {
              const res = await fetch("/api/staff/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenantSlug: t.slug, email: loginEmail, password: loginPassword }),
              });
              if (res.ok) {
                setAdminTenant(t.slug, loginEmail);
                found = true;
                toast.success(`Welcome back!`);
                break;
              }
            }
            if (!found) setLoginError("Invalid credentials");
          } finally {
            setLoginLoading(false);
          }
        }}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border/60 bg-sidebar/30 flex-shrink-0 hidden md:flex flex-col">
        <div className="p-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{tenant?.name || "Tenant"}</p>
              <p className="text-[10px] text-muted-foreground">Admin dashboard</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          <NavItem icon={LayoutDashboard} label="Dashboard" active={page === "dashboard"} onClick={() => setPage("dashboard")} />
          <NavItem icon={Package} label="Orders" active={page === "orders"} onClick={() => setPage("orders")} />
          <NavItem icon={AlertTriangle} label="Escalation" active={page === "escalation"} onClick={() => setPage("escalation")} badge={stats?.cards.escalatedOrders} badgeColor="rose" />
          <NavItem icon={Users} label="Providers" active={page === "providers"} onClick={() => setPage("providers")} />
          <NavItem icon={User} label="Customers" active={page === "customers"} onClick={() => setPage("customers")} />
          <NavItem icon={Bot} label="Services" active={page === "services"} onClick={() => setPage("services")} />
          <NavItem icon={Globe} label="Cities" active={page === "cities"} onClick={() => setPage("cities")} />
          <div className="pt-2 mt-2 border-t border-border/60">
            <p className="px-3 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Settings</p>
            <NavItem icon={MessageSquare} label="WhatsApp" active={page === "whatsapp"} onClick={() => setPage("whatsapp")} />
            <NavItem icon={Sparkles} label="AI (BYOK)" active={page === "ai"} onClick={() => setPage("ai")} />
            <NavItem icon={CreditCard} label="Billing" active={page === "billing"} onClick={() => setPage("billing")} />
            <NavItem icon={Users} label="Team" active={page === "team"} onClick={() => setPage("team")} />
            <NavItem icon={Bell} label="Notifications" active={page === "notifications"} onClick={() => setPage("notifications")} />
          </div>
        </nav>

        <div className="p-3 border-t border-border/60">
          <button
            onClick={() => { clearAdmin(); if (isImpersonating) setImpersonation(null); setView("home"); }}
            className="w-full text-left text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-card transition-colors"
          >
            ← Back to home
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-20">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setView("home")} className="md:hidden text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-sm font-semibold capitalize">
                  {page === "ai" ? "AI Configuration" : page}
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  {tenant?.name} · {isImpersonating && <span className="text-amber-400">[Impersonating] </span>}
                  {adminStaffEmail}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* City switcher */}
              <div className="relative">
                <select
                  value={adminCityId || "all"}
                  onChange={(e) => setAdminCity(e.target.value === "all" ? null : e.target.value)}
                  className="appearance-none bg-card border border-border rounded-lg pl-3 pr-8 py-1.5 text-xs outline-none focus:border-emerald-500/40 cursor-pointer"
                >
                  <option value="all">All cities</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>

              {/* Cmd+K */}
              <button
                onClick={() => setCmdOpen(true)}
                className="flex items-center gap-2 bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-emerald-500/30 transition-colors"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Search</span>
                <kbd className="hidden sm:inline px-1 py-0.5 rounded bg-background text-[10px] font-mono">⌘K</kbd>
              </button>
            </div>
          </div>

          {isImpersonating && (
            <div className="bg-amber-500/10 border-t border-amber-500/20 px-4 py-1.5 text-xs text-amber-300 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" />
              You are impersonating this tenant. All actions are audited.
              <button onClick={async () => {
                // Write audit log for impersonation end
                try {
                  const tenantsRes = await fetch("/api/tenants").then((r) => r.json());
                  const t = (tenantsRes.tenants || []).find((x: { slug: string }) => x.slug === effectiveSlug);
                  if (t) {
                    await fetch("/api/superadmin/impersonate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ tenantId: t.id, action: "end" }),
                    });
                  }
                } catch { /* non-blocking */ }
                setImpersonation(null);
                setView("platform");
              }} className="ml-auto underline hover:text-amber-200">Exit</button>
            </div>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {page === "dashboard" && <DashboardPage slug={effectiveSlug} cityId={adminCityId} stats={stats} setStats={setStats} />}
          {page === "orders" && <OrdersPage slug={effectiveSlug} cityId={adminCityId} orders={orders} setOrders={setOrders} providers={providers} setProviders={setProviders} />}
          {page === "escalation" && <EscalationPage slug={effectiveSlug} cityId={adminCityId} orders={orders} setOrders={setOrders} providers={providers} setProviders={setProviders} />}
          {page === "providers" && <ProvidersPage slug={effectiveSlug} cityId={adminCityId} providers={providers} setProviders={setProviders} services={services} setServices={setServices} cities={cities} />}
          {page === "customers" && <CustomersPage slug={effectiveSlug} customers={customers} setCustomers={setCustomers} />}
          {page === "services" && <ServicesPage slug={effectiveSlug} services={services} setServices={setServices} />}
          {page === "cities" && <CitiesPage slug={effectiveSlug} cities={cities} setCities={setCities} />}
          {page === "whatsapp" && <WhatsAppPage tenant={tenant} />}
          {page === "ai" && <AIPage slug={effectiveSlug} />}
          {page === "billing" && <BillingPage slug={effectiveSlug} />}
          {page === "team" && <TeamPage slug={effectiveSlug} staffEmail={adminStaffEmail} />}
          {page === "notifications" && <NotificationsPage slug={effectiveSlug} />}
        </main>
      </div>

      {/* Command palette */}
      {cmdOpen && (
        <CommandPalette
          onClose={() => setCmdOpen(false)}
          onNavigate={(p) => { setPage(p); setCmdOpen(false); }}
          orders={orders}
          providers={providers}
          customers={customers}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────

function AdminLogin({
  onBack, email, password, setEmail, setPassword, error, loading, onSubmit,
}: {
  onBack: () => void;
  email: string; password: string;
  setEmail: (v: string) => void; setPassword: (v: string) => void;
  error: string | null; loading: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm mb-6 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
            <LayoutDashboard className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-xl font-semibold">Tenant Admin</h1>
          <p className="text-xs text-muted-foreground mt-1">Sign in to your dashboard</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-500/40" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-500/40" />
          </div>
          {error && <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">{error}</div>}
          <button onClick={onSubmit} disabled={loading} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </div>
        <div className="mt-6 p-3 rounded-xl bg-card/60 border border-border/60 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Demo accounts</p>
          <p>owner@shanti.express / demo1234</p>
          <p>owner@quickfix.services / demo1234</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Nav Item
// ─────────────────────────────────────────────────────────────

function NavItem({
  icon: Icon, label, active, onClick, badge, badgeColor = "emerald",
}: {
  icon: typeof LayoutDashboard; label: string; active: boolean; onClick: () => void;
  badge?: number; badgeColor?: "emerald" | "rose" | "amber";
}) {
  const badgeBg = badgeColor === "rose" ? "bg-rose-500 text-rose-50" : badgeColor === "amber" ? "bg-amber-500 text-amber-50" : "bg-emerald-500 text-emerald-50";
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
        active ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" : "text-muted-foreground hover:text-foreground hover:bg-card border border-transparent"
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge && badge > 0 && <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", badgeBg)}>{badge}</span>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Dashboard page
// ─────────────────────────────────────────────────────────────

function DashboardPage({ slug, cityId, stats, setStats }: { slug: string; cityId: string | null; stats: Stats | null; setStats: (s: Stats) => void }) {
  useEffect(() => {
    const params = new URLSearchParams({ tenantSlug: slug });
    if (cityId) params.set("cityId", cityId);
    fetch(`/api/stats?${params}`)
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {});
    const id = setInterval(() => {
      fetch(`/api/stats?${params}`).then((r) => r.json()).then((d) => setStats(d)).catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, [slug, cityId, setStats]);

  if (!stats) {
    return (
      <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Orders today"
          value={String(stats.cards.ordersToday)}
          icon={Package}
          spark={stats.sparklines.orders}
          delta="+12%"
          deltaColor="text-emerald-400"
        />
        <StatCard
          label="Revenue today"
          value={formatINR(stats.cards.revenueToday)}
          icon={TrendingUp}
          spark={stats.sparklines.revenue.map((v) => v / 100)}
          delta="+8%"
          deltaColor="text-emerald-400"
        />
        <StatCard
          label="Avg accept"
          value={formatDuration(stats.cards.avgAcceptSec)}
          icon={Clock}
          spark={stats.sparklines.accept.map((v) => 60 - v)}
          delta="-15%"
          deltaColor="text-emerald-400"
          invertSpark
        />
        <StatCard
          label="Escalation rate"
          value={`${stats.cards.escalationRate}%`}
          icon={AlertTriangle}
          spark={stats.sparklines.escalation.map((v) => 100 - v)}
          delta="-3%"
          deltaColor="text-emerald-400"
          invertSpark
          accent="amber"
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Active providers" value={`${stats.cards.activeProviders}/${stats.cards.totalProviders}`} icon={Users} />
        <MiniStat label="Total customers" value={String(stats.cards.totalCustomers)} icon={User} />
        <MiniStat label="Accepted (live)" value={String(stats.cards.acceptedOrders)} icon={CheckCircle2} />
        <MiniStat label="Escalated" value={String(stats.cards.escalatedOrders)} icon={AlertCircle} accent={stats.cards.escalatedOrders > 0 ? "rose" : undefined} />
      </div>

      {/* Live orders feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
            Live orders
          </h3>
          <span className="text-xs text-muted-foreground">{stats.liveOrders.length} active</span>
        </div>
        {stats.liveOrders.length === 0 ? (
          <EmptyState icon={Package} title="No live orders" desc="New orders will appear here in real time" actionLabel="Open bot" />
        ) : (
          <div className="space-y-1.5">
            {stats.liveOrders.map((order) => (
              <LiveOrderRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, spark, delta, deltaColor, invertSpark, accent,
}: {
  label: string; value: string; icon: typeof Package; spark: number[];
  delta: string; deltaColor: string; invertSpark?: boolean; accent?: "amber";
}) {
  const max = Math.max(...spark, 1);
  const data = invertSpark ? spark.map((v) => max - v + 1) : spark;
  return (
    <div className={cn(
      "p-4 rounded-xl border bg-card",
      accent === "amber" ? "border-amber-500/20 bg-amber-500/5" : "border-border"
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={cn("w-4 h-4", accent === "amber" ? "text-amber-400" : "text-muted-foreground")} />
      </div>
      <p className="text-2xl font-semibold tnum">{value}</p>
      <div className="flex items-end justify-between mt-2">
        <span className={cn("text-[11px]", deltaColor)}>{delta} vs yesterday</span>
        <Sparkline data={data} max={max} color={accent === "amber" ? "#f59e0b" : "#10b981"} />
      </div>
    </div>
  );
}

function Sparkline({ data, max, color }: { data: number[]; max: number; color: string }) {
  const w = 60, h = 20;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MiniStat({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Users; accent?: "rose" }) {
  return (
    <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-2.5">
      <Icon className={cn("w-4 h-4", accent === "rose" ? "text-rose-400" : "text-muted-foreground")} />
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">{label}</p>
        <p className="text-sm font-medium tnum mt-1">{value}</p>
      </div>
    </div>
  );
}

function LiveOrderRow({ order }: { order: Job }) {
  const labels = order.service ? safeParse<Record<string, string>>(order.service.labels, {}) : {};
  const svcName = order.service ? `${order.service.icon} ${labels.en || order.service.key}` : "Order";
  const items = safeParse<OrderItem[]>(order.items, []);
  const st = ORDER_STATUS[order.status as OrderStatus] || ORDER_STATUS.new;
  return (
    <div className={cn(
      "p-3 rounded-lg border bg-card hover:border-emerald-500/30 transition-colors flex items-center gap-3",
      order.status === "escalated" ? "border-rose-500/30 bg-rose-500/5" : "border-border"
    )}>
      <div className={cn("w-2 h-2 rounded-full flex-shrink-0", st.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">#{order.code}</span>
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", st.bg, st.color)}>{st.label}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {svcName} · {items[0]?.name || order.description || "—"}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[11px] text-muted-foreground">{order.addressArea || order.city.name}</p>
        <p className="text-[10px] text-muted-foreground">{timeAgo(order.createdAt)}</p>
      </div>
      {order.acceptedBy && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-300">
            {order.acceptedBy.name.charAt(0)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Orders page (kanban + table)
// ─────────────────────────────────────────────────────────────

function OrdersPage({ slug, cityId, orders, setOrders, providers, setProviders }: {
  slug: string; cityId: string | null;
  orders: Job[]; setOrders: (o: Job[]) => void;
  providers: Provider[]; setProviders: (p: Provider[]) => void;
}) {
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [filterService, setFilterService] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selected, setSelected] = useState<Job | null>(null);
  const [assignFor, setAssignFor] = useState<Job | null>(null);

  // Fetch orders + providers
  useEffect(() => {
    const params = new URLSearchParams({ tenantSlug: slug });
    if (cityId) params.set("cityId", cityId);
    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((d) => setOrders(d.orders || []))
      .catch(() => {});
    fetch(`/api/providers?${params}`)
      .then((r) => r.json())
      .then((d) => setProviders(d.providers || []))
      .catch(() => {});
    const id = setInterval(() => {
      fetch(`/api/orders?${params}`).then((r) => r.json()).then((d) => setOrders(d.orders || [])).catch(() => {});
    }, 6000);
    return () => clearInterval(id);
  }, [slug, cityId, setOrders, setProviders]);

  const filtered = orders.filter((o) => {
    if (filterService !== "all" && o.service?.key !== filterService) return false;
    if (filterStatus !== "all" && o.status !== filterStatus) return false;
    return true;
  });

  const kanbanColumns = [
    { id: "new", title: "New", statuses: ["new"] },
    { id: "broadcast", title: "Broadcast", statuses: ["broadcast", "quoted"] },
    { id: "accepted", title: "Accepted", statuses: ["accepted"] },
    { id: "picked", title: "Picked", statuses: ["picked"] },
    { id: "delivered", title: "Delivered", statuses: ["delivered"] },
  ];

  function refresh() {
    const params = new URLSearchParams({ tenantSlug: slug });
    if (cityId) params.set("cityId", cityId);
    fetch(`/api/orders?${params}`).then((r) => r.json()).then((d) => setOrders(d.orders || []));
  }

  return (
    <div className="p-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-card border border-border rounded-lg p-0.5">
          <button onClick={() => setView("kanban")} className={cn("px-3 py-1 text-xs rounded-md transition-colors", view === "kanban" ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground")}>Kanban</button>
          <button onClick={() => setView("table")} className={cn("px-3 py-1 text-xs rounded-md transition-colors", view === "table" ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground")}>Table</button>
        </div>
        <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="bg-card border border-border rounded-lg px-2 py-1 text-xs outline-none">
          <option value="all">All services</option>
          <option value="cake">Cake</option>
          <option value="grocery">Grocery</option>
          <option value="chicken">Chicken</option>
          <option value="parcel">Parcel</option>
          <option value="ride">Ride</option>
          <option value="repair">Repair</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="bg-card border border-border rounded-lg px-2 py-1 text-xs outline-none">
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="broadcast">Broadcast</option>
          <option value="accepted">Accepted</option>
          <option value="picked">Picked</option>
          <option value="delivered">Delivered</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>

      {view === "kanban" ? (
        <KanbanBoard columns={kanbanColumns} filtered={filtered} providers={providers} onSelect={setSelected} onAssign={setAssignFor} onDragEndAction={async (orderId, newStatus, providerId) => {
          const order = orders.find((o) => o.id === orderId);
          if (!order) return;
          if (providerId) {
            await fetch(`/api/orders/${orderId}/assign`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ providerId, actor: "admin" }),
            });
            toast.success(`Assigned #${order.code}`);
          } else if (newStatus === "delivered" || newStatus === "picked") {
            await fetch(`/api/orders/${orderId}/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: newStatus, actor: "admin" }),
            });
            toast.success(`#${order.code} → ${newStatus}`);
          }
          refresh();
        }} />
      ) : (
        <OrdersTable orders={filtered} onSelect={setSelected} />
      )}

      {selected && <OrderDetailModal order={selected} onClose={() => setSelected(null)} onAssign={(o) => { setSelected(null); setAssignFor(o); }} />}
      {assignFor && (
        <AssignModal order={assignFor} providers={providers} onClose={() => setAssignFor(null)} onAssigned={() => { setAssignFor(null); refresh(); }} />
      )}
    </div>
  );
}

function KanbanBoard({ columns, filtered, providers, onSelect, onAssign, onDragEndAction }: {
  columns: Array<{ id: string; title: string; statuses: string[] }>;
  filtered: Job[];
  providers: Provider[];
  onSelect: (j: Job) => void;
  onAssign: (j: Job) => void;
  onDragEndAction: (orderId: string, newStatus: string, providerId?: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const orderId = String(active.id);
    const target = String(over.id);
    if (target.startsWith("prov_")) {
      onDragEndAction(orderId, "accepted", target.slice(5));
    } else {
      const col = columns.find((c) => c.id === target);
      if (col) onDragEndAction(orderId, col.id);
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-5 gap-3 overflow-x-auto">
        {columns.map((col) => {
          const colOrders = filtered.filter((o) => col.statuses.includes(o.status));
          return (
            <KanbanColumn key={col.id} col={col} orders={colOrders} providers={providers} onSelect={onSelect} onAssign={onAssign} />
          );
        })}
      </div>
    </DndContext>
  );
}

function KanbanColumn({ col, orders, providers, onSelect, onAssign }: {
  col: { id: string; title: string; statuses: string[] };
  orders: Job[]; providers: Provider[];
  onSelect: (j: Job) => void; onAssign: (j: Job) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div ref={setNodeRef} className={cn("rounded-xl border bg-card/30 min-h-[300px]", isOver ? "border-emerald-500/40 bg-emerald-500/5" : "border-border")}>
      <div className="p-3 border-b border-border/60 flex items-center justify-between">
        <span className="text-xs font-medium">{col.title}</span>
        <span className="text-[10px] text-muted-foreground tnum">{orders.length}</span>
      </div>
      <div className="p-2 space-y-1.5 max-h-[calc(100vh-260px)] overflow-y-auto">
        {orders.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-muted-foreground">No orders</div>
        ) : (
          orders.map((order) => (
            <KanbanCard key={order.id} order={order} onSelect={() => onSelect(order)} onAssign={() => onAssign(order)} />
          ))
        )}
        {/* Droppable provider targets */}
        {col.id === "accepted" && (
          <div className="pt-2 mt-2 border-t border-border/60">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Drop on provider</p>
            <div className="flex flex-wrap gap-1">
              {providers.filter((p) => p.isActive).slice(0, 6).map((p) => (
                <ProviderDropTarget key={p.id} provider={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanCard({ order, onSelect, onAssign }: { order: Job; onSelect: () => void; onAssign: () => void }) {
  const labels = order.service ? safeParse<Record<string, string>>(order.service.labels, {}) : {};
  const svcName = order.service ? `${order.service.icon} ${labels.en || order.service.key}` : "Order";
  const items = safeParse<OrderItem[]>(order.items, []);
  const st = ORDER_STATUS[order.status as OrderStatus] || ORDER_STATUS.new;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: order.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "p-2.5 rounded-lg border bg-card hover:border-emerald-500/30 transition-colors cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
        order.status === "escalated" ? "border-rose-500/30 bg-rose-500/5" : "border-border"
      )}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium">#{order.code}</span>
        <span className={cn("w-1.5 h-1.5 rounded-full", st.dot)} />
      </div>
      <p className="text-xs font-medium truncate">{svcName}</p>
      {items.length > 0 && <p className="text-[10px] text-muted-foreground truncate">{items.length} item(s)</p>}
      {order.description && <p className="text-[10px] text-muted-foreground truncate">{order.description}</p>}
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
          <MapPin className="w-2.5 h-2.5" /> {order.addressArea || "—"}
        </span>
        {order.status === "escalated" && (
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(); }}
            className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
          >
            Assign
          </button>
        )}
      </div>
    </div>
  );
}

function ProviderDropTarget({ provider }: { provider: Provider }) {
  const { setNodeRef, isOver } = useDroppable({ id: `prov_${provider.id}` });
  return (
    <div ref={setNodeRef} className={cn(
      "px-2 py-1 rounded text-[10px] border transition-colors",
      isOver ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-border text-muted-foreground"
    )}>
      {provider.name.split(" ")[0]}
    </div>
  );
}

function OrdersTable({ orders, onSelect }: { orders: Job[]; onSelect: (j: Job) => void }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-card border-b border-border">
            <tr>
              <th className="text-left p-2 font-medium text-muted-foreground">Code</th>
              <th className="text-left p-2 font-medium text-muted-foreground">Service</th>
              <th className="text-left p-2 font-medium text-muted-foreground">Customer</th>
              <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
              <th className="text-left p-2 font-medium text-muted-foreground">Provider</th>
              <th className="text-left p-2 font-medium text-muted-foreground">Area</th>
              <th className="text-left p-2 font-medium text-muted-foreground">Amount</th>
              <th className="text-left p-2 font-medium text-muted-foreground">Created</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const labels = o.service ? safeParse<Record<string, string>>(o.service.labels, {}) : {};
              const st = ORDER_STATUS[o.status as OrderStatus] || ORDER_STATUS.new;
              return (
                <tr key={o.id} onClick={() => onSelect(o)} className="border-b border-border/40 hover:bg-card/50 cursor-pointer">
                  <td className="p-2 font-mono">#{o.code}</td>
                  <td className="p-2">{o.service ? `${o.service.icon} ${labels.en || o.service.key}` : "—"}</td>
                  <td className="p-2">{o.customer.name || o.customer.phone}</td>
                  <td className="p-2"><span className={cn("px-1.5 py-0.5 rounded text-[10px]", st.bg, st.color)}>{st.label}</span></td>
                  <td className="p-2">{o.acceptedBy?.name || "—"}</td>
                  <td className="p-2">{o.addressArea || "—"}</td>
                  <td className="p-2 tnum">{o.quoteAmount ? formatINR(o.quoteAmount) : "—"}</td>
                  <td className="p-2 text-muted-foreground">{timeAgo(o.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderDetailModal({ order, onClose, onAssign }: { order: Job; onClose: () => void; onAssign: (j: Job) => void }) {
  const items = safeParse<OrderItem[]>(order.items, []);
  const labels = order.service ? safeParse<Record<string, string>>(order.service.labels, {}) : {};
  const svcName = order.service ? `${order.service.icon} ${labels.en || order.service.key}` : "Order";
  return (
    <div className="fixed inset-0 bg-black/60 z-30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-2xl rounded-2xl border border-border max-h-[90vh] overflow-y-auto animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <header className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
          <div>
            <h3 className="text-sm font-semibold">Order #{order.code}</h3>
            <p className="text-xs text-muted-foreground">{svcName} · {order.city.name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </header>

        <div className="p-4 space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={cn("px-2 py-1 rounded-full text-xs", ORDER_STATUS[order.status as OrderStatus]?.bg, ORDER_STATUS[order.status as OrderStatus]?.color)}>
              {ORDER_STATUS[order.status as OrderStatus]?.label}
            </span>
            <span className="text-xs text-muted-foreground">via {order.source}</span>
            <span className="text-xs text-muted-foreground">· {timeAgo(order.createdAt)}</span>
          </div>

          {/* Customer */}
          <div className="p-3 rounded-xl bg-background border border-border">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Customer</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{order.customer.name || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{order.customer.phone}</p>
              </div>
              <a href={`tel:${order.customer.phone}`} className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-300">
                <Phone className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {items.length > 0 && (
            <div className="p-3 rounded-xl bg-background border border-border">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Items ({items.length})</p>
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

          {order.description && (
            <div className="p-3 rounded-xl bg-background border border-border">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Description</p>
              <p className="text-sm">{order.description}</p>
            </div>
          )}

          {(order.addressText || order.addressArea) && (
            <div className="p-3 rounded-xl bg-background border border-border">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Address</p>
              <p className="text-sm">{order.addressText}</p>
              {order.addressArea && <p className="text-xs text-muted-foreground mt-1">Area: {order.addressArea}</p>}
              <a href={mapsLink(order.addressLat, order.addressLng, order.addressText)} target="_blank" className="text-xs text-emerald-300 mt-2 inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Open in Maps
              </a>
            </div>
          )}

          {order.acceptedBy && (
            <div className="p-3 rounded-xl bg-background border border-border">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Provider</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{order.acceptedBy.name}</p>
                  <p className="text-xs text-muted-foreground">{order.acceptedBy.phone} · {order.acceptedBy.zone}</p>
                </div>
                <a href={`tel:${order.acceptedBy.phone}`} className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-300">
                  <Phone className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* Activity timeline */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Activity timeline</p>
            <div className="space-y-2">
              {order.activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p><span className="font-medium">{a.action}</span> <span className="text-muted-foreground">by {a.actor}</span></p>
                    {a.detail && <p className="text-muted-foreground">{a.detail}</p>}
                    <p className="text-[10px] text-muted-foreground">{timeAgo(a.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          {order.status === "escalated" && (
            <button onClick={() => onAssign(order)} className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-2.5 rounded-xl text-sm">
              Assign manually
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignModal({ order, providers, onClose, onAssigned }: {
  order: Job; providers: Provider[]; onClose: () => void; onAssigned: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleAssign() {
    if (!selected) return;
    setLoading(true);
    const res = await fetch(`/api/orders/${order.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: selected, actor: "admin" }),
    });
    if (res.ok) {
      toast.success(`Assigned #${order.code}`);
      onAssigned();
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-2xl border border-border animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <header className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Assign order #{order.code}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </header>
        <div className="p-4 space-y-1.5 max-h-[60vh] overflow-y-auto">
          {providers.filter((p) => p.isActive).map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={cn(
                "w-full text-left p-3 rounded-xl border transition-colors flex items-center gap-3",
                selected === p.id ? "border-emerald-500/40 bg-emerald-500/10" : "border-border hover:bg-card"
              )}
            >
              <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-300 text-xs font-medium">
                {p.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.zone} · ⭐ {p.rating} · {p.jobsDone} jobs</p>
              </div>
              {p.isOnline && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
            </button>
          ))}
        </div>
        <footer className="p-4 border-t border-border flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-border text-sm">Cancel</button>
          <button onClick={handleAssign} disabled={!selected || loading} className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 text-sm font-medium">
            {loading ? "Assigning…" : "Assign"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Escalation page
// ─────────────────────────────────────────────────────────────

function EscalationPage({ slug, cityId, orders, setOrders, providers, setProviders }: {
  slug: string; cityId: string | null;
  orders: Job[]; setOrders: (o: Job[]) => void;
  providers: Provider[]; setProviders: (p: Provider[]) => void;
}) {
  const [assignFor, setAssignFor] = useState<Job | null>(null);
  useEffect(() => {
    const params = new URLSearchParams({ tenantSlug: slug, status: "escalated" });
    if (cityId) params.set("cityId", cityId);
    fetch(`/api/orders?${params}`).then((r) => r.json()).then((d) => setOrders(d.orders || []));
    const p = new URLSearchParams({ tenantSlug: slug });
    if (cityId) p.set("cityId", cityId);
    fetch(`/api/providers?${p}`).then((r) => r.json()).then((d) => setProviders(d.providers || []));
    const id = setInterval(() => {
      fetch(`/api/orders?${params}`).then((r) => r.json()).then((d) => setOrders(d.orders || []));
    }, 6000);
    return () => clearInterval(id);
  }, [slug, cityId, setOrders, setProviders]);

  const escalated = orders.filter((o) => o.status === "escalated");

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
        <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-rose-300">Escalation center</p>
          <p className="text-xs text-rose-300/70">These orders weren't accepted by any provider. Assign manually.</p>
        </div>
        <span className="ml-auto text-2xl font-bold tnum text-rose-300">{escalated.length}</span>
      </div>

      {escalated.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No escalations" desc="All orders are being handled" accent="emerald" />
      ) : (
        <div className="space-y-2">
          {escalated.map((order) => {
            const labels = order.service ? safeParse<Record<string, string>>(order.service.labels, {}) : {};
            const svcName = order.service ? `${order.service.icon} ${labels.en || order.service.key}` : "Order";
            const items = safeParse<OrderItem[]>(order.items, []);
            return (
              <div key={order.id} className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-medium">#{order.code}</span>
                    <span className="text-xs text-muted-foreground ml-2">{svcName}</span>
                  </div>
                  <span className="text-xs text-rose-300">Escalated {timeAgo(order.escalatedAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {items.length > 0 ? `${items.length} item(s) · ${items[0]?.name}` : order.description}
                </p>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    <p>{order.customer.name || order.customer.phone}</p>
                    <p>{order.addressArea} · {order.timing}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <a href={`tel:${order.customer.phone}`} className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-emerald-300 hover:bg-emerald-500/10">
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                    <button onClick={() => setAssignFor(order)} className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-medium">
                      Assign
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {assignFor && (
        <AssignModal order={assignFor} providers={providers} onClose={() => setAssignFor(null)} onAssigned={() => {
          setAssignFor(null);
          const params = new URLSearchParams({ tenantSlug: slug, status: "escalated" });
          if (cityId) params.set("cityId", cityId);
          fetch(`/api/orders?${params}`).then((r) => r.json()).then((d) => setOrders(d.orders || []));
        }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Providers page
// ─────────────────────────────────────────────────────────────

function ProvidersPage({ slug, cityId, providers, setProviders, services, setServices, cities }: {
  slug: string; cityId: string | null;
  providers: Provider[]; setProviders: (p: Provider[]) => void;
  services: Service[]; setServices: (s: Service[]) => void;
  cities: CityT[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<Provider | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ tenantSlug: slug });
    if (cityId) params.set("cityId", cityId);
    fetch(`/api/providers?${params}`).then((r) => r.json()).then((d) => setProviders(d.providers || []));
    fetch(`/api/services?tenantSlug=${slug}`).then((r) => r.json()).then((d) => setServices(d.services || []));
  }, [slug, cityId, setProviders, setServices]);

  async function toggleOnline(p: Provider) {
    await fetch("/api/providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, isOnline: !p.isOnline }),
    });
    setProviders(providers.map((x) => x.id === p.id ? { ...x, isOnline: !x.isOnline } : x));
  }

  async function toggleActive(p: Provider) {
    await fetch("/api/providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
    });
    setProviders(providers.map((x) => x.id === p.id ? { ...x, isActive: !x.isActive } : x));
  }

  async function resetPin(p: Provider) {
    if (!confirm(`Reset PIN for ${p.name}? New PIN will be 1234.`)) return;
    await fetch("/api/providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, pin: "1234" }),
    });
    toast.success("PIN reset to 1234");
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{providers.length} providers</p>
        <button onClick={() => setAddOpen(true)} className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> Add provider
        </button>
      </div>

      {providers.length === 0 ? (
        <EmptyState icon={Users} title="No providers" desc="Add your first provider to start receiving orders" actionLabel="Add provider" onAction={() => setAddOpen(true)} />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {providers.map((p) => (
            <div key={p.id} className="p-4 rounded-xl border border-border bg-card">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-emerald-300 font-medium">
                  {p.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    {p.isOnline ? (
                      <span className="text-[10px] text-emerald-300 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" /> Online
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Offline</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{p.phone} · {p.zone || p.city.name}</p>
                </div>
                <div className="relative">
                  <button onClick={() => setEditProvider(p)} className="text-muted-foreground hover:text-foreground">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div className="p-2 rounded-lg bg-background border border-border">
                  <p className="text-[10px] text-muted-foreground">Rating</p>
                  <p className="text-sm font-medium flex items-center justify-center gap-0.5">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    {p.rating.toFixed(1)}
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-background border border-border">
                  <p className="text-[10px] text-muted-foreground">Jobs</p>
                  <p className="text-sm font-medium tnum">{p.jobsDone}</p>
                </div>
                <div className="p-2 rounded-lg bg-background border border-border">
                  <p className="text-[10px] text-muted-foreground">Earnings</p>
                  <p className="text-sm font-medium tnum">{formatINR(p.earnings)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {p.services.length === 0 ? (
                  <span className="text-[10px] text-muted-foreground">All services</span>
                ) : (
                  p.services.map((s) => {
                    const l = safeParse<Record<string, string>>(s.labels, {});
                    return <span key={s.id} className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-border">{s.icon} {l.en || s.key}</span>;
                  })
                )}
              </div>

              <div className="flex gap-1.5">
                <button onClick={() => toggleOnline(p)} className={cn("flex-1 text-xs py-1.5 rounded-lg border transition-colors", p.isOnline ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "border-border text-muted-foreground")}>
                  <Power className="w-3 h-3 inline" /> {p.isOnline ? "Online" : "Offline"}
                </button>
                <button onClick={() => toggleActive(p)} className={cn("flex-1 text-xs py-1.5 rounded-lg border transition-colors", p.isActive ? "border-border text-muted-foreground" : "bg-rose-500/10 border-rose-500/20 text-rose-300")}>
                  {p.isActive ? "Active" : "Inactive"}
                </button>
                <button onClick={() => resetPin(p)} className="text-xs py-1.5 px-2 rounded-lg border border-border text-muted-foreground hover:text-foreground">
                  <Key className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <AddProviderModal slug={slug} cities={cities} services={services} onClose={() => setAddOpen(false)} onAdded={() => {
          setAddOpen(false);
          const params = new URLSearchParams({ tenantSlug: slug });
          if (cityId) params.set("cityId", cityId);
          fetch(`/api/providers?${params}`).then((r) => r.json()).then((d) => setProviders(d.providers || []));
        }} />
      )}

      {editProvider && (
        <EditProviderModal provider={editProvider} services={services} cities={cities} onClose={() => setEditProvider(null)} onSaved={() => {
          setEditProvider(null);
          const params = new URLSearchParams({ tenantSlug: slug });
          if (cityId) params.set("cityId", cityId);
          fetch(`/api/providers?${params}`).then((r) => r.json()).then((d) => setProviders(d.providers || []));
        }} />
      )}
    </div>
  );
}

function AddProviderModal({ slug, cities, services, onClose, onAdded }: {
  slug: string; cities: CityT[]; services: Service[];
  onClose: () => void; onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+91");
  const [pin, setPin] = useState("1234");
  const [cityId, setCityId] = useState(cities[0]?.id || "");
  const [zone, setZone] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug, name, phone, pin, cityId, zone, serviceIds: selectedServices }),
    });
    if (res.ok) {
      toast.success("Provider added");
      onAdded();
    } else {
      const d = await res.json();
      toast.error(d.error || "Failed");
    }
    setLoading(false);
  }

  return (
    <Modal title="Add provider" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} /></Field>
        <Field label="4-digit PIN"><input value={pin} onChange={(e) => setPin(e.target.value)} maxLength={4} className={cn(inputCls, "font-mono tracking-[0.3em]")} /></Field>
        <Field label="City">
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputCls}>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Zone (area)"><input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Jawahar Nagar" className={inputCls} /></Field>
        <Field label="Services (empty = all)">
          <div className="flex flex-wrap gap-1.5">
            {services.filter((s) => s.kind !== "team" && s.kind !== "custom").map((s) => {
              const l = safeParse<Record<string, string>>(s.labels, {});
              const selected = selectedServices.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedServices(selected ? selectedServices.filter((x) => x !== s.id) : [...selectedServices, s.id])}
                  className={cn("text-xs px-2 py-1 rounded-lg border", selected ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" : "border-border text-muted-foreground")}
                >
                  {s.icon} {l.en || s.key}
                </button>
              );
            })}
          </div>
        </Field>
        <button onClick={handleSubmit} disabled={loading || !name || !phone} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm">
          {loading ? "Adding…" : "Add provider"}
        </button>
      </div>
    </Modal>
  );
}

function EditProviderModal({ provider, services, cities, onClose, onSaved }: {
  provider: Provider; services: Service[]; cities: CityT[];
  onClose: () => void; onSaved: () => void;
}) {
  const [zone, setZone] = useState(provider.zone || "");
  const [cityId, setCityId] = useState(provider.city.id);
  const [selectedServices, setSelectedServices] = useState<string[]>(provider.serviceIds);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setLoading(true);
    await fetch("/api/providers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: provider.id, zone, cityId, serviceIds: selectedServices }),
    });
    toast.success("Saved");
    onSaved();
    setLoading(false);
  }

  return (
    <Modal title={`Edit ${provider.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="City">
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputCls}>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Zone"><input value={zone} onChange={(e) => setZone(e.target.value)} className={inputCls} /></Field>
        <Field label="Services">
          <div className="flex flex-wrap gap-1.5">
            {services.filter((s) => s.kind !== "team" && s.kind !== "custom").map((s) => {
              const l = safeParse<Record<string, string>>(s.labels, {});
              const selected = selectedServices.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedServices(selected ? selectedServices.filter((x) => x !== s.id) : [...selectedServices, s.id])}
                  className={cn("text-xs px-2 py-1 rounded-lg border", selected ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" : "border-border text-muted-foreground")}
                >
                  {s.icon} {l.en || s.key}
                </button>
              );
            })}
          </div>
        </Field>
        <button onClick={handleSave} disabled={loading} className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-2.5 rounded-xl text-sm">
          {loading ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Customers page
// ─────────────────────────────────────────────────────────────

function CustomersPage({ slug, customers, setCustomers }: { slug: string; customers: Customer[]; setCustomers: (c: Customer[]) => void }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({ tenantSlug: slug });
    if (q) params.set("q", q);
    fetch(`/api/customers?${params}`).then((r) => r.json()).then((d) => setCustomers(d.customers || []));
  }, [slug, q, setCustomers]);

  async function toggleBlock(c: Customer) {
    await fetch("/api/customers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, isBlocked: !c.isBlocked }),
    });
    setCustomers(customers.map((x) => x.id === c.id ? { ...x, isBlocked: !x.isBlocked } : x));
    toast.success(c.isBlocked ? "Customer unblocked" : "Customer blocked");
  }

  async function exportCustomer(c: Customer) {
    toast.info("Exporting PII…");
    const res = await fetch(`/api/customers/${c.id}/export?tenantSlug=${slug}`);
    if (res.status === 403) {
      toast.error("Access denied");
      return;
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-${c.phone}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("PII exported (audit logged)");
  }

  async function deleteCustomer(c: Customer) {
    if (!confirm(`Delete PII for ${c.name || c.phone}?\n\nThis anonymizes their personal data. Orders are retained for accounting.\n\nThis action is audited.`)) return;
    const res = await fetch(`/api/customers/${c.id}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug }),
    });
    if (res.ok) {
      toast.success("Customer PII anonymized (audit logged)");
      // Refresh list
      const params = new URLSearchParams({ tenantSlug: slug });
      if (q) params.set("q", q);
      fetch(`/api/customers?${params}`).then((r) => r.json()).then((d) => setCustomers(d.customers || []));
    } else if (res.status === 403) {
      toast.error("Access denied");
    }
  }

  return (
    <div className="p-4 space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by phone or name…"
        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/40"
      />
      {customers.length === 0 ? (
        <EmptyState icon={User} title="No customers" desc="Customers who message your bot will appear here" />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-card border-b border-border">
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground">Name</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Phone</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Orders</th>
                <th className="text-left p-2 font-medium text-muted-foreground">LTV</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-border/40 hover:bg-card/50">
                  <td className="p-2">{c.name || "—"}</td>
                  <td className="p-2 font-mono">{c.phone}</td>
                  <td className="p-2 tnum">{c._count.orders}</td>
                  <td className="p-2 tnum">{formatINR(c.lifetimeValue)}</td>
                  <td className="p-2">
                    {c.isBlocked ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-300">Blocked</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">Active</span>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <button
                        onClick={() => toggleBlock(c)}
                        className={cn("text-[10px] px-2 py-1 rounded", c.isBlocked ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}
                      >
                        {c.isBlocked ? "Unblock" : "Block"}
                      </button>
                      <button
                        onClick={() => exportCustomer(c)}
                        className="text-[10px] px-2 py-1 rounded bg-card border border-border text-muted-foreground hover:text-foreground"
                        title="Export PII (GDPR)"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteCustomer(c)}
                        className="text-[10px] px-2 py-1 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                        title="Delete PII (GDPR right-to-be-forgotten)"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Services page
// ─────────────────────────────────────────────────────────────

function ServicesPage({ slug, services, setServices }: { slug: string; services: Service[]; setServices: (s: Service[]) => void }) {
  const [editService, setEditService] = useState<Service | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    fetch(`/api/services?tenantSlug=${slug}`).then((r) => r.json()).then((d) => setServices(d.services || []));
  }, [slug, setServices]);

  async function toggleActive(s: Service) {
    await fetch("/api/services", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, isActive: !s.isActive }),
    });
    setServices(services.map((x) => x.id === s.id ? { ...x, isActive: !x.isActive } : x));
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Menu services your customers see</p>
        <button onClick={() => setPreviewOpen(true)} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:border-emerald-500/30 flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" /> Preview chat
        </button>
      </div>

      <div className="space-y-2">
        {services.map((s) => {
          const labels = safeParse<Record<string, string>>(s.labels, {});
          return (
            <div key={s.id} className="p-3 rounded-xl border border-border bg-card flex items-center gap-3">
              <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
              <span className="text-2xl">{s.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{labels.en || s.key}</p>
                <p className="text-xs text-muted-foreground">
                  {s.kind} · {s.isActive ? "active" : "disabled"}
                </p>
              </div>
              <button onClick={() => toggleActive(s)} className={cn("text-xs px-2 py-1 rounded", s.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400")}>
                {s.isActive ? "Active" : "Disabled"}
              </button>
              <button onClick={() => setEditService(s)} className="text-muted-foreground hover:text-foreground">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {editService && (
        <EditServiceModal service={editService} onClose={() => setEditService(null)} onSaved={() => {
          setEditService(null);
          fetch(`/api/services?tenantSlug=${slug}`).then((r) => r.json()).then((d) => setServices(d.services || []));
        }} />
      )}

      {previewOpen && <PreviewChatModal services={services} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

function EditServiceModal({ service, onClose, onSaved }: { service: Service; onClose: () => void; onSaved: () => void }) {
  const labels = safeParse<Record<string, string>>(service.labels, {});
  const questions = safeParse<Record<string, string>>(service.questions, {});
  const [enLabel, setEnLabel] = useState(labels.en || "");
  const [hiLabel, setHiLabel] = useState(labels.hi || "");
  const [enQ, setEnQ] = useState(questions.en || "");
  const [icon, setIcon] = useState(service.icon);
  const [kind, setKind] = useState(service.kind);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setLoading(true);
    await fetch("/api/services", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: service.id,
        icon,
        kind,
        labels: { en: enLabel, hi: hiLabel },
        questions: { en: enQ, hi: "" },
      }),
    });
    toast.success("Saved");
    onSaved();
    setLoading(false);
  }

  return (
    <Modal title={`Edit ${labels.en || service.key}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Icon">
          <div className="flex gap-1.5 flex-wrap">
            {["🎂", "🛒", "🍗", "📦", "🚗", "🧰", "👥", "➕", "🍕", "💊", "🌸", "🔧"].map((e) => (
              <button key={e} onClick={() => setIcon(e)} className={cn("w-9 h-9 rounded-lg text-lg flex items-center justify-center border", icon === e ? "bg-emerald-500/15 border-emerald-500/30" : "border-border")}>{e}</button>
            ))}
          </div>
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
            <option value="order">Order (items)</option>
            <option value="book">Book (slot)</option>
            <option value="custom">Custom (quote)</option>
            <option value="team">Team (human)</option>
          </select>
        </Field>
        <Field label="Label (English)"><input value={enLabel} onChange={(e) => setEnLabel(e.target.value)} className={inputCls} /></Field>
        <Field label="Label (Hindi)"><input value={hiLabel} onChange={(e) => setHiLabel(e.target.value)} className={inputCls} /></Field>
        <Field label="Question (English)"><textarea value={enQ} onChange={(e) => setEnQ(e.target.value)} rows={2} className={inputCls} /></Field>
        <button onClick={handleSave} disabled={loading} className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-2.5 rounded-xl text-sm">
          {loading ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

function PreviewChatModal({ services, onClose }: { services: Service[]; onClose: () => void }) {
  return (
    <Modal title="Preview chat" onClose={onClose} wide>
      <div className="bg-zinc-950 rounded-xl p-4 max-h-[60vh] overflow-y-auto">
        <p className="text-xs text-zinc-500 mb-3">This is what the customer sees when they message your bot.</p>
        <div className="space-y-2">
          <div className="bg-zinc-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[80%]">
            Welcome to *CityHelp*! 👋 Choose your language:
          </div>
          <div className="bg-zinc-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[80%]">
            <p className="mb-2">What would you like today?</p>
            <p className="text-emerald-300 text-xs">📋 View Menu</p>
          </div>
          <div className="bg-emerald-600 rounded-2xl rounded-tr-sm px-3 py-2 text-sm max-w-[80%] ml-auto text-white">
            🛒 Grocery
          </div>
          <div className="bg-zinc-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[80%]">
            🛒 Send your grocery list — type below, send a voice note, or photo of a handwritten list.
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Cities page
// ─────────────────────────────────────────────────────────────

function CitiesPage({ slug, cities, setCities }: { slug: string; cities: CityT[]; setCities: (c: CityT[]) => void }) {
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);

  async function addCity() {
    setLoading(true);
    const res = await fetch("/api/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug, name, state }),
    });
    if (res.ok) {
      toast.success("City added");
      setName(""); setState("");
      fetch(`/api/cities?tenantSlug=${slug}`).then((r) => r.json()).then((d) => setCities(d.cities || []));
    } else {
      const d = await res.json();
      toast.error(d.message || d.error);
    }
    setLoading(false);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="p-4 rounded-xl border border-border bg-card">
        <p className="text-sm font-medium mb-3">Add city</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="City name" className={inputCls} />
          <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State (optional)" className={inputCls} />
        </div>
        <button onClick={addCity} disabled={loading || !name} className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 text-xs font-medium px-3 py-1.5 rounded-lg">
          Add city
        </button>
      </div>

      <div className="space-y-2">
        {cities.map((c) => (
          <div key={c.id} className="p-3 rounded-xl border border-border bg-card flex items-center gap-3">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.state}</p>
            </div>
            <span className={cn("text-xs px-2 py-1 rounded-full", c.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400")}>
              {c.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// WhatsApp settings page
// ─────────────────────────────────────────────────────────────

function WhatsAppPage({ tenant }: { tenant: { name: string; waBusinessName: string | null; waVerified: boolean } | null }) {
  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium">WhatsApp Business connection</p>
            <p className="text-xs text-muted-foreground">Status of your WhatsApp Cloud API connection</p>
          </div>
          {tenant?.waVerified ? (
            <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Connected
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-300">Pending</span>
          )}
        </div>
        <div className="space-y-2 text-xs">
          <Row label="Business name" value={tenant?.waBusinessName || "—"} />
          <Row label="Phone number ID" value="shanti-wa-001" mono />
          <Row label="Webhook URL" value="https://cityhelp.app/api/whatsapp/webhook" mono />
          <Row label="Verify token" value="••••••••" mono />
        </div>
      </div>

      <div className="p-4 rounded-xl border border-border bg-card">
        <p className="text-sm font-medium mb-2">Webhook security</p>
        <p className="text-xs text-muted-foreground mb-3">
          Every incoming webhook is verified via X-Hub-Signature-256 HMAC check. Duplicate deliveries (same message ID) are ignored.
        </p>
        <div className="bg-background rounded-lg p-3 text-xs font-mono text-emerald-300">
          ✓ Signature verified<br />
          ✓ Message ID deduplicated<br />
          ✓ Rate-limited per phone
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AI BYOK page
// ─────────────────────────────────────────────────────────────

function AIPage({ slug }: { slug: string }) {
  const [providers, setProviders] = useState<Array<{ id: string; label: string; baseUrl: string; apiKeyMask: string; testStatus: string; supportsChat: boolean; supportsImage: boolean; supportsAudio: boolean }>>([]);
  const [routes, setRoutes] = useState<Array<{ task: string; providerId: string | null; modelName: string | null; fallbackProviderId: string | null }>>([]);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/ai?tenantSlug=${slug}`).then((r) => r.json()).then((d) => {
      setProviders(d.providers || []);
      setRoutes(d.routes || []);
    });
  }, [slug]);

  const tasks = [
    { task: "extract_grocery", label: "Extract grocery items", desc: "Parse typed lists into structured items" },
    { task: "read_photo", label: "Read photo of a list", desc: "OCR + extraction from handwritten lists" },
    { task: "transcribe_voice", label: "Transcribe voice note", desc: "Audio → text transcription" },
    { task: "parse_loose", label: "Parse loose answers", desc: 'Lenient parsing: "half kg" → 500g' },
    { task: "classify_custom", label: "Classify custom requests", desc: "Route unknown messages to the right team" },
    { task: "free_chat", label: "Free-chat assistant", desc: "Conversational fallback for the team" },
  ];

  async function testProvider(id: string) {
    toast.info("Testing connection…");
    const res = await fetch("/api/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "test", modelName: "gpt-4o-mini" }),
    });
    const data = await res.json();
    if (data.ok) {
      toast.success("✓ Connection works");
      setProviders(providers.map((p) => p.id === id ? { ...p, testStatus: "ok" } : p));
    } else {
      toast.error("Connection failed");
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      {/* Banner */}
      {providers.length === 0 && (
        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-300">AI is not configured</p>
            <p className="text-xs text-amber-300/70 mt-1">
              Without AI, voice notes / photos / free-text will be saved as custom orders for human handling.
              The bot will never fail because of AI.
            </p>
          </div>
        </div>
      )}

      {/* Providers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">AI Providers</h3>
          <button onClick={() => setAddOpen(true)} className="text-xs bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Add provider
          </button>
        </div>
        {providers.length === 0 ? (
          <EmptyState icon={Sparkles} title="No AI providers" desc="Add an OpenAI-compatible provider (OpenAI, Groq, DeepSeek, Mistral, OpenRouter)" />
        ) : (
          <div className="space-y-2">
            {providers.map((p) => (
              <div key={p.id} className="p-3 rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground font-mono">{p.baseUrl}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{p.apiKeyMask}</span>
                    {p.testStatus === "ok" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">✓ Tested</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {p.supportsChat && <span className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-border">Chat</span>}
                    {p.supportsImage && <span className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-border">Image</span>}
                    {p.supportsAudio && <span className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-border">Audio</span>}
                  </div>
                  <button onClick={() => testProvider(p.id)} className="ml-auto text-xs px-2 py-1 rounded border border-border hover:border-emerald-500/30">
                    Test
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Task routing */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Task routing</h3>
        <div className="space-y-2">
          {tasks.map((t) => {
            const route = routes.find((r) => r.task === t.task);
            return (
              <div key={t.task} className="p-3 rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-xs text-muted-foreground">{t.desc}</p>
                  </div>
                  <select
                    value={route?.providerId || ""}
                    onChange={async (e) => {
                      await fetch("/api/ai", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "route", tenantSlug: slug, task: t.task, providerId: e.target.value || null, modelName: e.target.value ? "gpt-4o-mini" : null }),
                      });
                      toast.success("Route updated");
                      fetch(`/api/ai?tenantSlug=${slug}`).then((r) => r.json()).then((d) => setRoutes(d.routes || []));
                    }}
                    className="bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none"
                  >
                    <option value="">— None (human fallback) —</option>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {addOpen && <AddAiProviderModal slug={slug} onClose={() => setAddOpen(false)} onAdded={() => {
        setAddOpen(false);
        fetch(`/api/ai?tenantSlug=${slug}`).then((r) => r.json()).then((d) => setProviders(d.providers || []));
      }} />}
    </div>
  );
}

function AddAiProviderModal({ slug, onClose, onAdded }: { slug: string; onClose: () => void; onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug, label, baseUrl, apiKey, modelName: "gpt-4o-mini" }),
    });
    if (res.ok) {
      toast.success("Provider added");
      onAdded();
    } else {
      toast.error("Failed");
    }
    setLoading(false);
  }

  return (
    <Modal title="Add AI provider" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground p-2 rounded-lg bg-background border border-border">
          Any OpenAI-compatible endpoint works: OpenAI, Groq, DeepSeek, Mistral, OpenRouter, Gemini's OpenAI-compatible endpoint, self-hosted vLLM.
        </div>
        <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. OpenAI Main" className={inputCls} /></Field>
        <Field label="Base URL"><input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={cn(inputCls, "font-mono text-xs")} /></Field>
        <Field label="API Key">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={inputCls}
              placeholder="sk-..."
            />
            <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Encrypted at rest. Never shown again. Never in logs.</p>
        </Field>
        <button onClick={handleSubmit} disabled={loading || !label || !apiKey} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm">
          {loading ? "Adding…" : "Add provider"}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Team, Notifications, etc.
// ─────────────────────────────────────────────────────────────

function TeamPage({ slug, staffEmail }: { slug: string; staffEmail: string }) {
  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="p-4 rounded-xl border border-border bg-card">
        <p className="text-sm font-medium mb-1">{staffEmail}</p>
        <p className="text-xs text-muted-foreground">You · Owner · Full access</p>
      </div>
      <div className="p-4 rounded-xl border border-dashed border-border text-center">
        <Users className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Invite team members</p>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">Staff can have orders-only or full access (incl. billing & AI keys)</p>
        <button className="text-xs bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium px-3 py-1.5 rounded-lg">Invite</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Billing page — current plan, usage, invoices, upgrade
// ─────────────────────────────────────────────────────────────

function BillingPage({ slug }: { slug: string }) {
  const [data, setData] = useState<{
    tenant: { name: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null; dunningStartedAt: string | null };
    currentPlan: { id: string; name: string; priceMonthly: number; limitCities: number; limitOrders: number; limitWhatsApp: number; limitSeats: number; featureEmail: boolean; featureApi: boolean; featureCustomDomain: boolean; featureWorkflow: boolean };
    limits: { cities: number; orders: number; whatsapp: number; seats: number; featureEmail: boolean; featureApi: boolean };
    usage: { cities: number; ordersThisMonth: number; whatsapp: number; seats: number };
    availablePlans: Array<{ id: string; name: string; priceMonthly: number; limitCities: number; limitOrders: number; limitWhatsApp: number; limitSeats: number }>;
  } | null>(null);
  const [invoices, setInvoices] = useState<Array<{ id: string; invoiceNumber: string; amount: number; planName: string; status: string; paidAt: string | null; periodStart: string; periodEnd: string; paymentMethod: string | null }>>([]);
  const [checkoutOpen, setCheckoutOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/billing/plan?tenantSlug=${slug}`).then((r) => r.json()).then(setData);
    fetch(`/api/billing/invoices?tenantSlug=${slug}`).then((r) => r.json()).then((d) => setInvoices(d.invoices || []));
  }, [slug]);

  if (!data) return <div className="p-6"><div className="h-32 shimmer rounded-xl" /></div>;

  const usagePercent = (current: number, limit: number) => limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      {/* Current plan */}
      <div className="p-5 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Current plan</p>
            <p className="text-xl font-semibold mt-0.5">{data.currentPlan.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              ₹{data.currentPlan.priceMonthly / 100}/mo · {data.tenant.status}
              {data.tenant.trialEndsAt && ` · trial ends ${timeAgo(data.tenant.trialEndsAt)}`}
              {data.tenant.dunningStartedAt && <span className="text-rose-300 ml-1">· dunning (payment failed)</span>}
            </p>
          </div>
          {data.tenant.dunningStartedAt && (
            <span className="text-xs px-2 py-1 rounded-full bg-rose-500/15 text-rose-300">Payment overdue</span>
          )}
        </div>

        {/* Usage bars */}
        <div className="space-y-3">
          <UsageBar label="Cities" current={data.usage.cities} limit={data.limits.cities} />
          <UsageBar label="Orders this month" current={data.usage.ordersThisMonth} limit={data.limits.orders} />
          <UsageBar label="WhatsApp numbers" current={data.usage.whatsapp} limit={data.limits.whatsapp} />
          <UsageBar label="Team seats" current={data.usage.seats} limit={data.limits.seats} />
        </div>
      </div>

      {/* Available plans */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Available plans</h3>
        <div className="grid md:grid-cols-3 gap-3">
          {data.availablePlans.map((p) => {
            const isCurrent = p.id === data.currentPlan.id;
            return (
              <div key={p.id} className={cn("p-4 rounded-xl border bg-card", isCurrent ? "border-emerald-500/40" : "border-border")}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">{p.name}</h4>
                  {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">Current</span>}
                </div>
                <p className="text-2xl font-semibold tnum mb-3">₹{p.priceMonthly / 100}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
                <ul className="space-y-1 text-xs text-muted-foreground mb-3">
                  <li>{p.limitCities === 999 ? "Unlimited" : p.limitCities} cities</li>
                  <li>{p.limitOrders === 999999 ? "Unlimited" : p.limitOrders.toLocaleString()} orders/mo</li>
                  <li>{p.limitWhatsApp === 999 ? "Unlimited" : p.limitWhatsApp} WhatsApp numbers</li>
                  <li>{p.limitSeats === 999 ? "Unlimited" : p.limitSeats} team seats</li>
                </ul>
                {!isCurrent && (
                  <button
                    onClick={() => setCheckoutOpen(p.id)}
                    className="w-full text-xs py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium"
                  >
                    Upgrade to {p.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoices */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Invoices</h3>
        {invoices.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-border text-center">
            <CreditCard className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">No invoices yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Upgrade to a paid plan to see invoices here</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-card border-b border-border">
                <tr>
                  <th className="text-left p-2 font-medium text-muted-foreground">Invoice</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Plan</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Period</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border/40">
                    <td className="p-2 font-mono">{inv.invoiceNumber}</td>
                    <td className="p-2">{inv.planName}</td>
                    <td className="p-2 tnum">₹{inv.amount / 100}</td>
                    <td className="p-2 text-muted-foreground">{new Date(inv.periodStart).toLocaleDateString()} – {new Date(inv.periodEnd).toLocaleDateString()}</td>
                    <td className="p-2">
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px]",
                        inv.status === "paid" ? "bg-emerald-500/15 text-emerald-300" :
                        inv.status === "failed" ? "bg-rose-500/15 text-rose-300" :
                        "bg-amber-500/15 text-amber-300"
                      )}>{inv.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {checkoutOpen && (
        <CheckoutModal planId={checkoutOpen} slug={slug} onClose={() => setCheckoutOpen(null)} onDone={() => {
          setCheckoutOpen(null);
          fetch(`/api/billing/plan?tenantSlug=${slug}`).then((r) => r.json()).then(setData);
          fetch(`/api/billing/invoices?tenantSlug=${slug}`).then((r) => r.json()).then((d) => setInvoices(d.invoices || []));
        }} />
      )}
    </div>
  );
}

function UsageBar({ label, current, limit }: { label: string; current: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
  const color = percent >= 100 ? "bg-rose-500" : percent >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs tnum">{current} / {limit === 999 ? "∞" : limit} {percent >= 80 && <span className="text-amber-400 ml-1">({percent}%)</span>}</span>
      </div>
      <div className="h-1.5 bg-background rounded-full overflow-hidden">
        <div className={cn("h-full transition-all", color)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function CheckoutModal({ planId, slug, onClose, onDone }: { planId: string; slug: string; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; billingConfigured: boolean; invoiceNumber?: string; planName?: string; message?: string } | null>(null);

  async function handleCheckout() {
    setLoading(true);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug, planId }),
    });
    const data = await res.json();
    setResult(data);
    setLoading(false);
    if (data.ok || data.billingConfigured === false) {
      // In production, Razorpay checkout would open here
      setTimeout(() => onDone(), 2000);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-2xl border border-border p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-1">Upgrade plan</h3>
        <p className="text-xs text-muted-foreground mb-4">You'll be redirected to Razorpay's secure checkout.</p>
        {result ? (
          <div className={cn("p-3 rounded-lg text-xs", result.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300")}>
            {result.ok ? `✓ Checkout initiated. Invoice ${result.invoiceNumber} created.` : result.message || "Billing not yet configured. Contact support."}
          </div>
        ) : (
          <button onClick={handleCheckout} disabled={loading} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2.5 rounded-xl text-sm">
            {loading ? "Creating checkout…" : "Continue to checkout"}
          </button>
        )}
        <button onClick={onClose} className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

function NotificationsPage({ slug }: { slug: string }) {
  return (
    <div className="p-4 space-y-3 max-w-2xl">
      <NotifToggle title="Escalation push" desc="Get a push notification when an order escalates" defaultOn />
      <NotifToggle title="Escalation email" desc="Also send an email (requires Resend)" />
      <NotifToggle title="Daily digest" desc="Orders, revenue, provider performance at 9 AM" defaultOn />
      <NotifToggle title="Weekly report" desc="Mondays at 9 AM" />
      <NotifToggle title="Plan limit warning" desc="At 80% and 100% of plan limits" defaultOn />
    </div>
  );
}

function NotifToggle({ title, desc, defaultOn }: { title: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(!!defaultOn);
  return (
    <div className="p-3 rounded-xl border border-border bg-card flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <button
        onClick={() => setOn(!on)}
        className={cn("relative w-10 h-6 rounded-full transition-colors", on ? "bg-emerald-500" : "bg-zinc-700")}
      >
        <span className={cn("absolute top-1 w-4 h-4 rounded-full bg-white transition-transform", on ? "translate-x-5" : "translate-x-1")} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Command palette
// ─────────────────────────────────────────────────────────────

function CommandPalette({ onClose, onNavigate, orders, providers, customers }: {
  onClose: () => void;
  onNavigate: (page: "dashboard" | "orders" | "escalation" | "providers" | "customers" | "services") => void;
  orders: Job[]; providers: Provider[]; customers: Customer[];
}) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (!q) return { orders: [], providers: [], customers: [] };
    const lq = q.toLowerCase();
    return {
      orders: orders.filter((o) => o.code.includes(q) || o.customer.name?.toLowerCase().includes(lq) || o.customer.phone.includes(q)).slice(0, 3),
      providers: providers.filter((p) => p.name.toLowerCase().includes(lq) || p.phone.includes(q)).slice(0, 3),
      customers: customers.filter((c) => c.name?.toLowerCase().includes(lq) || c.phone.includes(q)).slice(0, 3),
    };
  }, [q, orders, providers, customers]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div className="bg-card w-full max-w-xl rounded-2xl border border-border overflow-hidden animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-3 border-b border-border flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search orders, providers, customers, or jump to…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-background font-mono">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {!q && (
            <div className="p-2">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">Quick actions</p>
              {[
                { label: "Go to dashboard", page: "dashboard" as const, icon: LayoutDashboard },
                { label: "View orders", page: "orders" as const, icon: Package },
                { label: "Escalation center", page: "escalation" as const, icon: AlertTriangle },
                { label: "Manage providers", page: "providers" as const, icon: Users },
                { label: "Manage customers", page: "customers" as const, icon: User },
                { label: "Edit services", page: "services" as const, icon: Bot },
              ].map((a) => (
                <button key={a.page} onClick={() => onNavigate(a.page)} className="w-full text-left p-2 rounded-lg hover:bg-card flex items-center gap-2.5 text-sm">
                  <a.icon className="w-4 h-4 text-muted-foreground" />
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {q && (
            <div className="p-2">
              {results.orders.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">Orders</p>
                  {results.orders.map((o) => (
                    <button key={o.id} onClick={() => onNavigate("orders")} className="w-full text-left p-2 rounded-lg hover:bg-card flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs">#{o.code}</span>
                      <span className="text-muted-foreground">{o.customer.name || o.customer.phone}</span>
                    </button>
                  ))}
                </>
              )}
              {results.providers.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Providers</p>
                  {results.providers.map((p) => (
                    <button key={p.id} onClick={() => onNavigate("providers")} className="w-full text-left p-2 rounded-lg hover:bg-card flex items-center gap-2 text-sm">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      {p.name} <span className="text-xs text-muted-foreground">{p.phone}</span>
                    </button>
                  ))}
                </>
              )}
              {results.customers.length > 0 && (
                <>
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Customers</p>
                  {results.customers.map((c) => (
                    <button key={c.id} onClick={() => onNavigate("customers")} className="w-full text-left p-2 rounded-lg hover:bg-card flex items-center gap-2 text-sm">
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      {c.name || c.phone}
                    </button>
                  ))}
                </>
              )}
              {results.orders.length === 0 && results.providers.length === 0 && results.customers.length === 0 && (
                <p className="p-4 text-center text-xs text-muted-foreground">No results for "{q}"</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared UI helpers
// ─────────────────────────────────────────────────────────────

const inputCls = "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={cn("bg-card rounded-2xl border border-border max-h-[90vh] overflow-y-auto animate-scale-in", wide ? "w-full max-w-2xl" : "w-full max-w-md")} onClick={(e) => e.stopPropagation()}>
        <header className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="p-4 rounded-xl border border-border bg-card">
      <div className="h-3 w-20 shimmer rounded mb-3" />
      <div className="h-6 w-16 shimmer rounded mb-3" />
      <div className="h-2 w-full shimmer rounded" />
    </div>
  );
}

function EmptyState({
  icon: Icon, title, desc, actionLabel, onAction, accent,
}: {
  icon: typeof Package; title: string; desc: string; actionLabel?: string; onAction?: () => void; accent?: "emerald";
}) {
  return (
    <div className={cn("p-8 rounded-xl border border-dashed text-center", accent === "emerald" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border")}>
      <div className={cn("w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center", accent === "emerald" ? "bg-emerald-500/15" : "bg-card border border-border")}>
        <Icon className={cn("w-6 h-6", accent === "emerald" ? "text-emerald-400" : "text-muted-foreground")} />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 mb-3">{desc}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="text-xs bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium px-3 py-1.5 rounded-lg">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
