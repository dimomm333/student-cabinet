import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className={`brand ${compact ? "brand-compact" : ""}`} aria-label="Северный университет — главная"><span className="brand-mark" aria-hidden="true"><svg width="30" height="32" viewBox="0 0 30 32" fill="none"><path d="M4 25V12l11-7 11 7v13M4 18l11-7 11 7M10 28V17m10 11V17M15 23v7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" /></svg></span><span>СЕВЕРНЫЙ<span className="brand-subtitle">УНИВЕРСИТЕТ</span></span></Link>;
}
