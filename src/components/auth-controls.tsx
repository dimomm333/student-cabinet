"use client";

import { useState } from "react";
import { Icon } from "./icon";

export function LogoutButton({ className = "button button-outline", compact = false }: {
  className?: string;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function logout() {
    setPending(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("logout failed");
      // A full navigation also discards Next.js' in-memory authenticated router cache.
      window.location.replace("/login");
    } catch {
      setPending(false);
      setError(true);
    }
  }

  return <>
    <button type="button" className={className} disabled={pending} onClick={logout} aria-label="Выйти из аккаунта">
      <Icon name="logout" />{!compact && (pending ? "Выходим…" : "Выйти")}
    </button>
    {error && <span role="alert" className="auth-error">Не удалось выйти. Повторите попытку.</span>}
  </>;
}
