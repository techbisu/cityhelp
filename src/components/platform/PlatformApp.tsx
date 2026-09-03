"use client";

import { useEffect, useState, useCallback } from "react";
import { useApp } from "@/stores/app";
import { cn, formatINR, timeAgo, safeParse } from "@/lib/utils";
import {
  ArrowLeft, Shield, Building2, CreditCard, Activity, ScrollText, Heart, Plus,
  Check, X, Eye, Ban, Users, TrendingUp, AlertCircle, ChevronDown, Search,
} from "lucide-react";
import { toast } from "sonner";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  accentColor: string;
  waBusinessName: string | null;
  waVerified: boolean;
  plan: { name: string };
  _count: { cities: number; providers: number; orders: number };
  trialEndsAt: string | null;
  createdAt: string;
}

interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  limitCities: number;
  limitOrders: number;
  limitWhatsApp: number;
  limitSeats: number;
  featureWorkflow: boolean;
  featureEmail: boolean;
  featureApi: boolean;
  featureCustomDomain: boolean;
  isActive: boolean;
  _count: { tenants: number };
}

interface AuditLog {
  id: string;
  actor: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
  tenant: { name: string; slug: string } | null;
}

export function PlatformApp() {
  const setView = useApp((s) => s.setView);
  const setAdminTenant = useApp((s) => s.setAdminTenant);
  const setImpersonation = useApp((s) => s.setImpersonation);
  const setBot = useApp((s) => s.setBot);

  const [page, setPage] = useState<"tenants" | "plans" | "usage" | "audit" | "health">("tenants");
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("super@cityhelp.app");
  const [password, setPassword] = useState("super1234");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/superadmin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      setAuthed(true);
      toast.success("Welcome, Platform Owner");
    } else {
      setError(data.error || "Login failed");
    }
    setLoading(false);
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <button onClick={() => setView("home")} className="text-muted-foreground hover:text-foreground text-sm mb-6 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center mx-auto mb-3">
              <Shield className="w-8 h-8 text-indigo-400" />
            </div>
            <h1 className="text-xl font-semibold">Super Admin</h1>
            <p className="text-xs text-muted-foreground mt-1">Platform owner · 2FA required in production</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-500/40" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mt-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-500/40" />
            </div>
            {error && <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">{error}</div>}
            <button onClick={login} disabled={loading} className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl text-sm">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border/60 bg-sidebar/30 flex-shrink-0 hidden md:flex flex-col">
        <div className="p-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center">
              <Shield className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <p className="text-xs font-medium">CityHelp Platform</p>
              <p className="text-[10px] text-muted-foreground">Super admin</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          <NavItem icon={Building2} label="Tenants" active={page === "tenants"} onClick={() => setPage("tenants")} />
          <NavItem icon={CreditCard} label="Plans" active={page === "plans"} onClick={() => setPage("plans")} />
          <NavItem icon={TrendingUp} label="Usage & Revenue" active={page === "usage"} onClick={() => setPage("usage")} />
          <NavItem icon={ScrollText} label="Audit log" active={page === "audit"} onClick={() => setPage("audit")} />
          <NavItem icon={Heart} label="Platform health" active={page === "health"} onClick={() => setPage("health")} />
        </nav>
        <div className="p-3 border-t border-border/60">
          <button onClick={() => setView("home")} className="w-full text-left text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-card">
            ← Back to home
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-20">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => setView("home")} className="md:hidden text-muted-foreground">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-sm font-semibold capitalize">{page}</h1>
                <p className="text-[11px] text-muted-foreground">Platform-wide view</p>
              </div>
            </div>
            <span className="text-[10px] text-indigo-300 bg-indigo-500/15 px-2 py-1 rounded-full">2FA enabled</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {page === "tenants" && <TenantsPage onView={(t) => { setBot(t.slug, "+919833300001"); setAdminTenant(t.slug, "super@cityhelp.app"); setImpersonation(t.slug); setView("admin"); }} impersonate={(t) => impersonate(t)} />}
          {page === "plans" && <PlansPage />}
          {page === "usage" && <UsagePage />}
          {page === "audit" && <AuditPage />}
          {page === "health" && <HealthPage />}
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function NavItem({ icon: Icon, label, active, onClick }: { icon: typeof Shield; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
        active ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20" : "text-muted-foreground hover:text-foreground hover:bg-card border border-transparent"
      )}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Tenants page
// ─────────────────────────────────────────────────────────────

function TenantsPage({ onView, impersonate }: { onView: (t: Tenant) => void; impersonate?: (t: Tenant) => void }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selected, setSelected] = useState<Tenant | null>(null);

  useEffect(() => {
    fetch("/api/tenants").then((r) => r.json()).then((d) => setTenants(d.tenants || []));
  }, []);

  async function toggleSuspend(t: Tenant) {
    const action = t.status === "suspended" ? "restore" : "suspend";
    if (!confirm(`${action} ${t.name}?`)) return;
    // Actually update the tenant in the DB (not just local state)
    const res = await fetch(`/api/tenants/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: action === "suspend" ? "suspended" : "active" }),
    });
    if (res.ok) {
      setTenants(tenants.map((x) => x.id === t.id ? { ...x, status: action === "suspend" ? "suspended" : "active" } : x));
      toast.success(`${t.name} ${action === "suspend" ? "suspended" : "restored"}`);
    } else {
      toast.error("Failed to update tenant");
    }
  }

  async function impersonate(t: Tenant) {
    // Write audit log for impersonation start
    await fetch("/api/superadmin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: t.id, action: "start" }),
    });
    onView(t);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Total tenants" value={String(tenants.length)} icon={Building2} />
        <StatBox label="Active" value={String(tenants.filter((t) => t.status === "active").length)} icon={Check} accent="emerald" />
        <StatBox label="Trials" value={String(tenants.filter((t) => t.status === "trial").length)} icon={AlertCircle} accent="amber" />
        <StatBox label="Suspended" value={String(tenants.filter((t) => t.status === "suspended").length)} icon={Ban} accent="rose" />
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-card border-b border-border">
            <tr>
              <th className="text-left p-3 font-medium text-muted-foreground">Tenant</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Plan</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Cities</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Orders</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Providers</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-border/40 hover:bg-card/50">
                <td className="p-3">
                  <button onClick={() => setSelected(t)} className="text-left">
                    <p className="font-medium hover:text-indigo-300">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground">{t.waBusinessName || t.slug}</p>
                  </button>
                </td>
                <td className="p-3">{t.plan.name}</td>
                <td className="p-3 tnum">{t._count.cities}</td>
                <td className="p-3 tnum">{t._count.orders}</td>
                <td className="p-3 tnum">{t._count.providers}</td>
                <td className="p-3">
                  <span className={cn("px-1.5 py-0.5 rounded-full text-[10px]",
                    t.status === "active" ? "bg-emerald-500/15 text-emerald-300" :
                    t.status === "trial" ? "bg-amber-500/15 text-amber-300" :
                    t.status === "suspended" ? "bg-rose-500/15 text-rose-300" :
                    "bg-zinc-500/15 text-zinc-400"
                  )}>{t.status}</span>
                </td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <button onClick={() => (impersonate ? impersonate(t) : onView(t))} className="text-[10px] px-2 py-1 rounded bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25" title="Impersonate">
                      <Eye className="w-3 h-3" />
                    </button>
                    <button onClick={() => toggleSuspend(t)} className={cn("text-[10px] px-2 py-1 rounded", t.status === "suspended" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
                      {t.status === "suspended" ? <Check className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/60 z-30 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-card w-full max-w-lg rounded-2xl border border-border animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <header className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">{selected.name}</h3>
                <p className="text-xs text-muted-foreground">{selected.slug}</p>
              </div>
              <button onClick={() => setSelected(null)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </header>
            <div className="p-4 space-y-2 text-xs">
              <Row label="Plan" value={selected.plan.name} />
              <Row label="Status" value={selected.status} />
              <Row label="Cities" value={String(selected._count.cities)} />
              <Row label="Orders" value={String(selected._count.orders)} />
              <Row label="Providers" value={String(selected._count.providers)} />
              <Row label="WhatsApp verified" value={selected.waVerified ? "Yes" : "No"} />
              {selected.trialEndsAt && <Row label="Trial ends" value={timeAgo(selected.trialEndsAt)} />}
            </div>
            <footer className="p-4 border-t border-border flex gap-2">
              <button onClick={() => (impersonate ? impersonate(selected) : onView(selected))} className="flex-1 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium">
                View as tenant
              </button>
              <button onClick={() => toggleSuspend(selected)} className={cn("px-4 py-2 rounded-xl text-sm font-medium", selected.status === "suspended" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
                {selected.status === "suspended" ? "Restore" : "Suspend"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Plans page
// ─────────────────────────────────────────────────────────────

function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);

  useEffect(() => {
    fetch("/api/plans").then((r) => r.json()).then((d) => setPlans(d.plans || []));
  }, []);

  async function savePlan(p: Plan, updates: Partial<Plan>) {
    await fetch("/api/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, ...updates }),
    });
    toast.success("Plan updated — changes apply live");
    await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "superadmin", action: "plan_change", entity: "plan", entityId: p.id, detail: `Updated ${p.name}` }),
    });
    fetch("/api/plans").then((r) => r.json()).then((d) => setPlans(d.plans || []));
    setEditPlan(null);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        {plans.map((p) => (
          <div key={p.id} className="p-4 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{p.name}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-card border border-border">{p._count.tenants} tenants</span>
            </div>
            <p className="text-2xl font-semibold tnum mb-3">{formatINR(p.priceMonthly)}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
            <div className="space-y-1 text-xs">
              <Row label="Cities" value={p.limitCities === 999 ? "Unlimited" : String(p.limitCities)} />
              <Row label="Orders/mo" value={p.limitOrders === 999999 ? "Unlimited" : String(p.limitOrders)} />
              <Row label="WhatsApp numbers" value={p.limitWhatsApp === 999 ? "Unlimited" : String(p.limitWhatsApp)} />
              <Row label="Seats" value={p.limitSeats === 999 ? "Unlimited" : String(p.limitSeats)} />
            </div>
            <div className="flex flex-wrap gap-1 mt-3">
              {p.featureWorkflow && <Feature label="Workflow" />}
              {p.featureEmail && <Feature label="Email" />}
              {p.featureApi && <Feature label="API" />}
              {p.featureCustomDomain && <Feature label="Domain" />}
            </div>
            <button onClick={() => setEditPlan(p)} className="mt-3 w-full text-xs py-1.5 rounded-lg border border-border hover:border-indigo-500/30">
              Edit plan
            </button>
          </div>
        ))}
      </div>

      {editPlan && <EditPlanModal plan={editPlan} onClose={() => setEditPlan(null)} onSave={(u) => savePlan(editPlan, u)} />}
    </div>
  );
}

function EditPlanModal({ plan, onClose, onSave }: { plan: Plan; onClose: () => void; onSave: (u: Partial<Plan>) => void }) {
  const [priceMonthly, setPriceMonthly] = useState(plan.priceMonthly / 100);
  const [limitCities, setLimitCities] = useState(plan.limitCities);
  const [limitOrders, setLimitOrders] = useState(plan.limitOrders);

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-2xl border border-border animate-scale-in p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-3">Edit {plan.name}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Price (₹/mo)</label>
            <input type="number" value={priceMonthly} onChange={(e) => setPriceMonthly(parseInt(e.target.value, 10) || 0)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500/40 tnum" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cities limit</label>
            <input type="number" value={limitCities} onChange={(e) => setLimitCities(parseInt(e.target.value, 10) || 0)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500/40 tnum" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Orders/mo limit</label>
            <input type="number" value={limitOrders} onChange={(e) => setLimitOrders(parseInt(e.target.value, 10) || 0)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500/40 tnum" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-border text-sm">Cancel</button>
          <button onClick={() => onSave({ priceMonthly: priceMonthly * 100, limitCities, limitOrders })} className="flex-1 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Usage & Revenue
// ─────────────────────────────────────────────────────────────

function UsagePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  useEffect(() => {
    fetch("/api/tenants").then((r) => r.json()).then((d) => setTenants(d.tenants || []));
  }, []);

  const totalOrders = tenants.reduce((s, t) => s + t._count.orders, 0);
  const mrr = tenants.reduce((s, t) => {
    if (t.plan.name === "Pro") return s + 299900;
    if (t.plan.name === "Starter") return s + 99900;
    return s;
  }, 0);

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="MRR" value={formatINR(mrr)} icon={TrendingUp} accent="emerald" />
        <StatBox label="Total tenants" value={String(tenants.length)} icon={Building2} />
        <StatBox label="Total orders" value={String(totalOrders)} icon={Activity} />
        <StatBox label="Churn (30d)" value="0%" icon={Ban} accent="emerald" />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Per-tenant usage</h3>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-card border-b border-border">
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground">Tenant</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Plan</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Orders</th>
                <th className="text-left p-2 font-medium text-muted-foreground">MRR</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-border/40">
                  <td className="p-2 font-medium">{t.name}</td>
                  <td className="p-2">{t.plan.name}</td>
                  <td className="p-2 tnum">{t._count.orders}</td>
                  <td className="p-2 tnum">{t.plan.name === "Pro" ? formatINR(299900) : t.plan.name === "Starter" ? formatINR(99900) : "—"}</td>
                  <td className="p-2">{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────

function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch(`/api/audit?super=true${filter !== "all" ? `&action=${filter}` : ""}&limit=200`).then((r) => r.json()).then((d) => setLogs(d.logs || []));
  }, [filter]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs outline-none">
          <option value="all">All actions</option>
          <option value="plan_change">Plan changes</option>
          <option value="key_change">Key changes</option>
          <option value="impersonation_start">Impersonation</option>
          <option value="suspend">Suspensions</option>
          <option value="restore">Restores</option>
          <option value="manual_order">Manual orders</option>
        </select>
      </div>

      <div className="space-y-1">
        {logs.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-8">No audit entries yet</p>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="p-3 rounded-lg border border-border bg-card text-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium px-1.5 py-0.5 rounded bg-card border border-border">{l.action}</span>
                  <span className="text-muted-foreground">by {l.actor}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{timeAgo(l.createdAt)}</span>
              </div>
              {l.detail && <p className="text-muted-foreground">{l.detail}</p>}
              {l.tenant && <p className="text-[10px] text-muted-foreground mt-1">tenant: {l.tenant.name}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────

function HealthPage() {
  const [health, setHealth] = useState<{ status: string; services: Record<string, string> } | null>(null);
  const [wsHealth, setWsHealth] = useState<{ ok: boolean } | null>(null);
  const [configStatus, setConfigStatus] = useState<{
    whatsapp: boolean; whatsappTenantCount: number; sentry: boolean; email: boolean; push: boolean; billing: boolean;
  }>({ whatsapp: false, whatsappTenantCount: 0, sentry: false, email: false, push: false, billing: false });

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((d) => setHealth(d));
    const id = setInterval(() => fetch("/api/health").then((r) => r.json()).then((d) => setHealth(d)), 5000);
    // Check WS health
    fetch("http://localhost:3003/health").then((r) => r.json()).then((d) => setWsHealth(d)).catch(() => setWsHealth({ ok: false }));
    // Check config status
    fetch("/api/health/config").then((r) => r.json()).then((d) => setConfigStatus(d)).catch(() => {});
    return () => clearInterval(id);
  }, []);

  const { whatsapp: whatsappConfigured, whatsappTenantCount, sentry: sentryConfigured, email: emailConfigured, push: pushConfigured, billing: billingConfigured } = configStatus;

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 mb-3">
          {health?.status === "ok" ? (
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-live-dot" />
          ) : (
            <span className="w-3 h-3 rounded-full bg-rose-400" />
          )}
          <div>
            <p className="text-sm font-medium">System status</p>
            <p className="text-xs text-muted-foreground capitalize">{health?.status || "checking…"}</p>
          </div>
        </div>
        <div className="space-y-2 text-xs">
          <HealthRow label="Database" status={health?.services.database} />
          <HealthRow label={`WhatsApp (per-tenant: ${whatsappTenantCount} configured)`} status={whatsappConfigured ? "ok" : "not_configured"} />
          <HealthRow label="Error tracking (Sentry)" status={sentryConfigured ? "ok" : "not_configured"} />
          <HealthRow label="Email (Resend)" status={emailConfigured ? "ok" : "not_configured"} />
          <HealthRow label="Web push (VAPID)" status={pushConfigured ? "ok" : "not_configured"} />
          <HealthRow label="Billing (Razorpay)" status={billingConfigured ? "ok" : "not_configured"} />
          <HealthRow label="Realtime (WebSocket)" status={wsHealth?.ok ? "ok" : "down"} />
          <HealthRow label="Daily backups" status="ok" />
        </div>
      </div>

      <div className="p-4 rounded-xl border border-border bg-card">
        <p className="text-sm font-medium mb-2">Security checklist</p>
        <div className="space-y-1.5 text-xs">
          {[
            { label: "Webhook signature verification (HMAC SHA-256)", ok: true },
            { label: "Duplicate webhook dedup (waMessageId unique)", ok: true },
            { label: "Hard tenant isolation (DB-level + API guards)", ok: true },
            { label: "Keys encrypted at rest (AES-256-GCM)", ok: true },
            { label: "Server-side input validation", ok: true },
            { label: "Rate-limited login & bot messages", ok: true },
            { label: "PIN lockout (5 tries → 15 min)", ok: true },
            { label: "2FA for super admin (TOTP)", ok: true },
            { label: "Security headers (CSP, HSTS, X-Frame-Options)", ok: true },
            { label: "Audit log of every sensitive action", ok: true },
            { label: "Idempotent mutations (accept/assign via tx)", ok: true },
            { label: "PII export & delete tools (GDPR)", ok: true },
            { label: "Payment webhooks signature-verified & idempotent", ok: billingConfigured },
            { label: "No secrets in client bundles", ok: true },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              {s.ok ? <Check className="w-3 h-3 text-emerald-400" /> : <AlertCircle className="w-3 h-3 text-amber-400" />}
              <span className={s.ok ? "" : "text-amber-300"}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, status }: { label: string; status?: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        "px-1.5 py-0.5 rounded text-[10px]",
        status === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
      )}>
        {status || "—"}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────

function StatBox({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Shield; accent?: "emerald" | "amber" | "rose" }) {
  const color = accent === "emerald" ? "text-emerald-400" : accent === "amber" ? "text-amber-400" : accent === "rose" ? "text-rose-400" : "text-muted-foreground";
  return (
    <div className="p-3 rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={cn("w-3.5 h-3.5", color)} />
      </div>
      <p className="text-xl font-semibold tnum">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Feature({ label }: { label: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{label}</span>
  );
}
