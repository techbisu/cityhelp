"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Building2, Globe, MessageSquare, Sparkles, Check, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface OnboardingWizardProps {
  slug: string;
  onComplete: () => void;
}

const STEPS = [
  { id: "business", icon: Building2, title: "Business details", desc: "Tell us about your business" },
  { id: "city", icon: Globe, title: "Add your first city", desc: "Where do you operate?" },
  { id: "whatsapp", icon: MessageSquare, title: "Connect WhatsApp", desc: "Your customers will message this number" },
  { id: "ai", icon: Sparkles, title: "Optional: AI keys", desc: "Bring your own OpenAI-compatible key" },
  { id: "done", icon: Check, title: "All set!", desc: "You're ready to receive orders" },
];

export function OnboardingWizard({ slug, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [cityName, setCityName] = useState("");
  const [cityState, setCityState] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [aiLabel, setAiLabel] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiKey, setAiKey] = useState("");
  const [loading, setLoading] = useState(false);

  const Step = STEPS[step];
  const Icon = Step.icon;

  async function next() {
    setLoading(true);
    try {
      if (step === 0 && businessName) {
        // Update tenant name
        await fetch(`/api/tenants`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, name: businessName, existingSlug: slug }),
        });
      }
      if (step === 1 && cityName) {
        const res = await fetch("/api/cities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantSlug: slug, name: cityName, state: cityState }),
        });
        if (!res.ok) {
          const d = await res.json();
          toast.error(d.message || "Failed to add city");
          setLoading(false);
          return;
        }
      }
      if (step === 2 && waNumber) {
        // Save WhatsApp number (would call WA Cloud API in production)
        toast.success("WhatsApp number saved (verification simulated)");
      }
      if (step === 3 && aiLabel && aiKey) {
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantSlug: slug, label: aiLabel, baseUrl: aiBaseUrl, apiKey: aiKey, modelName: "gpt-4o-mini" }),
        });
        if (res.ok) toast.success("AI provider added");
      }
      setStep(step + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center flex-1 last:flex-none">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border transition-colors",
                i < step ? "bg-emerald-500 border-emerald-500 text-zinc-950" :
                i === step ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" :
                "bg-card border-border text-muted-foreground"
              )}>
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("flex-1 h-0.5 mx-2", i < step ? "bg-emerald-500" : "bg-border")} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="p-6 rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
              <Icon className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{Step.title}</h2>
              <p className="text-xs text-muted-foreground">{Step.desc}</p>
            </div>
          </div>

          {step === 0 && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Business name</label>
                <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Shanti Express" className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/40" />
              </div>
              <p className="text-xs text-muted-foreground">This is what your customers will see on WhatsApp.</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">City name</label>
                <input value={cityName} onChange={(e) => setCityName(e.target.value)} placeholder="e.g. Delhi" className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/40" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">State (optional)</label>
                <input value={cityState} onChange={(e) => setCityState(e.target.value)} placeholder="e.g. Delhi" className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/40" />
              </div>
              <p className="text-xs text-muted-foreground">You can add more cities later (plan limits apply).</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">WhatsApp business number</label>
                <input value={waNumber} onChange={(e) => setWaNumber(e.target.value)} placeholder="+91 98XXX XXXXX" className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/40" />
              </div>
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                <p className="font-medium mb-1">📋 Next steps (in production):</p>
                <ol className="list-decimal list-inside space-y-0.5 text-emerald-300/80">
                  <li>Connect your WhatsApp Business number via Meta Business Suite</li>
                  <li>Add the webhook URL to your Meta app</li>
                  <li>Set the verify token</li>
                </ol>
              </div>
              <p className="text-xs text-muted-foreground">You can skip this and connect later.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Bring your own OpenAI-compatible API key. Works with OpenAI, Groq, DeepSeek, Mistral, OpenRouter, vLLM.</p>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Label</label>
                <input value={aiLabel} onChange={(e) => setAiLabel(e.target.value)} placeholder="e.g. OpenAI Main" className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/40" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Base URL</label>
                <input value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-emerald-500/40" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">API Key</label>
                <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="sk-..." className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-emerald-500/40" />
              </div>
              <p className="text-xs text-muted-foreground">Without AI, voice notes/photos will be saved as custom orders for human handling. The bot never fails.</p>
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold">You're all set!</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Your dashboard is ready. Add providers, edit your service menu, and start receiving orders on WhatsApp.
              </p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-2 mt-6">
            {step > 0 && step < 4 && (
              <button onClick={() => setStep(step - 1)} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4 inline" /> Back
              </button>
            )}
            {step < 4 ? (
              <button
                onClick={next}
                disabled={loading || (step === 0 && !businessName) || (step === 1 && !cityName)}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-medium py-2 rounded-lg text-sm flex items-center justify-center gap-1.5"
              >
                {step === 3 ? "Skip & finish" : "Continue"}
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={onComplete} className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-2 rounded-lg text-sm">
                Go to dashboard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
