"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { BrsWorkspace } from "@/lib/brs-repository";
import { attendanceLabels, controlLabels, points, workTitle, resultPoints } from "@/lib/brs-rules";
import { minuteLabel } from "@/lib/schedule-calendar";
import { pairTimeLabel } from "@/lib/schedule-bells";
import { academicLabels, academicSymbols, moduleAppearance, semesterAppearance, shortSubmission } from "./brs-student-presentation";

type Course = BrsWorkspace["overview"][number];
type Work = Course["modules"][number]["events"][number];
type Props = { model: BrsWorkspace; mode: "auto" | "full" | "compact"; busy: boolean; openEvent: (planId: string, eventId: string) => Promise<void> };
type Hint = { mark: string | null; context: string; opener: HTMLButtonElement };
const day = (value: string | null | undefined) => value ? value.slice(0, 10).split("-").reverse().join(".") : "—";
const markDescriptions: Record<string, string> = { PRESENT: "Присутствовал", ACTIVE: "Присутствовал и работал на семинаре", SICK: "Болезнь", ABSENT: "Отсутствовал", EXCUSED: "Уважительная причина" };
export function AttendanceLegend() {
  return <p className="brs-attendance-legend">✓ — присутствовал · ✓✓ — присутствовал и работал на семинаре (полный балл) · Б — болезнь · Н — отсутствовал · У — уважительная причина · пусто — не отмечено. Остальные отметки дают 0 за работу; пустая отметка оставляет результат неизвестным.</p>;
}
function AttendanceHint({ hint, close }: { hint: Hint; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    element.showPopover();
    const place = () => { const anchor = hint.opener.getBoundingClientRect(); element.style.left = Math.max(8, Math.min(anchor.left, innerWidth - element.offsetWidth - 8)) + "px"; element.style.top = Math.max(8, Math.min(anchor.bottom + 6, innerHeight - element.offsetHeight - 8)) + "px"; };
    place(); window.addEventListener("resize", place);
    return () => { window.removeEventListener("resize", place); element.hidePopover(); };
  }, [hint]);
  return <div ref={ref} popover="auto" role="dialog" aria-label="Отметка занятия" className="brs-student-attendance-hint" onToggle={event => { if ((event.nativeEvent as ToggleEvent).newState === "closed") close(); }}><button type="button" aria-label="Закрыть подсказку" onClick={() => { close(); hint.opener.focus({ preventScroll: true }); }}>×</button><strong>{hint.mark ? `${attendanceLabels[hint.mark as keyof typeof attendanceLabels]} — ${markDescriptions[hint.mark]}` : "Посещаемость не отмечена"}</strong><small>{hint.context}</small></div>;
}
export function StudentOverview({ model, mode, busy, openEvent }: Props) {
  const plan = model.selected!, groupId = useId();
  const [hover, setHover] = useState<number | null>(null), [hint, setHint] = useState<Hint | null>(null);
  const currentWeek = plan.weeks.find(week => plan.today >= week.start && plan.today <= week.end)?.number;
  const labs = model.overview.filter(course => course.modules.some(module => module.events.some(event => event.kind === "LAB")));
  function attrs(week: number) { return { className: [hover === week ? "brs-column-active" : "", week === currentWeek ? "brs-current" : ""].filter(Boolean).join(" ") || undefined, onPointerEnter: (event: React.PointerEvent) => { if (event.pointerType === "mouse") setHover(week); } }; }
  function showWork(course: Course, event: Work) { setHover(null); setHint(null); void openEvent(course.id, event.id); }
  function moduleBadge(course: Course, event: Work) {
    const brsModule = course.modules.find(item => item.events.some(item => item.id === event.id))!;
    const result = course.calculation.modules.find(item => item.id === brsModule.id)!;
    const state = moduleAppearance(course, brsModule.id);
    return <span className={`brs-module-summary brs-academic-${state}`} data-academic={state} title={academicLabels[state]} aria-label={`М${brsModule.number}: ${points(result.score)} из ${points(result.max)}. ${academicLabels[state]}`}>М{brsModule.number}: {points(result.score)}/{points(result.max)} <span aria-hidden="true">{academicSymbols[state]}</span></span>;
  }
  function score(course: Course, event: Work) { return <>{event.kind === "FINAL" ? "РК: " : ""}{resultPoints(event.result, event.maxScore)}/{points(event.maxScore)}{event.kind === "FINAL" && moduleBadge(course, event)}</>; }
  function workName(course: Course, event: Work) { return `${workTitle(event)}, ${resultPoints(event.result, event.maxScore)} из ${points(event.maxScore)}, ${course.title}`; }
  function eventCell(course: Course, event: Work) { const status = shortSubmission(event); return <button disabled={busy} className="brs-cell brs-progress-cell" aria-label={workName(course, event)} onClick={() => showWork(course, event)}><span><strong>{workTitle(event)}</strong> <span>{score(course, event)}</span></span>{status && <small>{status}</small>}</button>; }
  function semester(course: Course) { const state = semesterAppearance(course); return <span className={`brs-semester-summary brs-academic-${state}`} data-academic={state}>Семестр: {points(course.calculation.semesterScore)}/{points(course.calculation.semesterMax)}<small>{state === "complete" ? "Завершён" : state === "failed" ? "Есть долги" : "В процессе"}</small></span>; }
  function heading(course: Course) { return <h3 className="brs-course-heading"><span>{course.title}</span><small>{controlLabels[course.control]}</small></h3>; }
  return <div className="brs-student-progress" onPointerDown={() => setHover(null)}>
    <div className={`panel brs-scroll brs-full brs-mode-${mode}`} onPointerLeave={() => setHover(null)}>
      <table className="brs-table brs-student-full"><thead><tr><th className="brs-sticky" scope="col">Дисциплина</th>{plan.weeks.map(week => <th key={week.number} scope="col" {...attrs(week.number)}>Неделя {week.number}</th>)}<th scope="col">Рейтинг /100</th><th scope="col">Утверждено</th></tr></thead>
        <tbody>{model.overview.map(course => <tr key={course.id}><th scope="row" className="brs-sticky">{heading(course)}</th>{plan.weeks.map(week => <td key={week.number} {...attrs(week.number)}>{course.modules.flatMap(item => item.events.filter(event => event.week === week.number && !["SEMINAR", "LAB"].includes(event.kind))).sort((a,b) => (a.plannedOn ?? "").localeCompare(b.plannedOn ?? "") || a.number - b.number).map(event => <div className="brs-week-event" key={event.id}>{eventCell(course, event)}</div>)}</td>)}<td>{points(course.calculation.total)}{semester(course)}<small>Прогноз: {course.calculation.provisionalGrade}</small></td><td>{course.official ? `${course.official.grade}${course.official.needsReview ? " · Требуется пересмотр" : ""}` : "Не утверждён"}</td></tr>)}</tbody>
      </table>
    </div>
    <div className={`brs-compact brs-mode-${mode}`}>{model.overview.map(course => {
      const events = course.modules.flatMap(module => module.events.filter(event => !["SEMINAR", "LAB"].includes(event.kind))).sort((a,b) => a.week - b.week || (a.plannedOn ?? "").localeCompare(b.plannedOn ?? "") || a.number - b.number);
      const seminarScore = course.calculation.modules.reduce((sum, module) => sum + module.seminarScore, 0);
      const seminarMax = course.modules.flatMap(module => module.events).filter(event => event.kind === "SEMINAR").reduce((sum,event) => sum + event.maxScore, 0);
      return <details open className="panel brs-panel brs-course-list-section" key={course.id}><summary>{heading(course)}</summary><table className="brs-table brs-course-list"><thead><tr><th scope="col">Неделя</th><th scope="col">Работа</th><th scope="col">Результат</th></tr></thead><tbody>{events.map(event => { const status = shortSubmission(event); return <tr key={event.id} data-work={event.id} onClick={click => { if (!busy) { click.currentTarget.querySelector("button")?.focus({ preventScroll: true }); showWork(course,event); } }}><td>{event.week}</td><th scope="row"><button className="brs-list-open" disabled={busy} aria-label={workName(course,event)}>{workTitle(event)}</button></th><td>{score(course,event)}{status && <small>{status}</small>}</td></tr>; })}<tr className="brs-seminar-summary"><td /><th scope="row">Работа на семинарах</th><td>{points(seminarScore)}/{points(seminarMax)}{course.calculation.modules.some(module => module.seminarMissing) && <small>Есть неотмеченные занятия</small>}</td></tr></tbody></table><div className="brs-course-outcome">{semester(course)}<span>Прогноз: {course.calculation.provisionalGrade} · Утверждено: {course.official?.grade ?? "Не утверждён"}{course.official?.needsReview && " · Требуется пересмотр"}</span></div></details>;
    })}</div>
    <section className="brs-student-group" aria-labelledby={groupId + "-attendance"}><h2 id={groupId + "-attendance"}>Посещаемость</h2>{model.overview.map(course => <details className="panel brs-panel brs-course-attendance" key={course.id}><summary>{heading(course)}</summary><AttendanceLegend /><div className="brs-scroll"><table className="brs-table brs-own-attendance"><thead><tr>{course.occurrences.map(occurrence => <th key={occurrence.id}>Неделя {plan.weeks.find(week => occurrence.actualDate >= week.start && occurrence.actualDate <= week.end)?.number ?? "—"}<br />{day(occurrence.actualDate)}<br />{pairTimeLabel(minuteLabel(occurrence.actualStart), minuteLabel(occurrence.actualEnd))}{occurrence.cancelled && <small>Отменено / недоступно</small>}</th>)}</tr></thead><tbody><tr>{course.occurrences.map(occurrence => { const mark = course.attendance.find(item => item.occurrenceId === occurrence.id)?.mark; return <td key={occurrence.id}><button className="brs-cell" aria-haspopup="dialog" aria-label={`${mark ? "Посещаемость" : "Посещаемость не отмечена"}, ${course.title}, ${day(occurrence.actualDate)}, ${minuteLabel(occurrence.actualStart)}`} onClick={event => { setHover(null); setHint({ mark: mark ?? null, context: `${day(occurrence.actualDate)} · ${pairTimeLabel(minuteLabel(occurrence.actualStart), minuteLabel(occurrence.actualEnd))}`, opener: event.currentTarget }); }}>{attendanceLabels[mark as keyof typeof attendanceLabels] ?? ""}</button></td>; })}</tr></tbody></table></div></details>)}</section>
    {!!labs.length && <section className="brs-student-group" aria-labelledby={groupId + "-labs"}><h2 id={groupId + "-labs"}>Лабораторные работы</h2>{labs.map(course => <details className="panel brs-panel brs-course-labs" key={course.id}><summary>{heading(course)}</summary><div className="brs-scroll"><table className="brs-table brs-student-labs"><thead><tr><th>№</th><th>Название</th><th>Баллы БРС / максимум</th><th>Статус</th><th>Защита</th><th>Комментарий</th></tr></thead><tbody>{course.modules.flatMap(item => item.events.filter(event => event.kind === "LAB").map(event => <tr key={event.id}><td>{event.number}</td><th>{workTitle(event)}</th><td>{eventCell(course, event)}</td><td>{event.status}</td><td>{day(event.result?.defendedOn as string | null)}</td><td>{event.comment ? `Комментарий: ${event.comment}` : "Комментарий отсутствует"}</td></tr>))}</tbody></table></div></details>)}</section>}
    {hint && <AttendanceHint hint={hint} close={() => setHint(null)} />}
  </div>;
}
