import Link from "next/link";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return <main className="not-found"><Brand /><span className="eyebrow">ОШИБКА 404</span><h1>Кажется, здесь пока пусто</h1><p>Такой страницы нет. Вернись в кабинет, чтобы продолжить.</p><Link href="/dashboard" className="button button-primary">В кабинет студента →</Link></main>;
}
