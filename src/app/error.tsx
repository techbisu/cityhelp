/**
 * CityHelp — Root error boundary
 * Catches errors thrown during render in any route segment.
 * Logs to Sentry (if configured) and shows a friendly error UI.
 */
"use client";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console (Sentry would auto-capture via instrumentation)
    console.error("[CityHelp] Render error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full p-6 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-center">
        <div className="w-12 h-12 rounded-xl bg-rose-500/15 mx-auto mb-3 flex items-center justify-center">
          <svg className="w-6 h-6 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-rose-300">Something went wrong</h2>
        <p className="text-xs text-rose-300/70 mt-1 mb-4">
          An unexpected error occurred. Our team has been notified.
        </p>
        {error.digest && (
          <p className="text-[10px] text-rose-300/50 mb-4 font-mono">Error ID: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="bg-rose-500 hover:bg-rose-400 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
