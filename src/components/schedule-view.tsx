import { identifyPair, pairTimeLabel } from "@/lib/schedule-bells";
import Link from "next/link";
import type { PublicLesson, ScheduleModel } from "@/lib/schedule-repository";
import { WEEK_MS, academicWeeks, currentAcademicDate, isoDate, mondayOf, shortDayNames, lessonCountLabel, weekRangeLabel, scheduleHref } from "@/lib/schedule-calendar";
import { ScheduleWeekPicker } from "./schedule-week-picker";
import { Icon } from "./icon";

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
export function dateLabel(value: string) { return dateFormat.format(new Date(value + "T00:00:00Z")); }
export function LessonCard({ lesson }: { lesson: PublicLesson }) {
  const pair = identifyPair(lesson.start, lesson.end);
  const changes: Record<string, string> = { REPLACED: "Разовая замена", MOVED: "Перенесено с другой даты", MOVED_FROM: `Перенесено на ${lesson.change?.targetDate?.split("-").reverse().join(".") ?? "другую дату"}`, CANCELLED: "Занятие отменено", ADDED: "Дополнительная пара" };
  return <article className={"public-lesson" + (lesson.change ? " schedule-changed" : "") + (lesson.change?.cancelled ? " schedule-cancelled" : "")}><div className="public-lesson-time"><strong>{lesson.start}</strong><span>{lesson.end}</span></div><div className="public-lesson-body">{lesson.change && <p className="schedule-change-label">{changes[lesson.change.type]} · исходная дата {lesson.change.sourceDate.split("-").reverse().join(".")}</p>}<div className="public-lesson-tags">{pair && <span>{pair.number}-я пара</span>}<span>{lesson.kind}</span>{lesson.weekPattern !== "Каждую неделю" && <span className="public-lesson-pattern">{lesson.weekPattern}</span>}</div><h4>{lesson.discipline}</h4><p>{lesson.teachers.map(t => t.name).join(", ") || "Преподаватель указан в учебной части"}</p><div className="public-lesson-room"><Icon name="pin" size={14} /><strong>Ауд. {lesson.room}</strong><span>{lesson.building}</span></div><p className="public-lesson-groups">{lesson.groups.map(g => g.name).join(" · ")}</p>{lesson.change?.original && <p>Было: {lesson.change.original.discipline}, {pairTimeLabel(lesson.change.original.start, lesson.change.original.end)}, ауд. {lesson.change.original.room}, {lesson.change.original.teachers.join(", ")}</p>}</div></article>;
}
export function ScheduleDay({ day, today }: { day: ScheduleModel["days"][number]; today: string }) {
  return <section className={"schedule-day-card panel" + (day.date === today ? " schedule-today" : "")} aria-label={`${day.name}, ${dateLabel(day.date)}`}><header><div><h3>{day.name}</h3><span>{dateLabel(day.date)}</span></div>{day.date === today && <small>Сегодня</small>}</header>{day.lessons.length ? <div>{day.lessons.map(lesson => <LessonCard key={lesson.key} lesson={lesson} />)}</div> : <div className="schedule-day-empty"><Icon name="calendar" size={22} /><p>Занятий нет</p><span>На этот день ничего не опубликовано.</span></div>}</section>;
}
export function ScheduleView({ model, path, view, day, invalid = false, personal = false }: { model: ScheduleModel; path: string; view: "group" | "teacher"; day: number | null; invalid?: boolean; personal?: boolean }) {
  const today = isoDate(currentAcademicDate());
  const query = { view, selected: model.selected?.slug ?? "", week: model.weekStart, day, term: model.termCode };
  const href = (patch: Record<string, string>) => scheduleHref(path, query, patch);
  const total = model.days.reduce((sum, item) => sum + item.lessons.filter(lesson => !lesson.change?.cancelled).length, 0);
  const activeWeeks = model.terms.filter(term => term.code === model.termCode).flatMap(term => academicWeeks(term.startsOn, term.endsOn).filter(week => week.start === model.weekStart).map(week => `${term.name} · Неделя №${week.number}`));
  return <section className="schedule-results" aria-labelledby="schedule-result-title">
    {invalid && <div className="schedule-alert" role="alert">Некорректные параметры. Выберите день и неделю заново.</div>}
    <div className="schedule-week-heading"><div><span className="eyebrow">{view === "group" ? "Учебная группа" : "Преподаватель"}</span><h2 id="schedule-result-title">{model.selected?.name ?? (personal ? "Профиль расписания не заполнен" : "Ничего не найдено")}</h2><p>{weekRangeLabel(model.weekStart, model.weekEnd)} <span>·</span> {model.parity}</p>{activeWeeks.map(label => <p key={label}>{label}</p>)}</div><span className="schedule-week-count">{lessonCountLabel(total)} за неделю</span></div>
    <div className="schedule-week-toolbar"><div className="schedule-week-links"><Link scroll={false} prefetch={false} href={href({ week: isoDate(new Date(new Date(model.weekStart).getTime() - WEEK_MS)) })} aria-label="Предыдущая неделя">←</Link><Link scroll={false} prefetch={false} href={href({ week: isoDate(mondayOf(currentAcademicDate())) })}>Текущая неделя</Link><Link scroll={false} prefetch={false} href={href({ week: isoDate(new Date(new Date(model.weekStart).getTime() + WEEK_MS)) })} aria-label="Следующая неделя">→</Link></div><ScheduleWeekPicker path={path} query={query} terms={model.terms} /></div>
    <nav className="schedule-days" aria-label="Дни недели"><Link scroll={false} prefetch={false} href={href({ day: "all" })} aria-current={day === null ? "page" : undefined}>Вся неделя</Link>{model.days.map((item, index) => <Link scroll={false} prefetch={false} key={item.date} href={href({ day: String(item.dayOfWeek) })} className={item.date === today ? "schedule-day-today" : undefined} aria-current={day === item.dayOfWeek ? "page" : undefined} aria-label={`${item.name}, ${dateLabel(item.date)}${item.date === today ? ", сегодня" : ""}`}><strong>{shortDayNames[index]}</strong><span>{new Date(item.date).getUTCDate()}</span><small>{item.lessons.filter(lesson => !lesson.change?.cancelled).length}</small>{item.date === today && <em>Сегодня</em>}</Link>)}</nav>
    {!model.selected ? <div className="schedule-empty panel"><Icon name="calendar" size={34} /><h3>{personal ? "Расписание пока не привязано" : "Группы или преподаватели не найдены"}</h3><p>{personal ? "Обратитесь в учебную часть для заполнения профиля." : "Измените поисковый запрос или выберите другой режим поиска."}</p></div> : invalid ? null : <>
      {total === 0 && <p className="schedule-empty-week" role="status">На эту неделю нет опубликованных занятий. Попробуйте выбрать другую неделю.</p>}
      <div className={"schedule-day-grid" + (day ? " schedule-single-day" : "")}>{model.days.filter(item => !day || item.dayOfWeek === day).map(item => <ScheduleDay key={item.date} day={item} today={today} />)}</div>
    </>}
    {model.truncated && <p className="schedule-alert" role="status">Показаны первые 300 записей. Для уточнения расписания обратитесь к администратору.</p>}
    <p className="schedule-footnote"><Icon name="clock" size={16} /> Время занятий — московское (Europe/Moscow). Числитель и знаменатель определяются учебным календарём. Данные учебного примера вымышлены.</p>
  </section>;
}
