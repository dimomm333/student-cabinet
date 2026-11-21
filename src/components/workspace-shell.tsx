"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { roleHomes, roleLabels } from "@/lib/roles";
import { passSection, workspaces, type WorkspaceRole } from "@/lib/workspaces";
import { Brand } from "./brand";
import { Icon } from "./icon";
import { LogoutButton } from "./auth-controls";
import { ProfileLink } from "./profile-link";
import { NotificationBell } from "./notification-bell";
import { NotificationBadge } from "./notifications-provider";
import { ThemeToggle } from "./theme-toggle";
import { AutoHideHeader } from "./auto-hide-header";

export function WorkspaceShell({ role, name, children, showPasses }: { role: WorkspaceRole; name: string; children: ReactNode; showPasses: boolean }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);
  const workspace = workspaces[role];
  const home = roleHomes[role];
  const sections = showPasses ? [passSection, ...workspace.sections] : workspace.sections;
  const current = sections.find((item) => pathname === `${home}/${item.slug}`);
  const close = () => menu.current?.close();
  const navigation = <nav className="sidebar-nav" aria-label={workspace.title}>
    {[{ slug: "", title: "Главная", icon: "home" as const }, ...sections].map((item) => {
      const href = home + (item.slug ? `/${item.slug}` : "");
      return <Link key={href} href={href} onClick={close} className={"nav-item" + (pathname === href ? " active" : "")} aria-current={pathname === href ? "page" : undefined}>
        <Icon name={item.icon} /><span>{item.title}</span>{item.slug === "notifications" && <NotificationBadge />}
      </Link>;
    })}
  </nav>;

  return <div className="dashboard-shell role-workspace">
    <a className="skip-link" href="#workspace-main">Перейти к содержимому</a>
    <aside className="desktop-sidebar">
      <div className="sidebar-brand"><Brand /></div>
      <p className="nav-group-label role-nav-label">{roleLabels[role]}</p>
      {navigation}
      <div className="sidebar-bottom"><Link href="/" className="sidebar-help"><Icon name="home" />На сайт университета</Link><p>Северный университет · 2026</p></div>
    </aside>
    <dialog ref={menu} className="mobile-menu" aria-labelledby="workspace-menu-title" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="mobile-menu-inner">
        <div className="mobile-menu-heading"><span id="workspace-menu-title">Разделы кабинета</span><button autoFocus type="button" className="icon-button" aria-label="Закрыть меню" onClick={close}><Icon name="close" /></button></div>
        <Brand />{navigation}<LogoutButton className="nav-item role-logout" />
      </div>
    </dialog>
    <div className="dashboard-workspace">
      <AutoHideHeader>
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="icon-button mobile-menu-trigger" aria-label="Открыть меню" aria-haspopup="dialog" onClick={() => menu.current?.showModal()}><Icon name="menu" /></button>
          <div className="breadcrumb"><span>{workspace.title}</span><Icon name="chevron" size={14} /><strong>{current?.title ?? "Главная"}</strong></div>
        </div>
        <div className="header-actions"><ThemeToggle /><NotificationBell href={`${home}/notifications`} /><ProfileLink name={name} role={role} /><LogoutButton className="icon-button" compact /></div>
      </AutoHideHeader>
      <main id="workspace-main" className="dashboard-main">{children}</main>
      <footer className="dashboard-footer"><span>{workspace.title}</span><span>Северный университет</span></footer>
    </div>
  </div>;
}
