import { currentAcademicDate, mondayOf, parseCalendarDate } from "./schedule-calendar.ts";

export class ScheduleApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export type ScheduleApiResource = "schedule" | "groups" | "teachers";
function invalid(message: string): never { throw new ScheduleApiError(400, "INVALID_PARAMETERS", message); }
function integer(value: string, min: number, max: number, label: string) {
  if (!/^(0|[1-9]\d*)$/.test(value)) invalid(`${label}: требуется целое число.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) invalid(`${label}: допустимо от ${min} до ${max}.`);
  return number;
}
export function parseScheduleApiParameters(resource: ScheduleApiResource, url: URL, now = new Date()) {
  if (url.search.length > 2048) invalid("Строка параметров слишком длинная.");
  const params = url.searchParams;
  const allowed = resource === "schedule" ? ["group", "teacher", "week", "weekNumber", "term"] : ["q", "limit", "offset"];
  for (const key of params.keys()) {
    if (!allowed.includes(key)) invalid(`Неизвестный параметр: ${key.slice(0, 40)}.`);
    if (params.getAll(key).length !== 1) invalid(`Параметр ${key} не должен повторяться.`);
  }
  if (resource !== "schedule") {
    const q = params.get("q") ?? "";
    if (q.length > 80) invalid("Поисковый запрос не должен превышать 80 символов.");
    return { kind: "list" as const, q: q.trim(), limit: integer(params.get("limit") ?? "50", 1, 100, "limit"), offset: integer(params.get("offset") ?? "0", 0, 5000, "offset") };
  }
  if (params.has("group") === params.has("teacher")) invalid("Укажите ровно один параметр: group или teacher.");
  const view = params.has("group") ? "group" as const : "teacher" as const;
  const selected = params.get(view)!;
  if (!/^[a-z0-9-]{1,64}$/.test(selected)) invalid("Некорректный публичный slug группы или преподавателя.");
  const term = params.get("term") ?? "";
  if (params.has("term") && !/^[a-z0-9-]{1,64}$/.test(term)) invalid("Некорректный код учебного периода.");
  if (params.has("week") && params.has("weekNumber")) invalid("Укажите week или weekNumber, а не оба параметра.");
  const weekNumber = params.has("weekNumber") ? integer(params.get("weekNumber")!, 1, 104, "weekNumber") : null;
  if (weekNumber !== null && !term) invalid("Для weekNumber требуется term.");
  const date = params.has("week") ? parseCalendarDate(params.get("week")!) : currentAcademicDate(now);
  if (!date) invalid("week: требуется существующая дата YYYY-MM-DD в диапазоне 2000–2099.");
  return { kind: "schedule" as const, view, selected, term, week: mondayOf(date), weekNumber };
}
