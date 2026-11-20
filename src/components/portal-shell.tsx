import Link from "next/link";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";

export function PortalHeader({ schedule = false }: { schedule?: boolean }) {
  return <header className="portal-header portal-width"><Brand /><nav aria-label="Публичная навигация"><Link href="/" aria-current={!schedule ? "page" : undefined}>Главная</Link><Link href="/schedule" aria-current={schedule ? "page" : undefined}>Расписание</Link></nav><ThemeToggle /></header>;
}

export function PortalFooter() {
  return <footer className="portal-footer portal-width"><Brand compact /><span>© 2026 · Северный университет</span></footer>;
}
