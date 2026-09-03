/**
 * CityHelp — global app shell state
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppView = "home" | "bot" | "provider" | "admin" | "platform";

interface AppState {
  view: AppView;
  adminTenantSlug: string | null;
  adminCityId: string | null;
  adminStaffEmail: string | null;
  providerId: string | null;
  providerTenantSlug: string | null;
  botTenantSlug: string;
  botPhone: string;
  isImpersonating: boolean;
  impersonatedTenantSlug: string | null;

  setView: (v: AppView) => void;
  setAdminTenant: (slug: string, staffEmail: string) => void;
  setAdminCity: (cityId: string | null) => void;
  setProvider: (id: string, tenantSlug: string) => void;
  clearProvider: () => void;
  clearAdmin: () => void;
  setBot: (slug: string, phone: string) => void;
  setImpersonation: (slug: string | null) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      view: "home",
      adminTenantSlug: null,
      adminCityId: null,
      adminStaffEmail: null,
      providerId: null,
      providerTenantSlug: null,
      botTenantSlug: "shanti",
      botPhone: "+919833300001",
      isImpersonating: false,
      impersonatedTenantSlug: null,

      setView: (v) => set({ view: v }),
      setAdminTenant: (slug, staffEmail) =>
        set({ adminTenantSlug: slug, adminStaffEmail: staffEmail, adminCityId: null }),
      setAdminCity: (cityId) => set({ adminCityId: cityId }),
      setProvider: (id, tenantSlug) =>
        set({ providerId: id, providerTenantSlug: tenantSlug }),
      clearProvider: () => set({ providerId: null, providerTenantSlug: null }),
      clearAdmin: () =>
        set({ adminTenantSlug: null, adminStaffEmail: null, adminCityId: null }),
      setBot: (slug, phone) => set({ botTenantSlug: slug, botPhone: phone }),
      setImpersonation: (slug) =>
        set({
          isImpersonating: !!slug,
          impersonatedTenantSlug: slug,
        }),
    }),
    {
      name: "cityhelp-shell",
      partialize: (s) => ({
        view: s.view,
        adminTenantSlug: s.adminTenantSlug,
        adminStaffEmail: s.adminStaffEmail,
        providerId: s.providerId,
        providerTenantSlug: s.providerTenantSlug,
        botTenantSlug: s.botTenantSlug,
        botPhone: s.botPhone,
      }),
    }
  )
);
