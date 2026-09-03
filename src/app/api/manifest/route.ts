/**
 * GET /api/manifest?tenant=<slug>
 *
 * Returns a dynamic web app manifest for the tenant's PWA.
 * Uses the tenant's business name, logo, and accent color.
 *
 * This enables each business to have their own:
 *   - App name (e.g., "Shanti Express" instead of "CityHelp")
 *   - App icon (their logo)
 *   - Theme color (their brand color)
 *   - Short name (for the home screen icon label)
 *
 * The provider PWA links to this in the HTML:
 *   <link rel="manifest" href="/api/manifest?tenant=shanti" />
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantSlug = searchParams.get("tenant") || "shanti";

  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    select: {
      name: true,
      waBusinessName: true,
      accentColor: true,
      logoUrl: true,
    },
  });

  const appName = tenant?.waBusinessName || tenant?.name || "CityHelp";
  const shortName = appName.length > 12 ? appName.slice(0, 12) : appName;
  const themeColor = tenant?.accentColor || "#10b981";
  const logoUrl = tenant?.logoUrl || "/logo.svg";

  const manifest = {
    name: appName,
    short_name: shortName,
    description: `${appName} — order via WhatsApp`,
    start_url: `/?view=provider&tenant=${tenantSlug}`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0b",
    theme_color: themeColor,
    icons: [
      {
        src: logoUrl,
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: logoUrl,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    shortcuts: [
      {
        name: "Go Online",
        short_name: "Online",
        url: `/?view=provider&tenant=${tenantSlug}&action=online`,
      },
      {
        name: "Active Jobs",
        short_name: "Jobs",
        url: `/?view=provider&tenant=${tenantSlug}&action=jobs`,
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
