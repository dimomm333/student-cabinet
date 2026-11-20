"use client";

import { useState, type FormEvent } from "react";
import { isRole, roleHomes } from "@/lib/roles";
import { Icon } from "./icon";

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email") ?? "").trim().toLowerCase(),
          password: String(data.get("password") ?? ""),
          rememberMe: false,
        }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? "Слишком много попыток входа. Подождите минуту и попробуйте снова."
          : "Не удалось войти. Проверьте email и пароль.");
        setPending(false);
        return;
      }
      const result = await response.json();
      const role: unknown = result.user?.role;
      window.location.assign(isRole(role) ? roleHomes[role] : "/login");
    } catch {
      setError("Сервер недоступен. Попробуйте ещё раз.");
      setPending(false);
    }
  }

  return <form onSubmit={login} className="login-form" aria-busy={pending}>
    <label htmlFor="email">Университетская почта</label>
    <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} autoCapitalize="none" spellCheck={false} />
    <label htmlFor="password">Пароль</label>
    <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} aria-describedby={error ? "login-error" : undefined} />
    {error && <p id="login-error" className="auth-error" role="alert">{error}</p>}
    <button type="submit" className="button button-primary" disabled={pending}>{pending ? "Входим…" : "Войти в кабинет"}<Icon name="arrow" /></button>
  </form>;
}
