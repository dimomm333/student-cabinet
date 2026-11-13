import Link from "next/link";
import { Brand } from "./brand";

export function PortalHeader({ schedule = false }: { schedule?: boolean }) {
  return <header className="portal-header portal-width"><Brand /><nav aria-label="Публичная навигация"><Link href="/" aria-current={!schedule ? "page" : undefined}>Главная</Link><Link href="/schedule" aria-current={schedule ? "page" : undefined}>Расписание</Link></nav><span className="portal-prototype">Учебный прототип</span></header>;
}

export function PortalFooter() {
  return <footer className="portal-footer portal-width"><Brand compact /><p>Вымышленный Северный университет.<br />Материалы не являются официальными объявлениями или расписанием реального вуза.</p><span>© 2026 · Учебный проект</span></footer>;
}
