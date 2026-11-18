"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useNotifications } from "./notifications-provider";
import { notificationCategories } from "@/lib/notifications-shared";
import { serviceDate } from "@/lib/services-ui";
import { Icon } from "./icon";

// Keep the existing import contract; all sources share this single inbox now.
export function ServiceNotifications({ compact = false, home = "/dashboard" }: { compact?: boolean; home?: string }) {
  const feed = useNotifications();
  const refresh = feed.refresh;
  // The cabinet provider survives route changes. Entering the home widget or
  // full feed asks that same store for fresh data, without another timer.
  useEffect(() => { refresh(); }, [compact, refresh]);
  return <section className="panel notifications-panel services-notifications" aria-label="Уведомления">
    <div className="panel-heading notifications-heading"><div><h2>Уведомления</h2><p className="notification-summary" role="status">Непрочитанных: <strong>{feed.unread}</strong></p></div>
      {compact ? <Link className="text-link" href={`${home}/notifications`}>Все <Icon name="arrow" size={16} /></Link> : <button className="button button-secondary" disabled={!feed.unread || feed.busy} onClick={() => void feed.read(feed.boundary, true)}>Прочитать все</button>}
    </div>
    {feed.error && <p role="alert" className="services-error">{feed.error} <button onClick={feed.refresh}>Повторить</button></p>}
    {feed.loading ? <p className="services-panel" role="status">Загружаем уведомления…</p> : !feed.items.length && <p className="services-panel">Уведомлений пока нет.</p>}
    <div className="notification-list">{(compact ? feed.items.slice(0, 3) : feed.items).map(item => <Link key={item.id} href={item.href} onClick={() => { if (!item.readAt) void feed.read(item.id, false); }} className={`notification-item services-event${item.readAt ? " notification-read" : " notification-unread"}`} aria-label={`${item.readAt ? "" : "Новое. "}${item.title}`}>
      <span className="notification-icon green" aria-hidden="true"><Icon name="bell" size={18} /></span><div><div className="notification-meta"><span className="notification-category">{notificationCategories[item.category]}</span>{!item.readAt && <span className="notification-new">Новое</span>}</div><h3>{item.title}</h3><p>{item.body}</p><time className="notification-time" dateTime={item.createdAt}>{serviceDate(item.createdAt)}</time></div>
    </Link>)}</div>
    {!compact && feed.nextCursor && <div className="services-pagination"><button disabled={feed.busy} onClick={() => void feed.more()}>Показать ещё</button></div>}
  </section>;
}
