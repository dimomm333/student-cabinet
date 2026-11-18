"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { ScheduleEditorModel } from "@/lib/schedule-editor-repository";
import { DAY_MS, WEEK_MS, dayNames, isoDate, shortDayNames, weekRangeLabel } from "@/lib/schedule-calendar";
import { saveSchedule } from "@/app/deanery/schedule/actions";
import { ScheduleWeekPicker } from "./schedule-week-picker";
import { ScheduleDatePicker } from "./schedule-date-picker";
import { LessonCard } from "./schedule-view";

import { ScheduleTimeFields } from "./schedule-time-fields";
import { pairTimeLabel } from "@/lib/schedule-bells";

type Choice = { id: string; name: string };
function SearchSelect({ label, name, options, initial = "" }: { label: string; name: string; options: Choice[]; initial?: string }) {
  const id = useId(); const [search, setSearch] = useState(""); const [value, setValue] = useState(initial || options[0]?.id || "");
  return <div className="editor-field"><label htmlFor={`${id}-search`}>Поиск: {label.toLocaleLowerCase("ru-RU")}</label><input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Введите часть названия" />
    <label htmlFor={id}>{label}</label><select id={id} name={name} value={value} onChange={event => setValue(event.target.value)} required><option value="" disabled>Выберите</option>{options.filter(option => option.id === value || option.name.toLocaleLowerCase("ru-RU").includes(search.trim().toLocaleLowerCase("ru-RU"))).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div>;
}
function SearchChecks({ label, name, options, initial }: { label: string; name: string; options: Choice[]; initial: string[] }) {
  const id = useId(); const [search, setSearch] = useState(""); const [selected, setSelected] = useState(initial);
  return <fieldset className="editor-checks"><legend>{label}</legend><label htmlFor={id}>Поиск: {label.toLocaleLowerCase("ru-RU")}</label><input id={id} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Введите часть названия" />
    <div>{options.filter(option => selected.includes(option.id) || option.name.toLocaleLowerCase("ru-RU").includes(search.trim().toLocaleLowerCase("ru-RU"))).map(option => <label key={option.id}><input type="checkbox" name={name} value={option.id} checked={selected.includes(option.id)} onChange={event => setSelected(event.target.checked ? [...selected, option.id] : selected.filter(value => value !== option.id))} />{option.name}</label>)}</div></fieldset>;
}
type Target = { mode: "CREATE" | "UPDATE" | "DELETE" | "REPLACE" | "CANCEL" | "EXTRA" | "RESTORE"; entryId?: string | null; exceptionId?: string | null; sourceDate?: string };
const titles = { CREATE: "Добавить регулярную пару", UPDATE: "Изменить регулярную пару", DELETE: "Удалить регулярную пару", REPLACE: "Создать разовую замену", CANCEL: "Отменить занятие на дату", EXTRA: "Добавить разовую пару", RESTORE: "Отменить разовое изменение" };
const statuses: Record<string, string> = { CREATE: "Создана регулярная пара", UPDATE: "Изменена регулярная пара", DELETE: "Удалена регулярная пара", REPLACE: "Разовая замена", CANCEL: "Отмена на дату", EXTRA: "Дополнительная пара", RESTORE: "Разовое изменение отменено" };
function auditText(json: string | null) {
  if (!json) return "—";
  try {
    const value = JSON.parse(json); const row = value.entry ?? value;
    const time = (number: number) => `${String(Math.floor(number / 60)).padStart(2, "0")}:${String(number % 60).padStart(2, "0")}`;
    const patterns: Record<string, string> = { EVERY: "Каждую неделю", NUMERATOR: "Числитель", DENOMINATOR: "Знаменатель" };
    const kinds: Record<string, string> = { LECTURE: "Лекция", PRACTICE: "Практика", SEMINAR: "Семинар", LAB: "Лабораторная" };
    return `${row.lesson.discipline.title}; ${kinds[row.lesson.kind]}; ${row.date ? new Date(row.date).toLocaleDateString("ru-RU", { timeZone: "UTC" }) : dayNames[row.dayOfWeek - 1]}; ${time(row.startMinute)}–${time(row.endMinute)}; ${row.room.building.name}, ауд. ${row.room.number}; ${row.lesson.teachers.map((item: { teacher: { publicName: string | null; user: { name: string } } }) => item.teacher.publicName ?? item.teacher.user.name).join(", ")}; группы: ${row.lesson.groups.map((item: { group: { code: string } }) => item.group.code).join(", ")}; ${row.term.name}; ${patterns[row.weekPattern] ?? "Разово"}; ${row.isPublished ? "Опубликовано" : "Черновик"}${row.isCancelled ? "; отменено" : ""}${row.isDeleted || row.isActive === false ? "; запись отключена" : ""}`;
  } catch { return "Данные сохранены в журнале"; }
}
export function ScheduleEditor({ model }: { model: ScheduleEditorModel }) {
  const [target, setTarget] = useState<Target | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (target && !dialog.current?.open) dialog.current?.showModal(); }, [target]);
  const query = { view: "group" as const, selected: model.selected, week: model.week, day: model.day, term: model.termCode };
  const href = (week: string) => `/deanery/schedule?group=${encodeURIComponent(model.selected)}&week=${week}`;
  const choose = (next: Target) => { opener.current = document.activeElement as HTMLElement; setTarget(next); };
  const close = () => { dialog.current?.close(); setTarget(null); (opener.current?.isConnected ? opener.current : heading.current)?.focus({ preventScroll: true }); };
  return <>
    <div className="dashboard-title"><div><span className="eyebrow">Деканат</span><h1 ref={heading} tabIndex={-1}>Расписание</h1><p>Регулярные занятия и изменения на конкретную дату. Время московское.</p></div></div>
    <form action="/deanery/schedule" className="panel profile-panel editor-group-picker"><SearchSelect label="Учебная группа" name="group" initial={model.selected} options={model.groups.map(group => ({ id: group.slug, name: group.code }))} /><input type="hidden" name="week" value={model.week} /><button className="button button-primary" disabled={!model.groups.length}>Показать расписание</button></form>
    <div className="schedule-week-toolbar"><div className="schedule-week-links"><Link scroll={false} href={href(isoDate(new Date(new Date(model.week).getTime() - WEEK_MS)))} aria-label="Предыдущая неделя">←</Link><strong>{weekRangeLabel(model.week, isoDate(new Date(new Date(model.week).getTime() + 6 * DAY_MS)))}</strong><Link scroll={false} href={href(isoDate(new Date(new Date(model.week).getTime() + WEEK_MS)))} aria-label="Следующая неделя">→</Link></div><ScheduleWeekPicker path="/deanery/schedule" query={query} terms={model.terms} /></div>
    {!model.groups.length ? <p className="panel profile-panel">Нет назначенных учебных групп. Обратитесь к ответственному за назначения.</p> : <>
      <div className="editor-actions"><button className="button button-primary" onClick={() => choose({ mode: "CREATE" })}>Добавить регулярную пару</button><button className="button button-outline" onClick={() => choose({ mode: "EXTRA" })}>Добавить разовую пару</button></div>
      <p className="profile-note">Выберите занятие для редактирования. Разовое изменение действует только на указанную дату. Неопубликованные пары видны в редакторе как черновики.</p>
      <div className="schedule-day-grid editor-week">{dayNames.map((day, index) => {
        const current = isoDate(new Date(new Date(model.week).getTime() + index * DAY_MS));
        const rows = model.occurrences.filter(pair => pair.lesson.date === current);
        return <section key={day} className="schedule-day-card panel"><header><h2>{shortDayNames[index]} · {current.split("-").reverse().join(".")}</h2></header>{rows.length ? rows.map(pair => <div key={pair.lesson.key} className="editor-pair"><button className="editor-card-button" disabled={!pair.editable} aria-label={`Открыть занятие ${pair.lesson.discipline}, ${pair.lesson.start}`} onClick={() => choose({ mode: !pair.entryId ? "EXTRA" : pair.exceptionId ? "REPLACE" : "UPDATE", entryId: pair.entryId, exceptionId: pair.exceptionId, sourceDate: pair.sourceDate })}><LessonCard lesson={pair.lesson} /></button>{pair.editable ? <div className="editor-pair-actions">
          {pair.entryId && <button onClick={() => choose({ mode: "UPDATE", entryId: pair.entryId, sourceDate: pair.sourceDate })}>Изменить регулярную пару</button>}
          {pair.entryId && <button onClick={() => choose({ mode: "REPLACE", entryId: pair.entryId, exceptionId: pair.exceptionId, sourceDate: pair.sourceDate })}>Создать разовую замену</button>}
          {pair.entryId && !pair.lesson.change?.cancelled && <button onClick={() => choose({ mode: "CANCEL", entryId: pair.entryId, exceptionId: pair.exceptionId, sourceDate: pair.sourceDate })}>Отменить занятие на дату</button>}
          {pair.exceptionId && <button onClick={() => choose({ mode: "RESTORE", entryId: pair.entryId, exceptionId: pair.exceptionId, sourceDate: pair.sourceDate })}>{pair.entryId ? "Восстановить исходное занятие" : "Удалить разовую пару"}</button>}
        </div> : <p>Общее занятие. Изменение требует полномочий на все группы.</p>}</div>) : <p className="schedule-preview-empty">Занятий нет</p>}</section>;
      })}</div>
      <details className="panel profile-panel"><summary>Все регулярные пары выбранной группы</summary>{model.entries.map(item => <div key={item.id} className="editor-template"><span>{item.title} · {dayNames[item.dayOfWeek - 1]} · {pairTimeLabel(item.start, item.end)}{!item.isPublished ? " · Черновик" : ""}</span><button disabled={!item.editable} onClick={() => choose({ mode: "UPDATE", entryId: item.id })}>Изменить</button><button disabled={!item.editable} onClick={() => choose({ mode: "DELETE", entryId: item.id })}>Удалить</button></div>)}</details>
    </>}
    <details className="panel profile-panel editor-audit"><summary>Все разовые изменения выбранной группы</summary>{model.exceptions.slice(0, 200).map(item => <div key={item.id} className="editor-template"><span>{model.disciplines.find(discipline => discipline.id === item.disciplineId)?.title} · {item.sourceDate.split("-").reverse().join(".")} → {item.date.split("-").reverse().join(".")} · {pairTimeLabel(item.start, item.end)}{item.cancelled ? " · Отменено" : ""}</span><button disabled={!item.editable} onClick={() => choose({ mode: item.entryId ? "REPLACE" : "EXTRA", entryId: item.entryId, exceptionId: item.id, sourceDate: item.sourceDate })}>Изменить разовое занятие</button><button disabled={!item.editable} onClick={() => choose({ mode: "RESTORE", entryId: item.entryId, exceptionId: item.id, sourceDate: item.sourceDate })}>{item.entryId ? "Восстановить исходное занятие" : "Удалить разовую пару"}</button></div>)}{!model.exceptions.length && <p>Разовых изменений пока нет.</p>}{model.exceptions.length > 200 && <p>Показаны первые 200 изменений. Остальные доступны в расписании соответствующей недели.</p>}</details>
    {target && <dialog ref={dialog} className="editor-dialog" aria-label="Редактор занятия" onCancel={event => { event.preventDefault(); close(); }}><EditorForm key={`${target.mode}:${target.entryId}:${target.exceptionId}:${target.sourceDate}`} model={model} target={target} onClose={close} /></dialog>}
    <details className="panel profile-panel editor-audit"><summary>Журнал изменений расписания</summary>{model.audits.length ? model.audits.map(audit => <article key={audit.id}><h3>{statuses[audit.action] ?? "Изменение расписания"}</h3><p>{audit.actor.name} · {new Date(audit.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</p><p><strong>До:</strong> {auditText(audit.beforeJson)}</p><p><strong>После:</strong> {auditText(audit.afterJson)}</p></article>) : <p>Изменений пока нет.</p>}</details>
  </>;
}

function EditorForm({ model, target, onClose }: { model: ScheduleEditorModel; target: Target; onClose: () => void }) {
  const [state, action, pending] = useActionState(saveSchedule, { success: false, message: "" });
  useEffect(() => { if (state.success) window.dispatchEvent(new Event("notifications-updated")); }, [state]);
  const entry = model.entries.find(item => item.id === target.entryId);
  const exception = model.exceptions.find(item => item.id === target.exceptionId);
  const values = exception ?? entry;
  const date = exception?.date ?? target.sourceDate ?? model.week;
  const confirmOnly = ["DELETE", "CANCEL", "RESTORE"].includes(target.mode);
  return <section className="profile-panel editor-form-panel"><h2>{titles[target.mode]}</h2><p>{target.mode === "UPDATE" || target.mode === "DELETE" ? "Это изменение затронет регулярное расписание всех недель учебного периода." : "Это действие относится только к конкретной дате."}</p>
      {state.message && !pending && <p role={state.success ? "status" : "alert"} className={state.success ? "editor-success" : "schedule-alert"}>{state.message}</p>}
      <form action={action} onReset={event => event.preventDefault()} key={`${target.mode}:${target.entryId}:${target.exceptionId}:${target.sourceDate}:${entry?.version}:${exception?.version}`}>
        <input type="hidden" name="operation" value={target.mode} /><input type="hidden" name="entryId" value={target.entryId ?? ""} /><input type="hidden" name="exceptionId" value={target.exceptionId ?? ""} /><input type="hidden" name="sourceDate" value={target.sourceDate ?? exception?.sourceDate ?? ""} /><input type="hidden" name="version" value={entry?.version ?? exception?.version ?? ""} />
        {confirmOnly ? <div className="schedule-alert"><p>{target.mode === "DELETE" ? "Регулярная пара и её разовые изменения перестанут отображаться. Остальные занятия сохранятся." : target.mode === "RESTORE" ? "Разовое изменение будет отменено. Исходная пара вернётся, если не возникнет конфликтов." : `Занятие ${target.sourceDate?.split("-").reverse().join(".")} будет отменено. Остальные недели сохранятся.`}</p><label><input type="checkbox" required name="confirm" /> Подтверждаю действие</label></div> : <div className="editor-form-grid">
          <SearchChecks label="Учебные группы и подгруппы" name="groupIds" options={model.groups.map(group => ({ id: group.id, name: group.code }))} initial={values?.groupIds ?? [model.selectedId]} />
          <SearchChecks label="Преподаватели" name="teacherIds" options={model.teachers.map(teacher => ({ id: teacher.id, name: teacher.name + (teacher.public ? "" : " · не опубликован") }))} initial={values?.teacherIds ?? []} />
          <SearchSelect label="Дисциплина" name="disciplineId" options={model.disciplines.map(item => ({ id: item.id, name: item.title }))} initial={values?.disciplineId} />
          <SearchSelect label="Корпус и аудитория" name="roomId" options={model.rooms.map(item => ({ id: item.id, name: item.name + (item.public ? "" : " · не опубликована") }))} initial={values?.roomId} />
          <SearchSelect label="Учебный период" name="termId" options={model.terms.map(item => ({ id: item.id, name: `${item.name} (${item.startsOn} — ${item.endsOn})${item.published ? "" : " · не опубликован"}` }))} initial={values?.termId} />
          <div className="editor-field"><label htmlFor="editor-kind">Тип занятия</label><select id="editor-kind" name="kind" defaultValue={values?.kind ?? "LECTURE"}><option value="LECTURE">Лекция</option><option value="PRACTICE">Практика</option><option value="SEMINAR">Семинар</option><option value="LAB">Лабораторная</option></select></div>
          {target.mode === "CREATE" || target.mode === "UPDATE" ? <><div className="editor-field"><label htmlFor="editor-weekday">День недели</label><select id="editor-weekday" name="dayOfWeek" defaultValue={values?.dayOfWeek ?? 1}>{dayNames.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></div><div className="editor-field"><label htmlFor="editor-pattern">Повторение</label><select id="editor-pattern" name="weekPattern" defaultValue={values?.weekPattern ?? "EVERY"}><option value="EVERY">Каждую неделю</option><option value="NUMERATOR">Числитель</option><option value="DENOMINATOR">Знаменатель</option></select></div></> : <ScheduleDatePicker selected={date} name="date" label="Дата разового занятия" onSelect={() => {}} />}
          <ScheduleTimeFields start={values?.start} end={values?.end} />
          <label className="editor-publish"><input type="checkbox" name="isPublished" defaultChecked={values?.isPublished ?? true} /> Опубликовать занятие</label><p>В открытом расписании показываются только опубликованные занятия с публичными группами, преподавателями, аудиторией и периодом.</p>
        </div>}
        <div className="editor-actions"><button className="button button-primary" disabled={pending}>{pending ? "Сохраняем…" : confirmOnly ? "Подтвердить" : "Сохранить занятие"}</button><button className="button button-outline" type="button" disabled={pending} onClick={onClose}>Закрыть форму</button></div>
      </form>
    </section>;
}
