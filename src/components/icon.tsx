import type { CSSProperties } from "react";

const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7",
  user: "M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  calendar: "M4 5h16v16H4zM8 3v4m8-4v4M4 11h16M8 15h2m4 0h2m-8 3h2",
  book: "M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v15h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v15",
  chart: "M4 3v18h17M8 16v-4m5 4V8m5 8V5",
  folder: "M3 7V4h6l2 3h10v13H3z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4",
  news: "M4 3h16v18H4zM8 7h8m-8 4h8m-8 4h3m-3 3h8m-2-3h2",
  clipboard: "M9 4H5v17h14V4h-4M9 2h6v5H9zM8 12l2 2 5-4m-7 8h8",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  sport: "m5 16 3-5 5 1 2 6h5M8 11l4-5 4 3h4M4 21l5-4m7-15a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  briefcase: "M3 7h18v14H3zM8 7V3h8v4M3 12a24 24 0 0 0 18 0m-9 0v3",
  mail: "M3 5h18v14H3zM3 5l9 8 9-8",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6",
  check: "m5 12 4 4L19 6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  pin: "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  chevron: "m9 5 7 7-7 7",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  logout: "M10 4H4v16h6m5-13 5 5-5 5M9 12h11",
  help: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01",
  cap: "m2 9 10-6 10 6-10 6zM6 12v6c4 3 8 3 12 0v-6m4-3v9",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0" style={style}><path d={paths[name]} /></svg>;
}
