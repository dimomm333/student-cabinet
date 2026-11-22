"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { parseDateOnly, parseDateText } from "@/lib/date-field";
import { currentAcademicDate, DAY_MS, formatDateInput, isoDate, shiftCalendarMonth, shortDayNames } from "@/lib/schedule-calendar";
import { Icon } from "./icon";

const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const firstDate = new Date("0001-01-01T00:00:00Z");
const lastDate = new Date("9999-12-31T00:00:00Z");
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const weekday = (date: Date) => (date.getUTCDay() + 6) % 7;

type DatePickerProps = {
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  confirmInput?: boolean;
  formFormat?: "iso" | "ru";
  className?: string;
};

export function DatePicker({
  label, name, value, defaultValue = "", onValueChange, min, max, required = false,
  disabled, confirmInput = false, formFormat = "iso", className,
}: DatePickerProps) {
  const id = useId();
  const initial = value ?? defaultValue;
  const [previousValue, setPreviousValue] = useState(initial);
  const [draft, setDraft] = useState(() => formatDateInput(initial));
  const [cursor, setCursor] = useState<Date | null>(null);
  const [today, setToday] = useState<Date | null>(null);
  const [showError, setShowError] = useState(false);
  if (previousValue !== initial) {
    const nextDraft = formatDateInput(initial);
    setPreviousValue(initial);
    setDraft(nextDraft);
    setShowError(false);
    if (nextDraft !== draft) setCursor(null);
  }

  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const inputRow = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusDay = useRef(false);
  const touchOpening = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const lower = (min && parseDateOnly(min)) || firstDate;
  const upper = (max && parseDateOnly(max)) || lastDate;
  const parsed = parseDateText(draft);
  const error = validationMessage(draft);
  const open = cursor !== null;

  function validationMessage(text: string) {
    if (!text) return required ? "Выберите дату." : "";
    const date = parseDateText(text);
    if (!date) return "Введите существующую дату в формате ДД.ММ.ГГГГ.";
    if (date < lower) return `Укажите дату не раньше ${formatDateInput(isoDate(lower))}.`;
    if (date > upper) return `Укажите дату не позже ${formatDateInput(isoDate(upper))}.`;
    return "";
  }

  function clamp(date: Date) {
    return date < lower ? lower : date > upper ? upper : date;
  }

  function setText(text: string) {
    field.current?.setCustomValidity(validationMessage(text));
    setDraft(text);
    setShowError(false);
  }

  function closeCalendar(restoreFocus = false) {
    setCursor(null);
    if (restoreFocus) (open && touchOpening.current ? trigger : field).current?.focus({ preventScroll: true });
  }

  function openCalendar(byTouch = false) {
    const current = currentAcademicDate();
    setToday(current);
    touchOpening.current = byTouch;
    dragged.current = false;
    focusDay.current = !byTouch;
    setCursor(clamp(parsed ?? current));
  }

  function choose(date: Date | null) {
    const iso = date ? isoDate(date) : "";
    setText(formatDateInput(iso));
    closeCalendar(true);
    if (confirmInput || iso !== initial) onValueChange?.(iso);
  }

  function commitInput(restoreFocus = false) {
    setShowError(!!error);
    if (error) {
      if (!draft && !confirmInput && initial) onValueChange?.("");
      return;
    }
    if (restoreFocus) choose(parsed);
    else {
      const iso = parsed ? isoDate(parsed) : "";
      if (iso !== initial) onValueChange?.(iso);
    }
  }

  function canMoveMonth(date: Date, offset: number) {
    if (offset === -12) return date.getUTCFullYear() > lower.getUTCFullYear();
    if (offset === 12) return date.getUTCFullYear() < upper.getUTCFullYear();
    const first = addDays(date, 1 - date.getUTCDate());
    return offset < 0 ? first > lower : shiftCalendarMonth(first, 1) <= upper;
  }

  function moveMonth(date: Date, offset: number) {
    const next = clamp(shiftCalendarMonth(date, offset));
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && popup.current?.contains(active) && active.dataset.monthStep
      && !canMoveMonth(next, Number(active.dataset.monthStep))) {
      // A focused button loses focus when it becomes disabled at a date bound.
      popup.current.focus({ preventScroll: true });
    }
    setCursor(next);
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: Date;
    switch (event.key) {
      case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown":
        next = addDays(date, offsets[event.key]); break;
      case "PageUp": case "PageDown":
        next = shiftCalendarMonth(date, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)); break;
      case "Home": next = addDays(date, -weekday(date)); break;
      case "End": next = addDays(date, 6 - weekday(date)); break;
      default: return;
    }
    event.preventDefault();
    if (next < lower || next > upper || next.getTime() === cursor?.getTime()) return;
    focusDay.current = true;
    setCursor(next);
  }

  useEffect(() => { field.current?.setCustomValidity(error); }, [error]);

  const resetField = useEffectEvent(() => {
    setText(formatDateInput(initial));
    closeCalendar();
  });
  useEffect(() => {
    const form = field.current?.form;
    const reset = (event: Event) => queueMicrotask(() => {
      if (!event.defaultPrevented) resetField();
    });
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);

  const wheelMonth = useEffectEvent((direction: number) => {
    if (cursor) moveMonth(cursor, direction);
  });
  useLayoutEffect(() => {
    if (!open || !popup.current || !root.current || !inputRow.current || !content.current) return;
    const calendar = popup.current;
    const anchor = root.current;
    const row = inputRow.current;
    const body = content.current;
    const modal = anchor.closest("dialog");
    const viewport = window.visualViewport;
    let frame = 0;
    function position() {
      const rect = row.getBoundingClientRect();
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? document.documentElement.clientWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const heightLimit = Math.max(0, viewportHeight - 16);
      const bottom = top + viewportHeight;
      const sheet = width <= 480;
      calendar.dataset.placement = sheet ? "bottom" : "anchor";
      calendar.style.maxWidth = `${Math.max(0, width - 16)}px`;
      // Measure the content independently of the scrollport. Relaxing max-height
      // to measure it would clamp the current scroll offset before paint.
      const fullHeight = body.offsetHeight + calendar.offsetHeight - calendar.clientHeight;
      const below = bottom - rect.bottom - 14;
      const above = rect.top - top - 14;
      const placeBelow = below >= fullHeight || below >= above;
      const fits = !sheet && (placeBelow ? below : above) >= fullHeight;
      calendar.style.maxHeight = `${heightLimit}px`;
      const height = calendar.offsetHeight;
      const y = fits ? (placeBelow ? rect.bottom + 6 : rect.top - height - 6) : bottom - height - 8;
      const x = sheet ? left + (width - calendar.offsetWidth) / 2 : rect.left;
      calendar.style.top = `${Math.max(top + 8, Math.min(y, bottom - height - 8))}px`;
      calendar.style.left = `${Math.max(left + 8, Math.min(x, left + width - calendar.offsetWidth - 8))}px`;
    }
    function queuePosition() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        position();
      });
    }
    function anchorScroll(event: Event) {
      if (event.target === window || (event.target instanceof Node && event.target.contains(anchor))) queuePosition();
    }
    calendar.showPopover();
    position();
    if (touchOpening.current) calendar.focus({ preventScroll: true });
    const resize = new ResizeObserver(queuePosition);
    resize.observe(body);
    resize.observe(row);
    let lastWheel = -Infinity;
    let delta = 0;
    const wheel = (event: WheelEvent) => {
      if (calendar.scrollHeight > calendar.clientHeight || event.ctrlKey) return;
      event.preventDefault();
      if (performance.now() - lastWheel < 180) return;
      delta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 280 : 1);
      if (Math.abs(delta) < 45) return;
      wheelMonth(Math.sign(delta));
      delta = 0;
      lastWheel = performance.now();
    };
    const outside = (event: PointerEvent) => {
      if (!anchor.contains(event.target as Node)) setCursor(null);
    };
    const cancel = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setCursor(null);
      (touchOpening.current ? trigger : field).current?.focus({ preventScroll: true });
    };
    calendar.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("pointerdown", outside);
    modal?.addEventListener("cancel", cancel, true);
    window.addEventListener("scroll", anchorScroll, true);
    window.addEventListener("resize", queuePosition);
    viewport?.addEventListener("resize", queuePosition);
    viewport?.addEventListener("scroll", queuePosition);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      calendar.hidePopover();
      calendar.removeEventListener("wheel", wheel);
      document.removeEventListener("pointerdown", outside);
      modal?.removeEventListener("cancel", cancel, true);
      window.removeEventListener("scroll", anchorScroll, true);
      window.removeEventListener("resize", queuePosition);
      viewport?.removeEventListener("resize", queuePosition);
      viewport?.removeEventListener("scroll", queuePosition);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (cursor && focusDay.current) {
      const calendar = popup.current;
      const day = calendar?.querySelector<HTMLButtonElement>(`[data-date="${isoDate(cursor)}"]`);
      if (calendar && day && document.activeElement !== day) {
        day.focus({ preventScroll: true });
        const calendarRect = calendar.getBoundingClientRect();
        const dayRect = day.getBoundingClientRect();
        if (dayRect.bottom > calendarRect.bottom) calendar.scrollTop += dayRect.bottom - calendarRect.bottom + 4;
        if (dayRect.top < calendarRect.top) calendar.scrollTop -= calendarRect.top - dayRect.top + 4;
      }
      focusDay.current = false;
    }
  }, [cursor]);

  const committedDate = confirmInput && !name ? parseDateOnly(initial) : parsed;
  const selected = committedDate && committedDate >= lower && committedDate <= upper ? committedDate : null;
  const month = cursor && addDays(cursor, 1 - cursor.getUTCDate());
  const start = month && addDays(month, -weekday(month));
  const days = start ? Array.from({ length: 42 }, (_, index) => addDays(start, index)) : [];
  const submitted = parsed && !error ? (formFormat === "ru" ? formatDateInput(isoDate(parsed)) : isoDate(parsed)) : "";
  const invalid = showError && !!error;

  return <div className={["date-picker", className].filter(Boolean).join(" ")} ref={root}
    onBlur={event => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      if (!confirmInput) commitInput();
      closeCalendar();
    }}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        closeCalendar(true);
      }
    }}>
    <label htmlFor={id}><span>{label}{required && <span aria-hidden="true"> *</span>}</span></label>
    <div className="schedule-date-input" ref={inputRow}>
      {name && <input type="hidden" name={name} value={submitted} disabled={disabled} />}
      <input ref={field} id={id} type="text" inputMode="decimal" placeholder="ДД.ММ.ГГГГ" maxLength={10}
        value={draft} required={required} disabled={disabled} aria-label={label} aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint`}
        onChange={event => setText(event.target.value)}
        onInvalid={() => setShowError(true)}
        onKeyDown={event => {
          if (event.key === "Enter" && (confirmInput || !name || error)) {
            event.preventDefault();
            commitInput(true);
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openCalendar();
          }
        }} />
      <button ref={trigger} type="button" aria-label="Открыть календарь" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? `${id}-calendar` : undefined} disabled={disabled}
        onPointerDown={event => { touchOpening.current = event.pointerType === "touch"; }}
        onClick={event => open ? closeCalendar(true) : openCalendar(event.detail > 0 && touchOpening.current)}><Icon name="calendar" size={18} /></button>
      {confirmInput && <button type="button" aria-label="Применить дату" disabled={disabled} onClick={() => commitInput(true)}>✓</button>}
    </div>
    <span id={`${id}-hint`} className="schedule-date-hint" role={invalid ? "alert" : undefined}>
      {invalid ? error : confirmInput ? "ДД.ММ.ГГГГ · Enter — выбрать" : ""}
    </span>
    {cursor && month && <div ref={popup} popover="manual" id={`${id}-calendar`} className="schedule-calendar"
      role="dialog" aria-label={`Выбор даты. ${label}`} tabIndex={-1}
      onPointerDown={() => { dragged.current = false; }}
      onClickCapture={event => {
        if (dragged.current && event.detail > 0) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onTouchStart={event => {
        const point = event.touches.length === 1 ? event.touches[0] : null;
        touch.current = point ? { x: point.clientX, y: point.clientY } : null;
        if (!point) dragged.current = true;
      }}
      onTouchMove={event => {
        const start = touch.current;
        const point = event.touches[0];
        if (start && Math.hypot(start.x - point.clientX, start.y - point.clientY) > 10) dragged.current = true;
      }}
      onTouchCancel={() => { touch.current = null; dragged.current = true; }}
      onTouchEnd={event => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const x = start.x - event.changedTouches[0].clientX;
        const y = start.y - event.changedTouches[0].clientY;
        if (Math.abs(x) > 50 && Math.abs(x) > Math.abs(y)) {
          dragged.current = true;
          moveMonth(cursor, Math.sign(x));
        }
      }}>
      <div ref={content} className="schedule-calendar-content">
        <div className="schedule-calendar-heading">
          <button type="button" data-month-step="-12" aria-label="Предыдущий год" disabled={!canMoveMonth(cursor, -12)} onClick={() => moveMonth(cursor, -12)}>«</button>
          <button type="button" data-month-step="-1" aria-label="Предыдущий месяц" disabled={!canMoveMonth(cursor, -1)} onClick={() => moveMonth(cursor, -1)}><Icon name="chevron" size={17} /></button>
          <strong aria-live="polite">{monthFormat.format(cursor)}</strong>
          <button type="button" data-month-step="1" aria-label="Следующий месяц" disabled={!canMoveMonth(cursor, 1)} onClick={() => moveMonth(cursor, 1)}><Icon name="chevron" size={17} /></button>
          <button type="button" data-month-step="12" aria-label="Следующий год" disabled={!canMoveMonth(cursor, 12)} onClick={() => moveMonth(cursor, 12)}>»</button>
        </div>
        <div className="schedule-calendar-grid">
          {shortDayNames.map(day => <span key={day}>{day}</span>)}
          {days.map(date => <button type="button" key={date.toISOString()} data-date={isoDate(date)}
            aria-label={dayFormat.format(date)} aria-current={today?.getTime() === date.getTime() ? "date" : undefined}
            aria-pressed={selected?.getTime() === date.getTime()} disabled={date < lower || date > upper}
            className={date.getUTCMonth() !== month.getUTCMonth() ? "schedule-calendar-adjacent" : undefined}
            tabIndex={date.getTime() === cursor.getTime() ? 0 : -1}
            onClick={() => choose(date)} onKeyDown={event => moveFocus(event, date)}>{date.getUTCDate()}</button>)}
        </div>
        <div className="schedule-calendar-footer">
          {today && today >= lower && today <= upper && <button type="button" onClick={() => choose(today)}>Сегодня</button>}
          {!required && <button type="button" onClick={() => choose(null)}>Очистить</button>}
          <button type="button" onClick={() => closeCalendar(true)}>Закрыть</button>
        </div>
      </div>
    </div>}
  </div>;
}
