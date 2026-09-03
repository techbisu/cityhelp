/**
 * CityHelp — Custom domain resolver
 *
 * Resolves which tenant a request belongs to based on the hostname.
 *
 * Priority:
 *   1. Custom domain (e.g., "orders.shantiexpress.in" → Shanti Express)
 *   2. Subdomain (e.g., "shanti.cityhelp.app" → Shanti Express)
 *   3. Query param (e.g., "?tenant=shanti" → Shanti Express)
 *   4. Default (no tenant — show landing page)
 *
 * Usage in any route:
 *   const tenantSlug = await resolveTenantSlug(req);
 *   if (tenantSlug) { // use this tenant }
 */
import { db } from "./db";

// Cache: hostname → tenantSlug (5 minute TTL in-memory)
const domainCache = new Map<string, { slug: string; expires: number }>();

/**
 * Resolve tenant slug from the request's hostname.
 * Checks custom domains first, then subdomains.
 */
export async function resolveTenantFromHost(hostname: string): Promise<string | null> {
  // Check cache first
  const cached = domainCache.get(hostname);
  if (cached && cached.expires > Date.now()) {
    return cached.slug;
  }

  // Skip localhost and IP addresses
  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return null;
  }

  // Skip the main platform domain
  const platformDomain = process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "").split("/")[0];
  if (hostname === platformDomain) {
    return null;
  }

  // 1. Check custom domains (exact match)
  const customDomainTenant = await db.tenant.findFirst({
    where: {
      customDomain: hostname,
      customDomainVerified: true,
    },
    select: { slug: true },
  });

  if (customDomainTenant) {
    domainCache.set(hostname, { slug: customDomainTenant.slug, expires: Date.now() + 300000 });
    return customDomainTenant.slug;
  }

  // 2. Check subdomain (e.g., "shanti.cityhelp.app" → "shanti")
  if (platformDomain && hostname.endsWith(`.${platformDomain}`)) {
    const subdomain = hostname.slice(0, hostname.length - platformDomain.length - 1);
    if (subdomain && !subdomain.includes(".")) {
      // Verify this subdomain matches a real tenant
      const subdomainTenant = await db.tenant.findUnique({
        where: { slug: subdomain },
        select: { slug: true },
      });
      if (subdomainTenant) {
        domainCache.set(hostname, { slug: subdomainTenant.slug, expires: Date.now() + 300000 });
        return subdomainTenant.slug;
      }
    }
  }

  return null;
}

/**
 * Get the full branded URL for a tenant.
 * Uses custom domain if configured, otherwise subdomain.
 */
export function getTenantUrl(tenantSlug: string, customDomain?: string | null): string {
  if (customDomain) {
    return `https://${customDomain}`;
  }
  const platformDomain = process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "").split("/")[0] || "cityhelp.app";
  return `https://${tenantSlug}.${platformDomain}`;
}

/**
 * Invalidate the domain cache (call when custom domain changes).
 */
export function invalidateDomainCache(): void {
  domainCache.clear();
}
