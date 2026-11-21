"use client";
import { HomePass } from "./student-pass";

import Link from "next/link";
import { presentAcademicText } from "@/lib/presentation-copy";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StudentHomeData } from "@/lib/student-home";
import { dashboardBlockLabels, defaultDashboardLayout, type DashboardBlock, type DashboardLayout } from "@/lib/dashboard-layout";
import { useNotifications } from "./notifications-provider";
import { Icon } from "./icon";

async function requestHome<T>(body?: unknown): Promise<T> {
  const response = await fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000),
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Не удалось обновить главную."), { status: response.status });
  return data;
}
function NotificationsSummary() {
  const { unread, loading, error } = useNotifications();
  return <Link href="/dashboard/notifications" className="panel home-notifications" data-unread={loading ? undefined : unread}>
    <Icon name="bell" size={19} /><span aria-live="polite">{loading ? "Проверяем уведомления…" : error ? "Не удалось обновить уведомления" : unread ? `Есть ${unread} новых уведомлений` : "Новых уведомлений нет"}</span><Icon name="chevron" size={16} />
  </Link>;
}
const calendarDate = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(value.slice(0,10) + "T00:00:00Z"));
function lessonChange(change: StudentHomeData["schedule"]["lessons"][number]["change"]) {
  return change?.type === "MOVED_FROM" ? `Перенесено на ${change.targetDate ? calendarDate(change.targetDate) : "другую дату"}` : change?.cancelled ? "Отменено" : change?.type === "MOVED" ? "Перенос" : change?.type === "ADDED" ? "Дополнительное занятие" : change ? "Замена" : "";
}
function lessonRoom(lesson: Pick<StudentHomeData["schedule"]["lessons"][number], "room" | "building">) {
  return `Ауд. ${lesson.room}${lesson.building ? ` · ${lesson.building.replace(/^Учебный корпус\s+/u, "корпус ")}` : ""}`;
}
function Schedule({ data }: { data: StudentHomeData }) {
  const s = data.schedule;
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: s.timeZone }).format(new Date(data.asOf));
  const current = s.next?.date === s.today && s.next.start <= s.time;
  return <section className="panel home-schedule" aria-labelledby="home-schedule-title">
    <div className="home-block-heading"><h2 id="home-schedule-title">Расписание</h2><Link href={s.nextHref} className="text-link">Всё расписание <Icon name="arrow" size={15} /></Link></div>
    <div className="home-calendar"><time dateTime={s.today}>{today}</time><span className="home-parity">{s.parity}</span><small>{s.timeZone === "Europe/Moscow" ? "Московское время" : s.timeZone}</small></div>
    {s.next ? <>
      <Link className="home-next" href={s.nextHref}>
        <span className="home-next-time"><small>{current ? "Сейчас" : "Ближайшее"}</small><strong>{s.next.start}</strong><small>до {s.next.end}</small></span>
        <span><strong>{s.next.discipline}</strong><span>{s.next.kind} · {lessonRoom(s.next)}</span>{s.next.change && <small className="home-change">{lessonChange(s.next.change)}</small>}</span><Icon name="chevron" size={17} />
      </Link>
      <div className="home-day-heading"><h3>{s.selectedDate === s.today ? "Сегодня" : `${s.day!.name}, ${calendarDate(s.selectedDate)}`}</h3>
        {s.reason !== "today" && <p>{s.reason === "finished" ? "Сегодня занятия закончились" : s.reason === "cancelled" ? "Сегодня занятия отменены" : "Сегодня занятий нет"} · ближайший учебный день</p>}
      </div>
      <ol className="home-lessons">{s.lessons.map(lesson => {
        const change = lesson.change;
        const changed = lessonChange(change);
        return <li key={lesson.key}><Link href={lesson.href} className={"home-lesson" + (change?.cancelled ? " is-cancelled" : lesson.ended ? " is-ended" : "")}
          aria-label={`${lesson.start}–${lesson.end}, ${lesson.discipline}, ${lesson.kind}, аудитория ${lesson.room}${changed ? ", " + changed : ""}`}>
          <span className="home-lesson-time"><strong>{lesson.start}</strong><small>{lesson.end}</small></span>
          <span className="home-lesson-body"><strong className="home-lesson-name">{lesson.discipline}</strong><span>{lesson.kind} · {lessonRoom(lesson)}</span>
            {changed && <small className={"home-change" + (change?.cancelled ? " home-cancelled" : "")}>{changed}</small>}
          </span><Icon name="chevron" size={14} />
        </Link></li>;
      })}</ol>
    </> : <p className="home-empty">{s.linked ? "В опубликованном расписании ближайших занятий нет." : "Учебная группа пока не привязана. Обратитесь в учебную часть."}</p>}
  </section>;
}
function Study({ data }: { data: StudentHomeData }) {
  const { recent, upcoming, undatedHref } = data.study;
  return <section className="panel home-study" aria-labelledby="home-study-title">
    <div className="home-block-heading"><h2 id="home-study-title">Учёба и контроль</h2><Link href="/dashboard/grades" className="text-link">БРС <Icon name="arrow" size={15} /></Link></div>
    <h3 className="home-subtitle">Последние результаты</h3>
    {recent.length ? <ul className="home-results">{recent.slice(0,2).map(result => <li key={result.id}><Link href={result.href}><span><strong>{result.discipline}</strong><small>{presentAcademicText(result.title)}</small></span><strong className="home-score">{result.value}</strong></Link></li>)}</ul> : <p className="home-empty">Оценок пока нет.</p>}
    <div className="home-control"><h3 className="home-subtitle">Ближайший контроль</h3>
      {upcoming ? <Link href={upcoming.href}><time dateTime={upcoming.date}>{calendarDate(upcoming.date)}</time><strong>{upcoming.discipline}</strong><span>{presentAcademicText(upcoming.title)}</span><Icon name="chevron" size={15} /></Link>
        : undatedHref ? <Link href={undatedHref}>Дата не назначена <Icon name="chevron" size={15} /></Link> : <p className="home-empty">Контрольные работы пока не назначены.</p>}
    </div>
  </section>;
}
function Announcements({ data }: { data: StudentHomeData }) {
  return <section className="panel home-announcements" aria-labelledby="home-news-title">
    <div className="home-block-heading"><h2 id="home-news-title">Объявления</h2><Link href="/dashboard/news" className="text-link">Все <Icon name="arrow" size={15} /></Link></div>
    {data.announcements.length ? <ul className="home-news">{data.announcements.map(item => <li key={item.id}><Link href={`/dashboard/news?id=${encodeURIComponent(item.id)}`}><strong>{item.title}</strong><time dateTime={item.publishedAt}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: data.schedule.timeZone }).format(new Date(item.publishedAt))}</time></Link></li>)}</ul> : <p className="home-empty">Опубликованных объявлений пока нет.</p>}
  </section>;
}

