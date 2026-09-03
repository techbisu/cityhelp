"use client";

import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import { MessageSquare, Smartphone, LayoutDashboard, Shield, ArrowRight, Sparkles, Zap, Globe, ShieldCheck, Clock } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

const APPS = [
  {
    view: "bot" as const,
    title: "Customer WhatsApp Bot",
    desc: "Interactive simulator of the full customer experience — language pick, menu list, order & book flows, grocery accumulation via voice/photo, address pin, confirm.",
    icon: MessageSquare,
    accent: "from-emerald-500/20 to-emerald-500/5",
    border: "border-emerald-500/20",
    iconBg: "bg-emerald-500/10 text-emerald-400",
    tag: "WhatsApp",
  },
  {
    view: "provider" as const,
    title: "Provider App (PWA)",
    desc: "Mobile-first provider experience — PIN login, full-screen incoming call with pulsing rings, race-safe accept, charges, UPI payment, job lifecycle.",
    icon: Smartphone,
    accent: "from-amber-500/20 to-amber-500/5",
    border: "border-amber-500/20",
    iconBg: "bg-amber-500/10 text-amber-400",
    tag: "PWA · Mobile",
  },
  {
    view: "admin" as const,
    title: "Tenant Admin Dashboard",
    desc: "Premium ops dashboard — kanban with drag-and-drop, escalation center, providers, customers, services editor, AI BYOK, billing, payments, ⌘K palette.",
    icon: LayoutDashboard,
    accent: "from-emerald-500/20 to-emerald-500/5",
    border: "border-emerald-500/20",
    iconBg: "bg-emerald-500/10 text-emerald-400",
    tag: "Premium UI",
  },
  {
    view: "platform" as const,
    title: "Super Admin Console",
    desc: "Platform-wide view — tenants, plans CRUD, usage & revenue, audit log, impersonation, platform health with real config status.",
    icon: Shield,
    accent: "from-indigo-500/20 to-indigo-500/5",
    border: "border-indigo-500/20",
    iconBg: "bg-indigo-500/10 text-indigo-400",
    tag: "Platform",
  },
];

const FEATURES = [
  { icon: ShieldCheck, label: "End-to-end auth", desc: "Signed httpOnly cookies on all routes" },
  { icon: Globe, label: "Multi-tenant", desc: "Hard isolation at DB + API level" },
  { icon: Zap, label: "Race-safe", desc: "Prisma transactions on accept/payment" },
  { icon: Clock, label: "Real-time", desc: "WebSocket service + web push" },
];

export function HomeScreen() {
  const setView = useApp((s) => s.setView);
  const botTenantSlug = useApp((s) => s.botTenantSlug);
  const botPhone = useApp((s) => s.botPhone);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="glass border-b border-border/40 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shadow-glow">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">CityHelp</h1>
              <p className="text-[11px] text-muted-foreground leading-none mt-0.5">Multi-tenant WhatsApp ordering SaaS</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/api/health"
              target="_blank"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
              System operational
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400 mb-5 animate-fade-in">
            <span className="w-1 h-1 rounded-full bg-emerald-400" />
            Production-ready · 3-phase security audit complete
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3">
            Pick an app to enter
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm leading-relaxed">
            Four roles share one platform. Customers order on WhatsApp, providers accept jobs on a mobile PWA,
            tenant admins run operations, and the platform owner watches everything.
          </p>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border text-xs"
            >
              <f.icon className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium">{f.label}</span>
              <span className="text-muted-foreground hidden sm:inline">· {f.desc}</span>
            </div>
          ))}
        </div>

        {/* App cards */}
        <div className="grid md:grid-cols-2 gap-4 mb-12">
          {APPS.map((app, i) => {
            const Icon = app.icon;
            return (
              <button
                key={app.view}
                onClick={() => setView(app.view)}
                className={cn(
                  "group relative text-left p-5 rounded-2xl border bg-card transition-all duration-200",
                  "hover:-translate-y-0.5 hover:shadow-lg",
                  "animate-fade-in",
                  app.border
                )}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className={cn("absolute inset-0 rounded-2xl bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300", app.accent)} />
                <div className="relative flex items-start gap-4">
                  <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0", app.iconBg)}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-[15px]">{app.title}</h3>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border", app.border, app.iconBg)}>
                        {app.tag}
                      </span>
                    </div>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{app.desc}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
                </div>
              </button>
            );
          })}
        </div>

        {/* Demo credentials */}
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <div className="p-4 rounded-xl border border-border bg-card/50">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Demo tenants</p>
            <p className="font-medium">Shanti Express</p>
            <p className="text-xs text-muted-foreground">Delhi + Jaipur · Grocery, Cake, Parcel</p>
            <p className="font-medium mt-2">QuickFix Services</p>
            <p className="text-xs text-muted-foreground">Mumbai + Pune · Ride, Repair</p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card/50">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Provider login</p>
            <p className="text-xs text-muted-foreground">Any provider phone · PIN</p>
            <p className="font-mono text-sm mt-1">PIN: 1234</p>
            <p className="text-xs text-muted-foreground mt-2">e.g. +919811100001</p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card/50">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Admin & Super logins</p>
            <p className="text-xs">owner@shanti.express / demo1234</p>
            <p className="text-xs">super@cityhelp.app / super1234</p>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          Bot session: tenant <span className="font-mono text-foreground/80">{botTenantSlug}</span> · phone{" "}
          <span className="font-mono text-foreground/80">{botPhone}</span>
        </p>
      </main>

      <footer className="border-t border-border/40 py-4 text-center text-[11px] text-muted-foreground">
        Built with Next.js 16 · Prisma · Tailwind CSS 4 · shadcn/ui · Dark-first ops aesthetic
      </footer>
    </div>
  );
}
