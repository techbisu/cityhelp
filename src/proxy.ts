/**
 * CityHelp — security headers proxy (formerly middleware)
 * Adds CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
 * on every response.
 */
import { NextResponse, type NextRequest } from "next/server";

export function proxy(_req: NextRequest) {
  const res = NextResponse.next();

  // Content Security Policy — allow inline (React), allow data: images,
  // disallow external scripts except trusted CDN.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://z-cdn.chatglm.cn",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  // HSTS — only meaningful over HTTPS, harmless on dev
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-DNS-Prefetch-Control", "off");

  return res;
}

export const config = {
  matcher: [
    // Run on all routes except static assets and Next internals
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|logo.svg|sw.js).*)",
  ],
};
