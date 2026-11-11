import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Северный университет — Кабинет студента", template: "%s · Северный университет" },
  description: "Демонстрационный кабинет студента: расписание, уведомления и жизнь университета. Все данные вымышлены.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru" data-scroll-behavior="smooth"><body>{children}</body></html>;
}
