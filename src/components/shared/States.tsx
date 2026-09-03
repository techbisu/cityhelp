"use client";

import { cn } from "@/lib/utils";

/** Skeleton loader for cards */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("p-4 rounded-xl border border-border bg-card", className)}>
      <div className="h-3 w-20 shimmer rounded mb-3" />
      <div className="h-6 w-16 shimmer rounded mb-3" />
      <div className="h-2 w-full shimmer rounded" />
    </div>
  );
}

/** Skeleton loader for list rows */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn("p-3 rounded-lg border border-border bg-card flex items-center gap-3", className)}>
      <div className="w-2 h-2 rounded-full shimmer" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-32 shimmer rounded" />
        <div className="h-2 w-48 shimmer rounded" />
      </div>
      <div className="w-8 h-8 rounded-full shimmer" />
    </div>
  );
}

/** Skeleton loader for full page */
export function SkeletonPage({ count = 4 }: { count?: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/** Empty state with icon, title, description, and optional action */
export function EmptyState({
  icon: Icon,
  title,
  desc,
  actionLabel,
  onAction,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  actionLabel?: string;
  onAction?: () => void;
  accent?: "emerald";
}) {
  return (
    <div className={cn(
      "p-8 rounded-xl border border-dashed text-center",
      accent === "emerald" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"
    )}>
      <div className={cn(
        "w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center",
        accent === "emerald" ? "bg-emerald-500/15" : "bg-card border border-border"
      )}>
        <Icon className={cn("w-6 h-6", accent === "emerald" ? "text-emerald-400" : "text-muted-foreground")} />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 mb-3">{desc}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="text-xs bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** Error state */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="p-8 rounded-xl border border-rose-500/20 bg-rose-500/5 text-center">
      <div className="w-12 h-12 rounded-xl bg-rose-500/15 mx-auto mb-3 flex items-center justify-center">
        <svg className="w-6 h-6 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-rose-300">Something went wrong</p>
      <p className="text-xs text-rose-300/70 mt-1 mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/20 text-rose-300 font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
