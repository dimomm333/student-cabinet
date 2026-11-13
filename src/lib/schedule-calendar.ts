export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
export const dayNames = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
export const shortDayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }

export function parseCalendarDate(value: string): Date | null {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && isoDate(date) === value ? date : null;
}

export function formatDateInput(value: string): string { return value.split("-").reverse().join("."); }

export function parseDateInput(value: string): Date | null {
  if (!/^\d{2}\.\d{2}\.20\d{2}$/.test(value)) return null;
  return parseCalendarDate(value.split(".").reverse().join("-"));
}

export function shiftCalendarMonth(date: Date, offset: number): Date {
  const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(date.getUTCDate(), new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate())));
}

export function mondayOf(date: Date): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  result.setUTCDate(result.getUTCDate() - (result.getUTCDay() + 6) % 7);
  return result;
}

export function currentAcademicDate(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
}

export function weekParity(week: Date, firstNumeratorMonday: Date): "NUMERATOR" | "DENOMINATOR" {
  const distance = Math.floor((mondayOf(week).getTime() - mondayOf(firstNumeratorMonday).getTime()) / WEEK_MS);
  return ((distance % 2) + 2) % 2 === 0 ? "NUMERATOR" : "DENOMINATOR";
}

export function minuteLabel(value: number): string { return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`; }

export function lessonCountLabel(value: number): string {
  const lastTwo = value % 100, last = value % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? "занятий" : last === 1 ? "занятие" : last >= 2 && last <= 4 ? "занятия" : "занятий";
  return `${value} ${noun}`;
}

export function weekRangeLabel(start: string, end: string): string {
  const format = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
  const first = new Date(start + "T00:00:00Z"), last = new Date(end + "T00:00:00Z");
  const firstYear = first.getUTCFullYear() === last.getUTCFullYear() ? "" : ` ${first.getUTCFullYear()}`;
  return `${format.format(first)}${firstYear} — ${format.format(last)} ${last.getUTCFullYear()}`;
}

export function searchKey(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replaceAll("–", "-").trim(); }
export function filterScheduleChoices<T extends { name: string; slug: string; programme?: string }>(choices: T[], query: string): T[] {
  const key = searchKey(query);
  return choices.filter(item => searchKey(`${item.name} ${item.slug} ${item.programme ?? ""}`).includes(key));
}

// Numbering belongs to an explicit term, independently of numerator parity.
// The week containing startsOn is week 1, including a partial first/last week.
export function academicWeeks(startsOn: string, endsOn: string) {
  const start = parseCalendarDate(startsOn), end = parseCalendarDate(endsOn);
  if (!start || !end || end < start) return [];
  const first = mondayOf(start), last = mondayOf(end);
  return Array.from({ length: Math.floor((last.getTime() - first.getTime()) / WEEK_MS) + 1 }, (_, i) => {
    const week = new Date(first.getTime() + i * WEEK_MS);
    return { number: i + 1, start: isoDate(week), end: isoDate(new Date(week.getTime() + 6 * DAY_MS)) };
  });
}

export function scheduleHref(path: string, query: { view: "group" | "teacher"; selected: string; week: string; day: number | null; term?: string }, patch: Record<string, string> = {}) {
  const params = new URLSearchParams({ ...(path === "/schedule" ? { view: query.view, [query.view === "group" ? "group" : "teacher"]: query.selected } : {}), week: query.week, day: query.day?.toString() ?? "all", term: query.term ?? "", ...patch });
  for (const [key, value] of [...params]) if (!value) params.delete(key);
  return path + "?" + params.toString();
}

export type ScheduleQuery = { view: "group" | "teacher"; selected: string; q: string; week: Date; day: number | null; invalid: boolean; term: string };
export function parseScheduleQuery(params: Record<string, string | string[] | undefined>, now = new Date()): ScheduleQuery {
  const single = (key: string) => typeof params[key] === "string" ? params[key] : "";
  const view = single("view") === "teacher" ? "teacher" : "group";
  const selected = single(view === "group" ? "group" : "teacher");
  const requestedWeek = single("week");
  const parsedWeek = requestedWeek ? parseCalendarDate(requestedWeek) : null;
  const day = single("day");
  const invalid = Object.values(params).some(Array.isArray)
    || !!requestedWeek && !parsedWeek || !!selected && !/^[a-z0-9-]{1,64}$/.test(selected)
    || !!day && day !== "all" && !/^[1-7]$/.test(day) || single("q").length > 80
    || !!single("view") && !["group", "teacher"].includes(single("view"))
    || !!single("term") && !/^[a-z0-9-]{1,64}$/.test(single("term"));
  return { view, selected: /^[a-z0-9-]{1,64}$/.test(selected) ? selected : "", q: single("q").slice(0, 80).trim(), week: mondayOf(parsedWeek ?? currentAcademicDate(now)), day: /^[1-7]$/.test(day) ? Number(day) : null, invalid, term: single("term").slice(0, 64) };
}
