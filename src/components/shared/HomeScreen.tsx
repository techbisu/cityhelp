"use client";

import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import { MessageSquare, Smartphone, LayoutDashboard, Shield, ArrowRight, Sparkles } from "lucide-react";

const APPS = [
  {
    view: "bot" as const,
    title: "Customer WhatsApp Bot",
    desc: "Simulate the customer experience — language pick, menu, order & book flows, address, confirm.",
    icon: MessageSquare,
    accent: "from-emerald-500/20 to-emerald-500/5",
    border: "border-emerald-500/20",
    iconBg: "bg-emerald-500/10 text-emerald-300",
    tag: "WhatsApp",
  },
  {
    view: "provider" as const,
    title: "Provider App (PWA)",
    desc: "Login with PIN, accept incoming jobs via call-like ring screen, manage active jobs, send quotes.",
    icon: Smartphone,
    accent: "from-amber-500/20 to-amber-500/5",
    border: "border-amber-500/20",
    iconBg: "bg-amber-500/10 text-amber-300",
    tag: "PWA · Mobile",
  },
  {
    view: "admin" as const,
    title: "Tenant Admin Dashboard",
    desc: "Premium ops dashboard — kanban, escalation center, providers, customers, services, ⌘K palette.",
    icon: LayoutDashboard,
    accent: "from-emerald-500/20 to-emerald-500/5",
    border: "border-emerald-500/20",
    iconBg: "bg-emerald-500/10 text-emerald-300",
    tag: "Premium UI",
  },
  {
    view: "platform" as const,
    title: "Super Admin Console",
    desc: "Platform-wide view — tenants, plans, usage & revenue, audit log, impersonation, health.",
    icon: Shield,
    accent: "from-indigo-500/20 to-indigo-500/5",
    border: "border-indigo-500/20",
    iconBg: "bg-indigo-500/10 text-indigo-300",
    tag: "Platform",
  },
];

export function HomeScreen() {
  const setView = useApp((s) => s.setView);
  const botTenantSlug = useApp((s) => s.botTenantSlug);
  const botPhone = useApp((s) => s.botPhone);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">CityHelp</h1>
              <p className="text-[11px] text-muted-foreground leading-none mt-0.5">Multi-tenant WhatsApp ordering SaaS</p>
            </div>
          </div>
          <a
            href="/api/health"
            target="_blank"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-dot" />
            System operational
          </a>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 mb-4">
            <span className="w-1 h-1 rounded-full bg-emerald-400" />
            Production-ready · 10-phase build
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3">
            Pick an app to enter
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm leading-relaxed">
            Four roles share one platform. Customers order on WhatsApp, providers accept jobs on a mobile PWA,
            tenant admins run operations, and the platform owner watches everything.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {APPS.map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.view}
                onClick={() => setView(app.view)}
                className={cn(
                  "group relative text-left p-6 rounded-2xl border bg-card hover:bg-card/80 transition-all duration-200",
                  "hover:-translate-y-0.5 hover:shadow-elevated",
                  app.border
                )}
              >
                <div className={cn("absolute inset-0 rounded-2xl bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300", app.accent)} />
                <div className="relative flex items-start gap-4">
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", app.iconBg)}>
                    <Icon className="w-6 h-6" />
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

        {/* Quick info */}
        <div className="mt-12 grid md:grid-cols-3 gap-4 text-sm">
          <div className="p-4 rounded-xl border border-border/60 bg-card/40">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Demo tenants</p>
            <p className="font-medium">Shanti Express</p>
            <p className="text-xs text-muted-foreground">Delhi + Jaipur · Grocery, Cake, Parcel</p>
            <p className="font-medium mt-2">QuickFix Services</p>
            <p className="text-xs text-muted-foreground">Mumbai + Pune · Ride, Repair</p>
          </div>
          <div className="p-4 rounded-xl border border-border/60 bg-card/40">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Provider login</p>
            <p className="text-xs text-muted-foreground">Any provider phone · PIN</p>
            <p className="font-mono text-sm mt-1">PIN: 1234</p>
            <p className="text-xs text-muted-foreground mt-2">e.g. +919811100001</p>
          </div>
          <div className="p-4 rounded-xl border border-border/60 bg-card/40">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Admin & Super logins</p>
            <p className="text-xs">owner@shanti.express / demo1234</p>
            <p className="text-xs">super@cityhelp.app / super1234</p>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-12">
          Bot session: tenant <span className="font-mono text-foreground/80">{botTenantSlug}</span> · phone{" "}
          <span className="font-mono text-foreground/80">{botPhone}</span>
        </p>
      </main>

      <footer className="border-t border-border/60 py-4 text-center text-[11px] text-muted-foreground">
        Built with Next.js · Prisma · Tailwind · shadcn/ui · Dark-first ops aesthetic
      </footer>
    </div>
  );
}
