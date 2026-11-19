"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { Icon } from "./icon";

let manualChoice: Theme | null = null;
const systemQuery = "(prefers-color-scheme: dark)";
const validTheme = (value: string | null): Theme | null => value === "light" || value === "dark" ? value : null;
const apply = (theme: Theme) => { document.documentElement.dataset.theme = theme; };
const systemTheme = (): Theme => matchMedia(systemQuery).matches ? "dark" : "light";

export function ThemeController() {
  useLayoutEffect(() => {
    try { manualChoice = validTheme(localStorage.getItem(THEME_STORAGE_KEY)); } catch { /* In-memory choice still works. */ }
    const update = () => apply(manualChoice ?? systemTheme());
    update(); // Also restore the attribute after React's development remount.
    const media = matchMedia(systemQuery);
    const storage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      manualChoice = validTheme(event.newValue);
      update();
    };
    media.addEventListener("change", update);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return null;
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const snapshot = () => document.documentElement.dataset.theme === "dark";
const serverSnapshot = () => false;

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const label = dark ? "Светлая" : "Тёмная";
  const toggle = () => {
    manualChoice = snapshot() ? "light" : "dark";
    apply(manualChoice);
    try { localStorage.setItem(THEME_STORAGE_KEY, manualChoice); } catch { /* Usable without storage. */ }
  };
  return <button type="button" className="icon-button theme-toggle" onClick={toggle} aria-label={label} title={label}>
    <span className="theme-moon"><Icon name="moon" /></span>
    <span className="theme-sun"><Icon name="sun" /></span>
    <span className="theme-tooltip" aria-hidden="true">{label}</span>
  </button>;
}
