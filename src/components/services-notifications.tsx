"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { notifications } from "@/lib/demo-data";
import { serviceDate, serviceFetch, serviceUrl } from "@/lib/services-ui";
import { Icon } from "./icon";
const labels: Record<string, string> = { SUBMITTED: "Заявление принято", RESUBMITTED: "Уточнение отправлено", IN_REVIEW: "Заявление на рассмотрении", CLARIFICATION_REQUIRED: "Требуется уточнение заявления", IN_PROGRESS: "Заявление в работе", COMPLETED: "Заявление исполнено", REJECTED: "По заявлению получен отказ", STAFF_REPLY: "Поступил ответ сотрудника" };
type Event = { id: string; type: string; requestId: string; createdAt: string; href: string };
export function ServiceNotifications({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<Event[]>([]), [page, setPage] = useState(0), [error, setError] = useState(""), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener("services-updated", refresh); window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("services-updated", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    let active = true;
    serviceFetch<{ items: Event[] }>(serviceUrl({ view: "events", page: String(page) })).then(data => { if (active) { setItems(data.items); setError(""); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);
  return <section className="panel notifications-panel services-notifications"><div className="panel-heading"><h2>{compact ? "Уведомления" : "События моих заявлений"}</h2>{compact ? <Link className="text-link" href="/dashboard/notifications">Все <Icon name="arrow" size={16} /></Link> : <button className="text-link" onClick={() => setRevision(n => n + 1)}>Обновить</button>}</div>
    {error && <p role="alert" className="services-error">{error} <button onClick={() => setRevision(n => n + 1)}>Повторить</button></p>}
    {loading ? <p className="services-panel" role="status">Загружаем уведомления…</p> : !items.length && <p className="services-panel">Событий по заявлениям пока нет.</p>}
    <div className="notification-list">{(compact ? items.slice(0, 3) : items).map(item => <Link key={item.id} href={item.href} className="notification-item services-event"><span className="notification-icon green"><Icon name="bell" size={18} /></span><div><h3>{labels[item.type] ?? "Заявление обновлено"}</h3><p>Заявление № {item.requestId.slice(-8)}. Подробности доступны в личной карточке.</p><time className="notification-time">{serviceDate(item.createdAt)}</time></div></Link>)}</div>
    {!compact && <div className="services-pagination"><button disabled={!page} onClick={() => { setPage(n => n - 1); setLoading(true); }}>← Назад</button><span>Страница {page + 1}</span><button disabled={items.length < 50} onClick={() => { setPage(n => n + 1); setLoading(true); }}>Далее →</button></div>}
    <details className="services-demo-notifications"><summary>Демонстрационные уведомления кампуса</summary><div className="notification-list">{notifications.map(item => <article className="notification-item" key={item.title}><span className={"notification-icon " + item.tone}><Icon name={item.icon} size={18} /></span><div><h3>{item.title}</h3><p>{item.text}</p><span className="notification-time">Демонстрационный пример · {item.time}</span></div></article>)}</div></details>
  </section>;
}
