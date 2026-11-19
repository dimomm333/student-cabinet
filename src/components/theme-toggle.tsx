"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import { Icon, SystemThemeIcon } from "./icon";

let preference: ThemePreference = "system";
const systemQuery = "(prefers-color-scheme: dark)";
const validPreference = (value: string | null): ThemePreference => value === "light" || value === "dark" ? value : "system";
function apply() {
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = preference === "system"
    ? matchMedia(systemQuery).matches ? "dark" : "light" : preference;
}

function choosePreference(value: ThemePreference) {
  preference = value;
  apply();
  // Absence means system mode: remove the old manual override for every tab.
  try {
    if (value === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch { /* Usable without storage. */ }
}

export function ThemeController() {
  useLayoutEffect(() => {
    try { preference = validPreference(localStorage.getItem(THEME_STORAGE_KEY)); } catch { /* Keep the in-memory preference. */ }
    apply(); // Restore attributes after React's development remount, too.
    const media = matchMedia(systemQuery);
    const storage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      preference = validPreference(event.newValue);
      apply();
    };
    media.addEventListener("change", apply);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return null;
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-preference"] });
  return () => observer.disconnect();
}
const snapshot = () => validPreference(document.documentElement.dataset.themePreference ?? null);
const serverSnapshot = (): ThemePreference => "system";
const options = [
  { value: "system", label: "Как в системе", icon: "monitor" },
  { value: "light", label: "Светлая", icon: "sun" },
  { value: "dark", label: "Тёмная", icon: "moon" },
] as const;

export function ThemeToggle() {
  const selected = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const label = options.find(option => option.value === selected)!.label;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const buttons = container.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    buttons[options.findIndex(option => option.value === selected)].focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, selected]);
  const choose = (value: ThemePreference) => {
    choosePreference(value);
    close();
  };
  return <div className="theme-picker" ref={container} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); close(); }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const buttons = Array.from(container.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }}>
    <button ref={trigger} type="button" className="icon-button theme-toggle" onClick={() => setOpen(!open)} aria-label={`Оформление: ${label}`} title={`Оформление: ${label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}>
      <span className="theme-system"><SystemThemeIcon /></span>
      <span className="theme-moon"><Icon name="moon" /></span>
      <span className="theme-sun"><Icon name="sun" /></span>
    </button>
    {open && <div id={id} className="theme-menu" role="menu" aria-label="Оформление">
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={selected === option.value} tabIndex={-1} onClick={() => choose(option.value)}>
        {option.value === "system" ? <SystemThemeIcon size={18} /> : <Icon name={option.icon} size={18} />}<span>{option.label}</span>{selected === option.value && <Icon name="check" size={16} />}
      </button>)}
    </div>}
  </div>;
}
