import Link from "next/link";
import { io } from "next/cache";
import { getPublicSchedule } from "@/lib/schedule";
import { isoDate, parseScheduleQuery, scheduleHref } from "@/lib/schedule-calendar";
import { ScheduleSearch } from "./schedule-search";
import { ScheduleView } from "./schedule-view";
import { Icon } from "./icon";

export async function PublicSchedule({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await io();
  const query = parseScheduleQuery(await searchParams);
  let model: Awaited<ReturnType<typeof getPublicSchedule>>;
  try { model = await getPublicSchedule(query); }
  catch { console.error("schedule.public_lookup_failed"); return <section className="schedule-loading panel" role="alert"><h1>Расписание временно недоступно</h1><p>Не удалось загрузить данные. Попробуйте обновить страницу позже.</p><Link href="/" className="text-link">На главную</Link></section>; }
  const navigation = { view: query.view, selected: "", week: isoDate(query.week), day: query.day };
  return <>
    <div className="schedule-title"><div><h1>Расписание занятий</h1><p>Выберите группу или преподавателя.</p></div><Link href="/login" className="button button-outline">Личный кабинет <Icon name="arrow" size={17} /></Link></div>
    <section className="schedule-filter-panel panel" aria-label="Поиск расписания">
      <nav className="schedule-mode" aria-label="Искать расписание"><Link scroll={false} prefetch={false} href={scheduleHref("/schedule", navigation, { view: "group" })} aria-current={query.view === "group" ? "page" : undefined}><Icon name="cap" size={18} />По группе</Link><Link scroll={false} prefetch={false} href={scheduleHref("/schedule", navigation, { view: "teacher" })} aria-current={query.view === "teacher" ? "page" : undefined}><Icon name="user" size={18} />По преподавателю</Link></nav>
      <ScheduleSearch groups={model.allGroups} teachers={model.allTeachers} view={query.view} selected={model.selected?.slug ?? ""} initialValue={query.q || (query.selected ? model.selected?.name ?? "" : "")} week={model.weekStart} day={query.day} />
    </section>
    <ScheduleView model={model} path="/schedule" view={query.view} day={query.day} invalid={query.invalid} />
  </>;
}
