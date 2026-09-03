/**
 * CityHelp — shared helpers
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format paise → ₹ string. 44000 → "₹440" */
export function formatINR(paise: number): string {
  if (!paise && paise !== 0) return "—";
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** Format paise → ₹ with decimals. 44000 → "₹440.00" */
export function formatINRprecise(paise: number): string {
  if (!paise && paise !== 0) return "—";
  return "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Relative time: 2m ago, 1h ago, 3d ago */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Format seconds → "18s" or "2m 3s" */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

/** Generate next human-friendly order code: 1024, 1025, ... */
export function nextOrderCode(currentMax: number): string {
  return String(currentMax + 1);
}

/** Safe JSON parse */
export function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Pluralize */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** WhatsApp-style message truncation: max 3 lines */
export function waTruncate(text: string, maxLines = 3): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + "…";
}

/** Reverse-geocode stub: lat,lng → area name (real impl would call Maps API) */
export function reverseGeocodeStub(lat: number, lng: number): string {
  // Delhi areas
  const areas: Array<{ name: string; lat: number; lng: number; r: number }> = [
    { name: "Jawahar Nagar", lat: 28.6862, lng: 77.2072, r: 0.02 },
    { name: "Lajpat Nagar", lat: 28.571, lng: 77.243, r: 0.02 },
    { name: "Connaught Place", lat: 28.6315, lng: 77.2167, r: 0.02 },
    { name: "Andheri West", lat: 19.1197, lng: 72.8468, r: 0.03 },
    { name: "Bandra", lat: 19.0596, lng: 72.8295, r: 0.03 },
  ];
  for (const a of areas) {
    const d = Math.sqrt((a.lat - lat) ** 2 + (a.lng - lng) ** 2);
    if (d < a.r) return a.name;
  }
  return "Unknown area";
}

/** Build a Google Maps link from lat/lng or text */
export function mapsLink(lat?: number | null, lng?: number | null, text?: string | null): string {
  if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`;
  if (text) return `https://www.google.com/maps/search/${encodeURIComponent(text)}`;
  return "#";
}

/** Order status → display label + color token */
export const ORDER_STATUS = {
  new: { label: "New", color: "text-zinc-300", bg: "bg-zinc-500/10", dot: "bg-zinc-400" },
  broadcast: { label: "Broadcast", color: "text-amber-300", bg: "bg-amber-500/10", dot: "bg-amber-400" },
  quoted: { label: "Quoted", color: "text-sky-300", bg: "bg-sky-500/10", dot: "bg-sky-400" },
  accepted: { label: "Accepted", color: "text-emerald-300", bg: "bg-emerald-500/10", dot: "bg-emerald-400" },
  picked: { label: "Picked up", color: "text-emerald-300", bg: "bg-emerald-500/15", dot: "bg-emerald-500" },
  delivered: { label: "Delivered", color: "text-zinc-400", bg: "bg-zinc-500/10", dot: "bg-zinc-500" },
  escalated: { label: "Escalated", color: "text-rose-300", bg: "bg-rose-500/10", dot: "bg-rose-500 animate-live-dot" },
  cancelled: { label: "Cancelled", color: "text-zinc-500", bg: "bg-zinc-500/5", dot: "bg-zinc-600" },
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS;
