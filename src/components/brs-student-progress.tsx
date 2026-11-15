"use client";
import { useState } from "react";
import type { BrsWorkspace } from "@/lib/brs-repository";
import { attendanceLabels, controlLabels, eventLabels, points } from "@/lib/brs-rules";
import { minuteLabel } from "@/lib/schedule-calendar";
import { pairTimeLabel } from "@/lib/schedule-bells";

type Course = BrsWorkspace["overview"][number];
type Props = { model: BrsWorkspace; mode: "auto" | "full" | "compact"; busy: boolean;
  openEvent: (planId: string, eventId: string) => Promise<void>;
  openModule: (planId: string, moduleId: string) => Promise<void>;
  openAttendance: (planId: string, occurrenceId: string) => Promise<void> };
const day = (value: string | null | undefined) => value ? value.slice(0, 10).split("-").reverse().join(".") : "—";
export function AttendanceLegend() {
  return <p className="brs-attendance-legend">✓ — присутствовал · ✓✓ — присутствовал и работал на семинаре (полный балл) · Б — болезнь · Н — отсутствовал · У — уважительная причина · пусто — не отмечено. Остальные отметки дают 0 за работу; пустая отметка оставляет результат неизвестным.</p>;
}
export function StudentOverview({ model, mode, busy, openEvent, openModule, openAttendance }: Props) {
  const plan = model.selected!;
  const [hover, setHover] = useState<string | null>(null), [focus, setFocus] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null);
  const active = hover ?? focus ?? selected;
  const currentWeek = plan.weeks.find(week => plan.today >= week.start && plan.today <= week.end)?.number;
  const summaries = [...new Map(model.overview.flatMap(course => course.modules.map(brsModule => {
    const week = brsModule.events.find(event => event.kind === "FINAL")?.week ?? brsModule.endWeek;
    return [`m:${brsModule.number}:${week}`, { key: `m:${brsModule.number}:${week}`, week, number: brsModule.number }];
  }))).values()];
  const columns = plan.weeks.flatMap(week => [{ key: `w:${week.number}`, week: week.number, number: 0 }, ...summaries.filter(item => item.week === week.number)]);
  function attrs(key: string) { return { className: [active === key ? "brs-column-active" : "", key === `w:${currentWeek}` ? "brs-current" : ""].filter(Boolean).join(" ") || undefined, onMouseEnter: () => setHover(key), onFocus: () => setFocus(key), onBlur: () => setFocus(null), onClick: () => setSelected(key) }; }
  function eventCell(course: Course, event: Course["modules"][number]["events"][number]) {
    return <button disabled={busy} className="brs-cell" aria-label={`${plan.students[0]?.name}, ${event.title}, ${points(event.score)} из ${points(event.maxScore)}, ${course.title}`} onClick={() => openEvent(course.id, event.id)}>{points(event.score)} / {points(event.maxScore)}</button>;
  }
  function moduleCell(course: Course, id: string, number: number) {
    const result = course.calculation.modules.find(item => item.id === id)!;
    return <button disabled={busy} className="brs-cell" aria-label={`${course.title}, итог модуля ${number}`} onClick={() => openModule(course.id, id)}>{points(result.score)} / {points(result.max)}</button>;
  }
  return <>
    <div className={`panel brs-scroll brs-full brs-mode-${mode}`} onMouseLeave={() => setHover(null)}>
      <table className="brs-table brs-student-full"><thead><tr><th className="brs-sticky">Дисциплина</th>{columns.map(column => <th key={column.key} {...attrs(column.key)} data-module-total={column.number || undefined}>{column.number ? `М${column.number}` : `Неделя ${column.week}`}</th>)}<th>Рейтинг /100</th><th>Утверждено</th></tr></thead>
        <tbody>{model.overview.map(course => <tr key={course.id}><th className="brs-sticky">{course.title}<small>{controlLabels[course.control]}</small></th>{columns.map(column => {
          const brsModule = column.number ? course.modules.find(item => item.number === column.number && (item.events.find(event => event.kind === "FINAL")?.week ?? item.endWeek) === column.week) : null;
          return <td key={column.key} {...attrs(column.key)} data-module-total={column.number || undefined}>{brsModule ? moduleCell(course, brsModule.id, brsModule.number) : !column.number && course.modules.flatMap(item => item.events.filter(event => event.week === column.week && !["SEMINAR", "LAB"].includes(event.kind)).map(event => <div className="brs-week-event" key={event.id}><span>{eventLabels[event.kind]}</span>{eventCell(course, event)}<small>{event.status}</small></div>))}</td>;
        })}<td>{points(course.calculation.total)}<small>Семестр: {points(course.calculation.semesterScore)} / {points(course.calculation.semesterMax)}</small><small>Прогноз: {course.calculation.provisionalGrade}</small></td><td>{course.official ? `${course.official.grade}${course.official.needsReview ? " · Требуется пересмотр" : ""}` : "Не утверждён"}</td></tr>)}</tbody>
      </table>
    </div>
    <div className={`brs-compact brs-mode-${mode}`}>{model.overview.map(course => <details open className="panel brs-panel" key={course.id}><summary>{course.title} · {controlLabels[course.control]} · {points(course.calculation.total)} /100</summary><div className="brs-scroll"><table className="brs-table"><thead><tr><th>Нед.</th><th>Мероприятие</th><th>Макс.</th><th>Набрано</th><th>Срок / результат</th></tr></thead><tbody>{course.modules.flatMap(brsModule => {
      const result = course.calculation.modules.find(item => item.id === brsModule.id)!;
      return [...brsModule.events.filter(event => !["SEMINAR", "LAB"].includes(event.kind)).map(event => <tr key={event.id}><td>{event.week}</td><td>{event.title}</td><td>{points(event.maxScore)}</td><td>{eventCell(course, event)}</td><td>{event.status}</td></tr>), <tr key={brsModule.id + ":seminars"}><td>—</td><th>Работа на семинарах</th><td>—</td><td>{points(result.seminarScore)}</td><td>{result.seminarMissing ? "Есть неотмеченные занятия" : "По посещаемости"}</td></tr>, <tr className="brs-module-total" key={brsModule.id}><td>—</td><th>Модуль {brsModule.number}</th><td>{points(result.max)}</td><td>{moduleCell(course, brsModule.id, brsModule.number)}</td><td>{result.debts.length ? `Незавершённых работ: ${result.debts.length}` : "Обязательные работы выполнены"}</td></tr>];
    })}</tbody></table></div><p>Семестр: {points(course.calculation.semesterScore)} / {points(course.calculation.semesterMax)} · Прогноз: {course.calculation.provisionalGrade} · Утверждено: {course.official?.grade ?? "Не утверждён"}{course.official?.needsReview && " · Требуется пересмотр"}</p></details>)}</div>
    {model.overview.map(course => <div className="brs-course-details" key={course.id}>
      <details className="panel brs-panel"><summary>Посещаемость · {course.title}</summary><AttendanceLegend /><div className="brs-scroll"><table className="brs-table brs-own-attendance"><thead><tr>{course.occurrences.map(occurrence => <th key={occurrence.id}>Неделя {plan.weeks.find(week => occurrence.actualDate >= week.start && occurrence.actualDate <= week.end)?.number ?? "—"}<br />{day(occurrence.actualDate)}<br />{pairTimeLabel(minuteLabel(occurrence.actualStart), minuteLabel(occurrence.actualEnd))}{occurrence.cancelled && <small>Отменено / недоступно</small>}</th>)}</tr></thead><tbody><tr>{course.occurrences.map(occurrence => {
        const mark = course.attendance.find(item => item.occurrenceId === occurrence.id)?.mark;
        return <td key={occurrence.id}><button className="brs-cell" aria-label={`Посещаемость, ${course.title}, ${day(occurrence.actualDate)}, ${minuteLabel(occurrence.actualStart)}`} onClick={() => openAttendance(course.id, occurrence.id)}>{attendanceLabels[mark as keyof typeof attendanceLabels] ?? "—"}</button></td>;
      })}</tr></tbody></table></div></details>
      {course.modules.some(item => item.events.some(event => event.kind === "LAB")) && <details className="panel brs-panel"><summary>Лабораторные работы · {course.title}</summary><div className="brs-scroll"><table className="brs-table brs-student-labs"><thead><tr><th>№</th><th>Название</th><th>Баллы БРС / максимум</th><th>Статус</th><th>Защита</th><th>Комментарий</th></tr></thead><tbody>{course.modules.flatMap(item => item.events.filter(event => event.kind === "LAB").map(event => <tr key={event.id}><td>{event.number}</td><th>{event.title}</th><td>{eventCell(course, event)}</td><td>{event.status}</td><td>{day(event.result?.defendedOn as string | null)}</td><td>{event.comment ? `Комментарий: ${event.comment}` : "Комментарий отсутствует"}</td></tr>))}</tbody></table></div></details>}
    </div>)}
  </>;
}
