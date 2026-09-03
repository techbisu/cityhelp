"use client";

import { useEffect, useState, useCallback } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const applyTheme = useCallback((t: "dark" | "light") => {
    const html = document.documentElement;
    if (t === "light") {
      html.classList.remove("dark");
      html.classList.add("light");
    } else {
      html.classList.remove("light");
      html.classList.add("dark");
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("cityhelp-theme") as "dark" | "light" | null;
    if (saved) {
      applyTheme(saved);
    }
  }, [applyTheme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("cityhelp-theme", next);
      return next;
    });
  }, [applyTheme]);

  return (
    <button
      onClick={toggle}
      className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
      aria-label="Toggle theme"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  );
}
