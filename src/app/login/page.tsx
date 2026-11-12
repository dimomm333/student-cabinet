import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/access";
import { isRole, roleHomes } from "@/lib/roles";

export const metadata: Metadata = { title: "Вход в университетскую систему" };

async function LoginContent() {
  const user = await getCurrentUser();
  if (user && isRole(user.role)) redirect(roleHomes[user.role]);

  return <main className="login-page">
    <Brand />
    <section className="login-card panel">
      <span className="eyebrow">Единая учётная запись</span>
      <h1>Рады видеть тебя</h1>
      <p>Вход для студентов, преподавателей, технического персонала и администраторов.</p>
      <LoginForm />
      <p className="login-help">Учётную запись предоставляет университет. Если вы забыли пароль, обратитесь к администратору.</p>
    </section>
    <Link href="/" className="text-link">Вернуться на главную</Link>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="login-page" role="status">Открываем страницу входа…</main>}><LoginContent /></Suspense>;
}
