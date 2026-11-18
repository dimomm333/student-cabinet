"use client";

import Link from "next/link";
import { Icon } from "./icon";
import { useNotifications } from "./notifications-provider";

export function NotificationBell({ href }: { href: string }) {
  const { unread } = useNotifications();
  return <Link href={href} className="icon-button notification-button" aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"}>
    <span className="notification-bell-icon">
      <Icon name="bell" />
      {unread > 0 && <span className={`notification-bell-count${unread > 99 ? " notification-bell-count-wide" : ""}`} aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
    </span>
  </Link>;
}
