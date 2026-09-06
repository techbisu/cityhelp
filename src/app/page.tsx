"use client";

import { useApp } from "@/stores/app";
import { useEffect } from "react";
import dynamic from "next/dynamic";

const HomeScreen = dynamic(() => import("@/components/shared/HomeScreen").then(m => ({ default: m.HomeScreen })), { ssr: false });
const BotApp = dynamic(() => import("@/components/bot/BotApp").then(m => ({ default: m.BotApp })), { ssr: false });
const ProviderApp = dynamic(() => import("@/components/provider/ProviderApp").then(m => ({ default: m.ProviderApp })), { ssr: false });
const AdminApp = dynamic(() => import("@/components/admin/AdminApp").then(m => ({ default: m.AdminApp })), { ssr: false });
const PlatformApp = dynamic(() => import("@/components/platform/PlatformApp").then(m => ({ default: m.PlatformApp })), { ssr: false });

export default function Home() {
  const view = useApp((s) => s.view);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <>
      {view === "home" && <HomeScreen />}
      {view === "bot" && <BotApp />}
      {view === "provider" && <ProviderApp />}
      {view === "admin" && <AdminApp />}
      {view === "platform" && <PlatformApp />}
    </>
  );
}
