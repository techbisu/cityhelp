"use client";

import { useApp } from "@/stores/app";
import { useEffect } from "react";
import { HomeScreen } from "@/components/shared/HomeScreen";
import { BotApp } from "@/components/bot/BotApp";
import { ProviderApp } from "@/components/provider/ProviderApp";
import { AdminApp } from "@/components/admin/AdminApp";
import { PlatformApp } from "@/components/platform/PlatformApp";

export default function Home() {
  const view = useApp((s) => s.view);

  // Set dark class on html persistently
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
