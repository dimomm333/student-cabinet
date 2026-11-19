export const THEME_STORAGE_KEY = "lks-theme";
export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

// Static, trusted code: runs in <head> while HTML is parsed, before first paint.
// Keep storage failure separate from the system fallback (e.g. private mode).
export const themeInitScript = `(()=>{let t;try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch{}const p=t==="light"||t==="dark"?t:"system";document.documentElement.dataset.themePreference=p;document.documentElement.dataset.theme=p==="system"?matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light":p})()`;
