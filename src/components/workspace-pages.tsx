import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/access";
import { roleHomes, roleLabels } from "@/lib/roles";
import { workspaces, type WorkspaceRole } from "@/lib/workspaces";
import { WorkspaceShell } from "./workspace-shell";
import { Icon } from "./icon";
import CabinetPageLoading from "./cabinet-page-loading";

export function ProtectedLoading() {
  return <main className="not-found" role="status">Проверяем доступ к кабинету…</main>;
}

async function AuthorizedShell({ role, children }: { role: WorkspaceRole; children: ReactNode }) {
  const user = await requireRole(role);
  return <WorkspaceShell role={role} name={user.name}>{children}</WorkspaceShell>;
}

export function WorkspaceLayout({ role, children }: { role: WorkspaceRole; children: ReactNode }) {
  return <Suspense fallback={<ProtectedLoading />}><AuthorizedShell role={role}>{children}</AuthorizedShell></Suspense>;
}

export async function WorkspaceHome({ role }: { role: WorkspaceRole }) {
  const user = await requireRole(role);
  const workspace = workspaces[role];
  return <>
    <div className="dashboard-title"><div><span className="eyebrow">{roleLabels[role]}</span><h1>{workspace.title}</h1><p>Здравствуйте, {user.name}. {workspace.description}</p></div></div>
    <section className="panel workspace-welcome"><span className="icon-tile"><Icon name="shield" /></span><div><h2>Ваше рабочее пространство</h2><p>{role === "TEACHER" ? "Расписание ваших занятий доступно в разделе «Моё расписание». Остальные разделы находятся в разработке." : "Вход и разграничение доступа уже работают. Выберите раздел, чтобы познакомиться со структурой кабинета. Рабочие модули появятся на следующих этапах."}</p></div></section>
    <div className="workspace-grid">{workspace.sections.map((item) => <Link key={item.slug} href={`${roleHomes[role]}/${item.slug}`} className="panel workspace-card"><span className="icon-tile"><Icon name={item.icon} /></span><h2>{item.title}</h2><p>{item.description}</p><span className="workspace-status">{item.slug === "profile" ? "Открыть профиль" : role === "TEACHER" && item.slug === "schedule" ? "Открыть расписание" : "В разработке"} <Icon name="arrow" size={16} /></span></Link>)}</div>
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
    <section className="placeholder-panel"><span className="placeholder-icon"><Icon name={section.icon} size={38} /></span><span className="demo-badge">В разработке</span><h2>{section.title}</h2><p>{section.description}</p><div className="placeholder-note"><Icon name="help" size={18} /><p>Сейчас подготовлена основа раздела с проверкой прав доступа. Работа с данными будет добавлена на следующем этапе.</p></div><Link href={roleHomes[role]} className="button button-primary">На главную кабинета <Icon name="arrow" /></Link></section>
  </>;
}
