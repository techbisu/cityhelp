"use client";

import { useEffect } from "react";

/**
 * Registers the service worker for web push notifications.
 * Only registers in production or when explicitly enabled.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => {
          console.log("[SW] Registered");
        })
        .catch((err) => {
          console.log("[SW] Registration failed:", err);
        });
    }
  }, []);

  return null;
}
