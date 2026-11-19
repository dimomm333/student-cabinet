import type { Metadata } from "next";
import "./globals.css";
import { ThemeController } from "@/components/theme-toggle";
import { themeInitScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "Северный университет — Кабинет студента", template: "%s · Северный университет" },
  description: "Демонстрационный кабинет студента: расписание, уведомления и жизнь университета. Все данные вымышлены.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru" data-scroll-behavior="smooth" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head><body><ThemeController />{children}</body></html>;
}
