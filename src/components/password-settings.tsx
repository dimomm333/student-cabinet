"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLengthError, passwordPolicyMessages } from "@/lib/password-policy";

type PasswordField = "currentPassword" | "newPassword" | "confirmation";
type FieldErrors = Partial<Record<PasswordField, string>>;
const fields: [PasswordField, string, string][] = [
  ["currentPassword", "Текущий пароль", "current-password"],
  ["newPassword", "Новый пароль", "new-password"],
  ["confirmation", "Повтор нового пароля", "new-password"],
];

export function PasswordSettings({ hasLocalPassword }: { hasLocalPassword: boolean }) {
  const id = useId();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [visible, setVisible] = useState<Partial<Record<PasswordField, boolean>>>({});
  if (!hasLocalPassword) return <p>Для этой учётной записи локальный пароль не задан. Управляйте способом входа через университет или своего провайдера авторизации.</p>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget, data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? ""), newPassword = String(data.get("newPassword") ?? "");
    setError(""); setMessage(""); setErrors({});
    const validation: FieldErrors = {};
    if (!currentPassword) validation.currentPassword = "Введите текущий пароль";
    else if (currentPassword.length > PASSWORD_MAX_LENGTH) validation.currentPassword = passwordPolicyMessages.PASSWORD_TOO_LONG;
    const lengthError = passwordLengthError(newPassword);
    if (lengthError) validation.newPassword = passwordPolicyMessages[lengthError];
    else if (newPassword === currentPassword) validation.newPassword = passwordPolicyMessages.PASSWORD_UNCHANGED;
    if (newPassword !== data.get("confirmation")) validation.confirmation = "Пароли не совпадают";
    if (Object.keys(validation).length) { setErrors(validation); return; }
    pending.current = true; setBusy(true);
    try {
      // Load the local dictionaries only when this form is used.
      const { newPasswordError } = await import("@/lib/password-strength");
      const code = newPasswordError(newPassword);
      if (code) { setErrors({ newPassword: passwordPolicyMessages[code] }); return; }
      const response = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (result.code === "INVALID_PASSWORD") setErrors({ currentPassword: "Неверный текущий пароль" });
        else if (typeof result.code === "string" && Object.hasOwn(passwordPolicyMessages, result.code)) {
          setErrors({ newPassword: passwordPolicyMessages[result.code as keyof typeof passwordPolicyMessages] });
        } else setError(response.status === 429 ? "Слишком много попыток. Подождите минуту и повторите попытку" : "Не удалось изменить пароль. Повторите попытку");
        return;
      }
      form.reset(); setVisible({}); setMessage("Пароль успешно изменён");
    } catch { setError("Не удалось изменить пароль. Повторите попытку"); }
    finally { pending.current = false; setBusy(false); }
  }

  return <form className="password-settings" method="post" onSubmit={submit} noValidate aria-busy={busy} aria-describedby={`${id}-requirements`}>
    <p id={`${id}-requirements`}>От {PASSWORD_MIN_LENGTH} до {PASSWORD_MAX_LENGTH} символов. Используйте непредсказуемый пароль или длинную парольную фразу.</p>
    {fields.map(([name, label, autoComplete]) =>
      <div className="password-settings-field" key={name}>
        <label htmlFor={`${id}-${name}`}>{label}</label>
        <div className="password-settings-input"><input id={`${id}-${name}`} name={name} type={visible[name] ? "text" : "password"} autoComplete={autoComplete} required disabled={busy} aria-invalid={!!errors[name]} aria-describedby={[name === "newPassword" ? `${id}-requirements` : "", errors[name] ? `${id}-${name}-error` : ""].filter(Boolean).join(" ") || undefined} />
          <button type="button" aria-label={`${visible[name] ? "Скрыть" : "Показать"} ${label.toLowerCase()}`} aria-pressed={!!visible[name]} onClick={() => setVisible(v => ({ ...v, [name]: !v[name] }))}>{visible[name] ? "Скрыть" : "Показать"}</button>
        </div>
        {errors[name] && <p id={`${id}-${name}-error`} className="services-error" role="alert">{errors[name]}</p>}
      </div>)}
    {error && <p className="services-error" role="alert">{error}</p>}
    {message && <p className="services-success" role="status">{message}</p>}
    <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Изменяем пароль…" : "Изменить пароль"}</button>
  </form>;
}