export function StudentHome({ initial }: { initial: StudentHomeData }) {
  const [data, setData] = useState(initial), [error, setError] = useState("");
  const [draft, setDraft] = useState<DashboardLayout>(initial.layout), [version, setVersion] = useState(initial.layoutVersion);
  const [saving, setSaving] = useState(false), [settingsError, setSettingsError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false), active = useRef(true);
  const router = useRouter();
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try { const next = await requestHome<StudentHomeData>();if (active.current) { setData(current => next.layoutVersion < current.layoutVersion ? { ...next, layout: current.layout, layoutVersion: current.layoutVersion } : next);setError(""); } }
    catch (error) {
      if (!active.current) return;
      if ([401,403].includes((error as {status?:number}).status ?? 0)) router.refresh();
      setError("Не удалось обновить данные главной.");
    } finally { pending.current = false; }
  }, [router]);
  useEffect(() => {
    active.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(async () => { await refresh();if (active.current) schedule(); }, 60000 - Date.now() % 60000 + 50);
    };
    const visible = () => { if (document.visibilityState === "visible") void refresh();schedule(); };
    schedule();window.addEventListener("focus", visible);window.addEventListener("online", visible);document.addEventListener("visibilitychange", visible);
    return () => { active.current = false;clearTimeout(timer);window.removeEventListener("focus", visible);window.removeEventListener("online", visible);document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  const open = () => { setDraft({ order: [...data.layout.order], hidden: [...data.layout.hidden] });setVersion(data.layoutVersion);setSettingsError("");dialog.current?.showModal(); };
  const move = (id: DashboardBlock, offset: number) => setDraft(layout => {
    const order = [...layout.order], index = order.indexOf(id), target = index + offset;
    if (index < 0 || target < 0 || target >= order.length) return layout;
    [order[index],order[target]] = [order[target],order[index]];return { ...layout, order };
  });
  const save = async () => {
    if (saving) return;
    setSaving(true);setSettingsError("");
    try {
      const saved = await requestHome<{layout:DashboardLayout;layoutVersion:number}>({ layout: draft, version });
      setData(current => ({ ...current, ...saved }));dialog.current?.close();
    } catch (error) { setSettingsError((error as {status?:number}).status ? (error as Error).message : "Нет связи с сервером. Повторите сохранение."); }
    finally { setSaving(false); }
  };
  const widgets = { schedule: <Schedule data={data} />, notifications: <NotificationsSummary />, study: <Study data={data} />, announcements: <Announcements data={data} /> };
  return <div className="student-home">
    <div className="home-heading"><div><h1>Главная</h1>{data.schedule.group && <span className="home-group">{data.schedule.group}</span>}</div><div className="home-page-actions"><HomePass /><button type="button" className="button button-outline home-settings-trigger" aria-label="Настроить главную" title="Настроить главную" onClick={open}><Icon name="settings" size={19} /></button></div></div>
    {error && <p className="home-refresh-error" role="status">{error} <button type="button" onClick={() => void refresh()}>Повторить</button></p>}
    <div className="home-layout">{data.layout.order.filter(id => !data.layout.hidden.includes(id)).map(id => <div className="home-widget" data-home-block={id} key={id}>{widgets[id]}</div>)}</div>
    <dialog ref={dialog} className="home-customize" aria-labelledby="home-customize-title" onClick={event => { if (event.target === event.currentTarget && !saving) dialog.current?.close(); }}>
      <div className="home-dialog-heading"><h2 id="home-customize-title">Настроить главную</h2><button type="button" className="icon-button" aria-label="Закрыть настройки главной" onClick={() => dialog.current?.close()}><Icon name="close" /></button></div>
      <p>Все блоки можно переместить. Расписание нельзя скрыть.</p>
      <ol className="home-block-options">{draft.order.map((id,index) => <li key={id}>
        <label><input type="checkbox" checked={!draft.hidden.includes(id)} disabled={id === "schedule" || saving} onChange={event => setDraft(layout => ({ ...layout, hidden: event.target.checked ? layout.hidden.filter(item => item !== id) : [...layout.hidden,id] }))} />{dashboardBlockLabels[id]}</label>
        <span><button type="button" className="icon-button" aria-label={`Выше: ${dashboardBlockLabels[id]}`} disabled={index === 0 || saving} onClick={() => move(id,-1)}><Icon name="chevron" style={{transform:"rotate(-90deg)"}} size={17} /></button><button type="button" className="icon-button" aria-label={`Ниже: ${dashboardBlockLabels[id]}`} disabled={index === draft.order.length - 1 || saving} onClick={() => move(id,1)}><Icon name="chevron" style={{transform:"rotate(90deg)"}} size={17} /></button></span>
      </li>)}</ol>
      <button type="button" className="text-link home-reset" disabled={saving} onClick={() => setDraft(defaultDashboardLayout())}>Сбросить к стандартному</button>
      {settingsError && <p className="home-settings-error" role="alert">{settingsError}</p>}
      <div className="home-dialog-actions"><button type="button" className="button button-outline" onClick={() => dialog.current?.close()}>Отмена</button><button type="button" className="button button-primary" disabled={saving} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить"}</button></div>
    </dialog>
  </div>;
}
