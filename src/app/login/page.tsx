import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/access";
import { isRole, roleHomes } from "@/lib/roles";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Вход в университетскую систему" };

async function LoginContent() {
  const user = await getCurrentUser();
  if (user && isRole(user.role)) redirect(roleHomes[user.role]);

  return <main className="login-page">
    <div className="login-heading"><Brand /><ThemeToggle /></div>
    <section className="login-card panel">
      <h1>Вход в личный кабинет</h1>
      <LoginForm />
      <p className="login-help">Учётную запись предоставляет университет. Если вы забыли пароль, обратитесь к администратору.</p>
    </section>
    <Link href="/" className="text-link">Вернуться на главную</Link>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="login-page" role="status">Открываем страницу входа…</main>}><LoginContent /></Suspense>;
}
