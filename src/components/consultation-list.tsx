"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ConsultationRow } from "@/lib/consultations-repository";
import { minuteLabel, searchKey } from "@/lib/schedule-calendar";
import { Icon } from "./icon";
import { SectionTabs } from "./section-navigation";
import "./consultations.css";

const calendarDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const calendarWeekday = new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "UTC" });
const periods = [{ id: "upcoming", label: "Ближайшие" }, { id: "past", label: "Прошедшие" }];

export type ConsultationClock = { today: string; minute: number };

export function isUpcomingConsultation(row: ConsultationRow, { today, minute }: ConsultationClock) {
  return row.date > today || row.date === today && row.endMinute > minute;
}

export function ConsultationHeading({ description }: { description: string }) {
  return <header className="dashboard-title consultations-title">
    <div className="flex min-w-0 items-start gap-3">
      <span className="icon-tile consultations-title-icon"><Icon name="calendar" size={24} /></span>
      <div><h1>Консультации</h1><p>{description}</p></div>
    </div>
    <span className="consultations-timezone"><Icon name="clock" size={16} /> Московское время</span>
  </header>;
}

export function ConsultationPeriods({ active, onSelect, all, dated, children }: {
  active: string; onSelect: (id: string) => void; all?: boolean; dated?: boolean; children: ReactNode;
}) {
  const items = [
    ...(all ? [{ id: "all", label: "Все" }] : []),
    ...periods,
    ...(dated ? [{ id: "date", label: "На выбранную дату" }] : []),
  ];
  return <section className="grid min-w-0 gap-3" aria-label="Расписание консультаций">
    <SectionTabs label="Период консультаций" active={active} items={items} onSelect={onSelect}
      className="consultations-tabs">{children}</SectionTabs>
  </section>;
}

export function ConsultationEmpty({ reset, title, description }: { reset?: () => void; title?: string; description?: string }) {
  return <div className="panel consultations-empty">
    <span className="icon-tile"><Icon name={reset ? "search" : "calendar"} size={24} /></span>
    <div className="grid gap-1.5" role="status">
      <h2>{title ?? (reset ? "По вашему запросу ничего не найдено" : "Консультаций пока нет")}</h2>
      <p>{description ?? (reset ? "Измените условия поиска или сбросьте фильтры." : "Расписание появится после того, как деканат назначит консультации.")}</p>
    </div>
    {reset && <button type="button" className="button button-outline" onClick={reset}>Сбросить фильтры</button>}
  </div>;
}

export function ConsultationCard({ row, children }: { row: ConsultationRow; children?: ReactNode }) {
  const date = new Date(row.date + "T00:00:00Z");
  return <li className="panel consultations-card" data-cancelled={row.cancelled}>
    <div className="consultations-card-body">
      <div className="consultations-when">
        <time dateTime={row.date} className="consultations-date">
          <Icon name="calendar" size={17} /><span>{calendarDay.format(date)} {date.getUTCFullYear()}<small>{calendarWeekday.format(date)}</small></span>
        </time>
        <span className="consultations-time"><Icon name="clock" size={16} />{minuteLabel(row.startMinute)}–{minuteLabel(row.endMinute)}</span>
      </div>
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="grid min-w-0 gap-1">
            <h3 className="consultations-discipline">{row.discipline}</h3>
            <p className="consultations-teacher">{row.teacher}</p>
          </div>
          {row.cancelled && <span className="consultations-cancelled"><Icon name="close" size={13} />Отменена</span>}
        </div>
        <div className="consultations-metadata">
          <p className="flex min-w-0 items-center gap-2"><Icon name="pin" size={17} /><span>{row.building} · ауд. {row.room}</span></p>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-2"><Icon name="cap" size={17} />Группы</span>
            {row.groupCodes.map(code => <span key={code} className="consultations-group-code">{code}</span>)}
          </div>
        </div>
      </div>
    </div>
    {children && <div className="consultations-card-actions">{children}</div>}
  </li>;
}

function options(rows: ConsultationRow[], id: "teacherId" | "disciplineId", label: "teacher" | "discipline") {
  return [...new Map(rows.map(row => [row[id], row[label]])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
}

export function PersonalConsultationList({ rows, student, today, minute }: {
  rows: ConsultationRow[]; student: boolean;
} & ConsultationClock) {
  const [period, setPeriod] = useState("upcoming");
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [teacher, setTeacher] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [date, setDate] = useState("");
  const selected = rows.filter(row => (date ? row.date === date : isUpcomingConsultation(row, { today, minute }) === (period === "upcoming"))
    && (!teacher || row.teacherId === teacher) && (!discipline || row.disciplineId === discipline)
    && searchKey(`${row.teacher} ${row.discipline}`).includes(searchKey(query)));
  const visible = !date && period === "past" ? selected.toReversed() : selected;
  const filtered = Boolean(query || teacher || discipline || date);
  function reset() {
    setPeriod("upcoming");
    setQuery("");
    setTeacher("");
    setDiscipline("");
    setDate("");
    searchInput.current?.focus();
  }
  return <>
    {student && <section className="panel consultations-filters" aria-label="Фильтры консультаций">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="consultations-heading">Фильтры</h2>
        <button type="button" className="button button-outline consultations-reset" disabled={!filtered} onClick={reset}>Сбросить фильтры</button>
      </div>
      <div className="consultations-filter-grid">
        <label className="consultations-field">Поиск
          <span className="consultations-search">
            <Icon name="search" size={18} />
            <input ref={searchInput} type="search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="ФИО или дисциплина" />
          </span>
        </label>
        <label className="consultations-field">Преподаватель<select value={teacher} onChange={event => setTeacher(event.target.value)}>
          <option value="">Все преподаватели</option>
          {options(rows, "teacherId", "teacher").map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label className="consultations-field">Дисциплина<select value={discipline} onChange={event => setDiscipline(event.target.value)}>
          <option value="">Все дисциплины</option>
          {options(rows, "disciplineId", "discipline").map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select></label>
        <label className="consultations-field">Дата<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      </div>
    </section>}
    <ConsultationPeriods active={date ? "date" : period} dated={Boolean(date)} onSelect={id => {
      if (id === "date") return;
      setDate("");
      setPeriod(id);
    }}>
      {visible.length ? <ul className="consultations-list" aria-label="Консультации">{visible.map(row => <ConsultationCard row={row} key={row.id} />)}</ul>
        : <ConsultationEmpty reset={filtered ? reset : undefined}
          description={!filtered && rows.length ? "Выберите другой период, чтобы посмотреть расписание." : undefined} />}
    </ConsultationPeriods>
  </>;
}
