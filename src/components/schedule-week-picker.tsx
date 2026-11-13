"use client";

import { useRouter } from "next/navigation";
import { academicWeeks, DAY_MS, isoDate, mondayOf, scheduleHref, weekRangeLabel } from "@/lib/schedule-calendar";
import type { ScheduleModel } from "@/lib/schedule-repository";
import { ScheduleDatePicker } from "./schedule-date-picker";

export function ScheduleWeekPicker({ path, query, terms }: { path: string; query: { view: "group" | "teacher"; selected: string; week: string; day: number | null; term: string }; terms: ScheduleModel["terms"] }) {
  const router = useRouter();
  const options = terms.flatMap(term => academicWeeks(term.startsOn, term.endsOn).map(week => ({ ...week, term })));
  const active = options.find(option => option.start === query.week && option.term.code === query.term);
  const selected = isoDate(new Date(new Date(query.week + "T00:00:00Z").getTime() + ((query.day ?? 1) - 1) * DAY_MS));
  function navigate(week: string, term = "") { if (week) router.push(scheduleHref(path, query, { week, term }), { scroll: false }); }
  return <div className="schedule-week-picker">
    <label>Учебная неделя<select aria-label="Номер учебной недели" value={active ? `${active.term.code}:${active.number}` : ""} onChange={event => { const option = options.find(option => `${option.term.code}:${option.number}` === event.target.value); if (option) navigate(option.start, option.term.code); }}>
      <option value="" disabled>{terms.length ? "Вне учебного периода" : "Нет учебных периодов"}</option>
      {terms.map(term => <optgroup label={`${term.name} (${term.startsOn} — ${term.endsOn})`} key={term.code}>{options.filter(o => o.term.code === term.code).map(option => <option key={option.number} value={`${term.code}:${option.number}`}>Неделя №{option.number} · {weekRangeLabel(option.start, option.end)}</option>)}</optgroup>)}
    </select></label>
    <ScheduleDatePicker selected={selected} onSelect={date => router.push(scheduleHref(path, query, { week: isoDate(mondayOf(date)), day: String((date.getUTCDay() + 6) % 7 + 1), term: "" }), { scroll: false })} />
  </div>;
}
