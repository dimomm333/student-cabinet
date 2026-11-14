"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DAY_MS, formatDateInput, isoDate, mondayOf, parseDateInput, shiftCalendarMonth, shortDayNames } from "@/lib/schedule-calendar";

const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const inRange = (date: Date) => date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2099;

// Only a committed route date replaces the draft; ordinary typing never navigates.
export function ScheduleDatePicker({ selected, onSelect, label = "Дата учебной недели", name }: { selected: string; onSelect: (date: Date) => void; label?: string; name?: string }) {
  const id = useId();
  const [draft, setDraft] = useState(formatDateInput(selected));
  const [cursor, setCursor] = useState(new Date(selected + "T00:00:00Z"));
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [error, setError] = useState("");
  const [committed, setCommitted] = useState(selected);
  if (committed !== selected) {
    setCommitted(selected); setDraft(formatDateInput(selected));
    setCursor(new Date(selected + "T00:00:00Z")); setError(""); setOpen(false);
  }
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const focusDay = useRef(false);
  const wheel = useRef(0);
  const lastWheel = useRef(0);
  const touch = useRef<number | null>(null);
  const month = cursor.getUTCMonth();
  const year = cursor.getUTCFullYear();
  const start = mondayOf(new Date(Date.UTC(year, month, 1)));
  const days = Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * DAY_MS));

  function moveMonth(offset: number) {
    setCursor(previous => { const next = shiftCalendarMonth(previous, offset); return inRange(next) ? next : previous; });
  }
  function openCalendar() {
    const rect = input.current!.getBoundingClientRect();
    setPosition({ top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 350)), left: Math.max(8, Math.min(rect.left, window.innerWidth - 322)) });
    setOpen(true);
  }
  useEffect(() => {
    if (focusDay.current) {
      root.current?.querySelector<HTMLButtonElement>(`[data-date="${isoDate(cursor)}"]`)?.focus({ preventScroll: true });
      focusDay.current = false;
    }
  }, [cursor]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    // A non-passive listener confines wheel scrolling to the calendar. The same
    // cursor renders both the heading and days, including December/January.
    const calendar = root.current?.querySelector<HTMLElement>(".schedule-calendar");
    const scroll = (event: WheelEvent) => {
      event.preventDefault();
      if (performance.now() - lastWheel.current < 180) return;
      wheel.current += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 280 : 1);
      if (Math.abs(wheel.current) < 45) return;
      moveMonth(Math.sign(wheel.current)); wheel.current = 0; lastWheel.current = performance.now();
    };
    document.addEventListener("pointerdown", close);
    calendar?.addEventListener("wheel", scroll, { passive: false });
    return () => { document.removeEventListener("pointerdown", close); calendar?.removeEventListener("wheel", scroll); };
  }, [open]);

  function choose(date: Date) {
    setDraft(formatDateInput(isoDate(date))); setCursor(date); setError(""); setOpen(false);
    input.current?.focus({ preventScroll: true }); onSelect(date);
  }
  function confirm() {
    const date = parseDateInput(draft);
    if (!date) { setError("Введите существующую дату в формате ДД.ММ.ГГГГ (2000–2099)."); return; }
    choose(date);
  }
  return <div className="schedule-date-picker" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); input.current?.focus({ preventScroll: true }); }
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="schedule-date-input"><input ref={input} id={id} name={name} aria-label={label} type="text" inputMode="decimal" placeholder="ДД.ММ.ГГГГ" maxLength={10} value={draft} aria-invalid={!!error} aria-describedby={`${id}-hint`} onChange={event => { setDraft(event.target.value); setError(""); }} onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); confirm(); }
      if (event.key === "ArrowDown") { event.preventDefault(); openCalendar(); }
    }} /><button type="button" aria-label="Открыть календарь" aria-expanded={open} aria-controls={`${id}-calendar`} onClick={() => open ? setOpen(false) : openCalendar()}>▦</button><button type="button" aria-label="Применить дату" onClick={confirm}>✓</button></div>
    <span id={`${id}-hint`} className="schedule-date-hint" role={error ? "alert" : undefined}>{error || "ДД.ММ.ГГГГ · Enter — выбрать"}</span>
    {open && <div id={`${id}-calendar`} className="schedule-calendar" style={position} role="dialog" aria-label="Выбор даты" onTouchStart={event => { touch.current = event.touches[0].clientX; }} onTouchEnd={event => {
      if (touch.current !== null) { const distance = touch.current - event.changedTouches[0].clientX; if (Math.abs(distance) > 50) moveMonth(Math.sign(distance)); touch.current = null; }
    }}>
      <div className="schedule-calendar-heading"><button type="button" aria-label="Предыдущий месяц" disabled={year === 2000 && month === 0} onClick={() => moveMonth(-1)}>←</button><strong aria-live="polite">{monthFormat.format(cursor)}</strong><button type="button" aria-label="Следующий месяц" disabled={year === 2099 && month === 11} onClick={() => moveMonth(1)}>→</button></div>
      <div className="schedule-calendar-grid">{shortDayNames.map(day => <span key={day}>{day}</span>)}{days.map(date => <button type="button" key={isoDate(date)} data-date={isoDate(date)} aria-label={dayFormat.format(date)} aria-pressed={isoDate(date) === selected} disabled={!inRange(date)} className={date.getUTCMonth() !== month ? "schedule-calendar-adjacent" : undefined} tabIndex={isoDate(date) === isoDate(cursor) ? 0 : -1} onClick={() => choose(date)} onKeyDown={event => {
        let next: Date | undefined;
        const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (offset) next = new Date(date.getTime() + offset * DAY_MS);
        if (event.key === "PageUp" || event.key === "PageDown") next = shiftCalendarMonth(date, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
        if (event.key === "Home") next = mondayOf(date);
        if (event.key === "End") next = new Date(mondayOf(date).getTime() + 6 * DAY_MS);
        if (next) { event.preventDefault(); if (inRange(next)) { focusDay.current = true; setCursor(next); } }
      }}>{date.getUTCDate()}</button>)}</div>
    </div>}
  </div>;
}
