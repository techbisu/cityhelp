/**
 * CityHelp — Global error boundary (catches errors in root layout itself)
 */
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body style={{ margin: 0, padding: 0, background: "#0a0a0b", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 400, padding: 24, borderRadius: 16, border: "1px solid rgba(244,63,94,0.2)", background: "rgba(244,63,94,0.05)", textAlign: "center" }}>
            <h2 style={{ color: "#fda4af", fontSize: 14, fontWeight: 600, margin: 0 }}>
              Application error
            </h2>
            <p style={{ color: "rgba(253,164,175,0.7)", fontSize: 12, marginTop: 4, marginBottom: 16 }}>
              A critical error occurred. Please refresh the page.
            </p>
            {error.digest && (
              <p style={{ color: "rgba(253,164,175,0.5)", fontSize: 10, fontFamily: "monospace", marginBottom: 16 }}>
                {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{ background: "#f43f5e", color: "white", border: "none", padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
