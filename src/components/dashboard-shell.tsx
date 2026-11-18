"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";
import { sections } from "@/lib/demo-data";
import { Brand } from "./brand";
import { Icon } from "./icon";
import { LogoutButton } from "./auth-controls";
import { ProfileLink } from "./profile-link";
import { NotificationBadge } from "./notifications-provider";

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav aria-label="Разделы кабинета" className="sidebar-nav">
      <Link
        onClick={onNavigate}
        href="/dashboard"
        className={"nav-item" + (pathname === "/dashboard" ? " active" : "")}
        aria-current={pathname === "/dashboard" ? "page" : undefined}
      >
        <Icon name="home" /><span>Главная</span>
      </Link>
      {["Учёба", "Кампус"].map((group) => (
        <div key={group}>
          <p className="nav-group-label">{group}</p>
          {sections.filter((item) => item.group === group).map((item) => {
            const href = "/dashboard/" + item.slug;
            const active = pathname === href;

            return (
              <Link
                key={item.slug}
                onClick={event => {
                  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && ["grades", "session"].includes(item.slug) && ["/dashboard/grades", "/dashboard/session"].includes(pathname)) {
                    const planId = new URLSearchParams(window.location.search).get("planId");
                    if (planId) { event.preventDefault(); router.push(href + "?planId=" + encodeURIComponent(planId)); }
                  }
                  onNavigate?.();
                }}
                href={href}
                className={"nav-item" + (active ? " active" : "")}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={item.icon} /><span>{item.title}</span>{item.slug === "notifications" && <NotificationBadge />}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function DashboardShell({ children, name }: { children: React.ReactNode; name: string }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);
  const currentSection = sections.find((section) => pathname === "/dashboard/" + section.slug);
  const closeMenu = () => menu.current?.close();

  return (
    <div className="dashboard-shell">
      <a className="skip-link" href="#dashboard-main">Перейти к содержимому</a>
      <aside className="desktop-sidebar">
        <div className="sidebar-brand"><Brand /></div>
        <Navigation />
        <div className="sidebar-bottom">
          <Link href="/dashboard/useful" className="sidebar-help">
            <Icon name="help" />
            <span>Нужна помощь?<small>Полезное для студента</small></span>
            <Icon name="chevron" size={16} />
          </Link>
          <p>Северный университет · 2026</p>
        </div>
      </aside>

      <dialog
        ref={menu}
        id="mobile-menu"
        className="mobile-menu"
        aria-labelledby="mobile-menu-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
      >
        <div className="mobile-menu-inner">
          <div className="mobile-menu-heading">
            <span id="mobile-menu-title" className="font-semibold">Разделы кабинета</span>
            <button autoFocus className="icon-button" onClick={closeMenu} aria-label="Закрыть меню">
              <Icon name="close" />
            </button>
          </div>
          <Brand />
          <Navigation onNavigate={closeMenu} />
          <LogoutButton className="nav-item role-logout" />
        </div>
      </dialog>

      <div className="dashboard-workspace">
        <header className="dashboard-header">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="icon-button mobile-menu-trigger"
              onClick={() => menu.current?.showModal()}
              aria-label="Открыть меню"
              aria-haspopup="dialog"
              aria-controls="mobile-menu"
            >
              <Icon name="menu" />
            </button>
            <div className="breadcrumb">
              <span>Кабинет студента</span><Icon name="chevron" size={14} />
              <strong>{currentSection?.title ?? "Главная"}</strong>
            </div>
          </div>
          <div className="header-actions">
            <span className="demo-badge"><span className="status-dot" /> Деморежим</span>
            <Link
              href="/dashboard/notifications"
              className="icon-button notification-button"
              aria-label="Уведомления"
            >
              <Icon name="bell" />
              <NotificationBadge />
            </Link>
            <ProfileLink name={name} role="STUDENT" />
            <LogoutButton className="icon-button exit-button" compact />
          </div>
        </header>
        <main id="dashboard-main" className="dashboard-main">{children}</main>
        <footer className="dashboard-footer">
          <span>Сделано для твоего учебного дня</span>
          <span>Демонстрационный прототип · Все данные вымышлены</span>
        </footer>
      </div>
    </div>
  );
}
