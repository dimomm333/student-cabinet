import Link from "next/link";
import { ServiceNotifications } from "./services-notifications";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { withDeanery } from "@/lib/deanery";
import { getDeaneryGroups, getDeaneryOverview, getDeanerySchedule, getDeaneryStudents } from "@/lib/deanery-repository";
import { parseScheduleQuery } from "@/lib/schedule-calendar";
import { workspaces } from "@/lib/workspaces";
import { ScheduleView } from "./schedule-view";
import CabinetPageLoading from "./cabinet-page-loading";

export type DeanerySearch = Promise<Record<string, string | string[] | undefined>>;
function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="dashboard-title"><div><span className="eyebrow">Деканат</span><h1>{title}</h1>{children && <p>{children}</p>}</div></div>;
}
async function HomeContent() {
  const model = await withDeanery(getDeaneryOverview);
  return <><Heading title="Рабочая панель деканата">Учебная работа в назначенных подразделениях.</Heading>
    <ServiceNotifications compact home="/deanery" />
    <section className="panel profile-panel"><h2>Область доступа</h2>{model.departments.length ? <ul>{model.departments.map(department => <li key={department.id}>{department.faculty} · {department.name}</li>)}</ul> : <p>Подразделения не назначены. Доступ к студентам и группам закрыт. Обратитесь к ответственному за назначения.</p>}</section>
    <div className="workspace-grid">
      <Link href="/deanery/students" className="panel workspace-card"><h2>Студенты</h2><strong className="deanery-count">{model.students}</strong><p>В назначенных подразделениях</p></Link>
      <Link href="/deanery/groups" className="panel workspace-card"><h2>Учебные группы</h2><strong className="deanery-count">{model.groups}</strong><p>В назначенных подразделениях</p></Link>
      <Link href="/deanery/schedule" className="panel workspace-card"><h2>Расписание</h2><p>Редактор занятий, разовых замен и отмен для своих групп</p></Link>
      <Link href="/deanery/brs" className="panel workspace-card"><h2>БРС и допуски</h2><p>Планы дисциплин, учебные назначения, результаты и подтверждение допуска к экзаменам</p></Link>
      <Link href="/deanery/requests" className="panel workspace-card"><h2>Заявки и заявления</h2><p>Очередь электронных услуг, документы, уточнения и решения по действующим полномочиям.</p></Link>
    </div></>;
}
export function DeaneryHome() { return <Suspense fallback={<CabinetPageLoading />}><HomeContent /></Suspense>; }

async function SectionContent({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: DeanerySearch }) {
  // Authorize before reading parameters or rendering any protected section.
  await withDeanery(getDeaneryOverview);
  const { section } = await params;
  const config = workspaces.DEANERY_STAFF.sections.find(item => item.slug === section);
  if (!config || section === "profile") notFound();
  const search = await searchParams;
  const scalar = (key: string) => { const value = search[key]; if (Array.isArray(value) || (value && value.length > 128)) notFound(); return value || undefined; };
  const filters = { departmentId: scalar("departmentId"), groupId: scalar("groupId"), studentId: scalar("studentId") };
  if (section === "schedule") {
    const query = parseScheduleQuery(search);
    if (query.view !== "group") notFound();
    // Optional filters are validated as well, never accepted as authorization.
    await withDeanery((db, actor) => getDeaneryGroups(db, actor, filters));
    const model = await withDeanery((db, actor) => getDeanerySchedule(db, actor, query));
    return <><Heading title="Расписание">Только просмотр опубликованного расписания групп вашей области доступа.</Heading>
      <form className="panel profile-panel" action="/deanery/schedule"><label htmlFor="deanery-group">Учебная группа</label><select id="deanery-group" name="group" defaultValue={model.selected?.slug ?? ""}><option value="" disabled>Выберите группу</option>{model.allGroups.map(group => <option key={group.slug} value={group.slug}>{group.name}</option>)}</select><input type="hidden" name="week" value={model.weekStart} /><button type="submit" className="button button-primary" disabled={!model.allGroups.length}>Показать расписание</button></form>
      {model.allGroups.length ? <ScheduleView model={model} path="/deanery/schedule" view="group" day={query.day} invalid={query.invalid} /> : <p className="panel profile-panel">Нет групп с опубликованным расписанием в вашей области доступа.</p>}</>;
  }
  if (section === "students" || section === "groups") {
    const rows = section === "students" ? await withDeanery((db, actor) => getDeaneryStudents(db, actor, filters)) : await withDeanery((db, actor) => getDeaneryGroups(db, actor, filters));
    return <><Heading title={config.title}>{config.description} Только просмотр.</Heading><div className="deanery-list">{rows.slice(0, 200).map(row => "user" in row
      ? <article key={row.userId} className="panel profile-panel"><h2>{row.user.name}</h2><p>{row.user.email}</p><dl className="profile-fields"><div><dt>Группа</dt><dd>{row.group?.code ?? "Не заполнено"}</dd></div><div><dt>Курс</dt><dd>{row.course ?? "Не заполнено"}</dd></div><div><dt>Номер студенческого билета</dt><dd>{row.studentNumber || "Не заполнено"}</dd></div></dl></article>
      : <article key={row.id} className="panel profile-panel"><h2>{row.code}</h2><p>{row.programme} · {row.course} курс</p><p>{row.department?.faculty} · {row.department?.name}</p><p>Студентов: {row._count.students}</p>{row.isPublic && <Link href={`/deanery/schedule?group=${encodeURIComponent(row.slug)}`}>Просмотреть расписание</Link>}</article>)}</div>{!rows.length && <p className="panel profile-panel">Нет данных в назначенных подразделениях.</p>}{rows.length > 200 && <p>Показаны первые 200 записей. Уточните подразделение или группу.</p>}</>;
  }
  return <><Heading title={config.title} /><section className="placeholder-panel"><h2>Раздел пока недоступен</h2><p>Раздел в разработке. Его функции пока недоступны.</p><p>{config.description}</p><Link className="button button-primary" href="/deanery">На главную кабинета</Link></section></>;
}
export function DeanerySection(props: { params: Promise<{ section: string }>; searchParams: DeanerySearch }) { return <Suspense fallback={<CabinetPageLoading />}><SectionContent {...props} /></Suspense>; }
