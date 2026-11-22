import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/access";
import { passRights } from "@/lib/student-passes";
import { prisma } from "@/lib/prisma";
import { roleHomes } from "@/lib/roles";
import { passSection, workspaces, type WorkspaceRole } from "@/lib/workspaces";
import { WorkspaceShell } from "./workspace-shell";
import { Icon } from "./icon";
import CabinetPageLoading from "./cabinet-page-loading";
import { NotificationsProvider } from "./notifications-provider";
import { ServiceNotifications } from "./services-notifications";

export function ProtectedLoading() {
  return <main className="not-found" role="status">Проверяем доступ к кабинету…</main>;
}

async function AuthorizedShell({ role, children }: { role: WorkspaceRole; children: ReactNode }) {
  const user = await requireRole(role);
  return <NotificationsProvider key={`${user.id}:${user.role}`} identity={`${user.id}:${user.role}`}><WorkspaceShell role={role} name={user.name} showPasses={Boolean(await passRights(prisma, user))}>{children}</WorkspaceShell></NotificationsProvider>;
}

export function WorkspaceLayout({ role, children }: { role: WorkspaceRole; children: ReactNode }) {
  return <Suspense fallback={<ProtectedLoading />}><AuthorizedShell role={role}>{children}</AuthorizedShell></Suspense>;
}

export async function WorkspaceHome({ role }: { role: WorkspaceRole }) {
  const user = await requireRole(role);
  const workspace = workspaces[role];
  const sections = await passRights(prisma, user) ? [passSection, ...workspace.sections] : workspace.sections;
  return <>
    <div className="dashboard-title"><div><h1>{workspace.title}</h1></div></div>
    <ServiceNotifications compact home={roleHomes[role]} />
    <div className="workspace-grid">{sections.map((item) => <Link key={item.slug} href={`${roleHomes[role]}/${item.slug}`} className="panel workspace-card"><span className="icon-tile"><Icon name={item.icon} /></span><h2>{item.title}</h2><p>{item.description}</p><span className="workspace-status">{["profile", "notifications", "clearance", "passes", "dormitory"].includes(item.slug) || role === "TEACHER" && ["materials", "schedule", "grades", "session", "consultations"].includes(item.slug) || role === "ADMIN" && ["requests", "news", "useful"].includes(item.slug) || role === "TECHNICAL_STAFF" && item.slug === "services" || role === "DEANERY_STAFF" ? "Открыть" : "В разработке"} <Icon name="arrow" size={16} /></span></Link>)}</div>
  </>;
}

type WorkspaceSectionProps = { role: WorkspaceRole; params: Promise<{ section: string }> };

export function WorkspaceSection(props: WorkspaceSectionProps) {
  // The dynamic params read needs a boundary inside the page as well, including
  // the first visit to a previously unrendered section under a shared layout.
  return <Suspense fallback={<CabinetPageLoading />}><WorkspaceSectionContent {...props} /></Suspense>;
}

async function WorkspaceSectionContent({ role, params }: WorkspaceSectionProps) {
  await requireRole(role);
  const { section: slug } = await params;
  const section = workspaces[role].sections.find((item) => item.slug === slug);
  if (!section) notFound();

  return <>
    <div className="dashboard-title"><div><span className="eyebrow">{workspaces[role].title}</span><h1>{section.title}</h1></div></div>
    <section className="placeholder-panel"><span className="placeholder-icon"><Icon name={section.icon} size={38} /></span><h2>Раздел пока недоступен</h2><p>{section.description}</p><div className="placeholder-note"><Icon name="help" size={18} /><p>Раздел в разработке. Его функции пока недоступны.</p></div><Link href={roleHomes[role]} className="button button-primary">На главную кабинета <Icon name="arrow" /></Link></section>
  </>;
}
