"use client";
import { useEffect, useState } from "react";
import { allNotificationCategories, notificationCategories, type NotificationCategory, type NotificationPreferences } from "@/lib/notifications-shared";
import { notificationFetch } from "./notifications-provider";

export function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationPreferences | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; notificationFetch<NotificationPreferences>("/api/notifications?view=settings").then(s => { if (active) setSettings(s); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  function toggle(key: "optionalCategories" | "emailCategories", category: NotificationCategory, checked: boolean) {
    setSettings(s => s && ({ ...s, [key]: checked ? [...s[key], category] : s[key].filter(c => c !== category) })); setMessage("");
  }
  async function save() {
    if (!settings) return; setBusy(true); setError(""); setMessage("");
    try {
      await notificationFetch("/api/notifications", { operation: "SETTINGS", optionalCategories: settings.optionalCategories, emailCategories: settings.emailCategories, personalEmail: settings.personalEmail });
      setMessage("Настройки сохранены."); window.dispatchEvent(new Event("notifications-updated"));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="notification-settings"><p>Важные уведомления об учёбе и работе системы отключить нельзя. Выбор ниже применяется к новым необязательным уведомлениям.</p>
    {error && <p className="services-error" role="alert">{error}</p>}{message && <p className="services-success" role="status">{message}</p>}
    {!settings ? <p role="status">Загружаем настройки…</p> : <>
      <fieldset><legend>Необязательные уведомления в ЛКС</legend>{allNotificationCategories.map(c => <label key={c}><input type="checkbox" checked={settings.optionalCategories.includes(c)} onChange={e => toggle("optionalCategories", c, e.target.checked)} />{notificationCategories[c]}</label>)}</fieldset>
      <h3>Дублирование по электронной почте</h3><p>{settings.emailReason}</p><p>Университетская почта пока не подключена. В письмах передаётся только сообщение об обновлении и ссылка в защищённый кабинет.</p>
      <label><input type="checkbox" checked={settings.personalEmail} onChange={e => setSettings({ ...settings, personalEmail: e.target.checked })} />Дублировать на подтверждённую почту учётной записи</label>
      <fieldset><legend>Категории писем</legend>{allNotificationCategories.map(c => <label key={c}><input type="checkbox" checked={settings.emailCategories.includes(c)} onChange={e => toggle("emailCategories", c, e.target.checked)} />{notificationCategories[c]}</label>)}</fieldset>
      <button className="button button-primary" disabled={busy} onClick={() => void save()}>Сохранить настройки уведомлений</button>
    </>}
  </div>;
}
