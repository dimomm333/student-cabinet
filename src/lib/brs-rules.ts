import { add, compare, exactDto, fraction, integerRating, ratingValue, roundedHundredths, subtract } from "./brs-exact.ts";
// Stored scales and primary inputs use integer hundredths. Sums retain exact fractions.
export const controlLabels = { CREDIT: "З", DIFFERENTIATED: "ДифЗ", EXAM: "Э", DISTRIBUTED: "РЭкз" } as const;
export type Control = keyof typeof controlLabels;
export const eventLabels = { HOMEWORK: "ДЗ", LAB: "ЛР", INTERIM: "РК", FINAL: "РК/М", SEMINAR: "Семинар" } as const;
export type EventKind = keyof typeof eventLabels;
export function workTitle(event: { kind: EventKind; title: string; number?: number }) {
  if (event.kind === "FINAL") return "РК/М";
  const type = eventLabels[event.kind];
  const title = event.title.trim().replace(/^(ДЗ|РК|ЛР)\s+(?=ДЗ|РК|ЛР)/i, "").replace(/^(ДЗ|РК|ЛР)\s+(\d)/i, "$1$2");
  return /^(ДЗ|РК|ЛР|Семинар)/i.test(title) ? title : `${type}${event.number ?? ""}${title ? ` · ${title}` : ""}`;
}
export const attendanceLabels = { PRESENT: "✓", ACTIVE: "✓✓", SICK: "Б", ABSENT: "Н", EXCUSED: "У" } as const;
export const labLabels = { NOT_STARTED: "Не начата", COMPLETED: "Выполнена", DEFENDED: "Защищена", FAILED: "Не зачтена" } as const;
export const timingLabels = { NOT_SUBMITTED: "Не сдано", EARLY: "Сдано досрочно", ON_TIME: "Сдано вовремя", LATE: "Сдано с опозданием" } as const;
export function labLabel(status: string | null | undefined) { return labLabels[status as keyof typeof labLabels] ?? "Статус требует уточнения"; }
export const moduleLabels: Record<string, string> = { PLANNED: "Запланирован", ACTIVE: "Активен", AWAITING: "Ожидает закрытия", CLOSED: "Закрыт" };
export function parsePoints(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,3}([.,]\d{1,2})?$/.test(value)) throw new Error("Укажите баллы с точностью до сотых.");
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result > 10000) throw new Error("Максимум — 100 баллов.");
  return result;
}
export function points(value: number | null | undefined) { return value == null ? "—" : `${Math.trunc(value / 100)}${value % 100 ? "," + String(value % 100).padStart(2, "0").replace(/0$/, "") : ""}`; }
export function pointInput(value: number | null | undefined) { return value == null ? "" : points(value).replace(",", "."); }
export function halfPoints(maximum: number) {
  const whole = Math.floor(maximum / 200), remainder = maximum % 200;
  return `${whole}${remainder ? "," + String(remainder * 5).padStart(3, "0").replace(/0+$/, "") : ""}`;
}
export function resultPoints(result: { score: number | null; scoreSource?: string; deleted?: boolean } | null | undefined, maximum: number) { return !result || result.deleted ? "—" : result.scoreSource === "LATE" ? halfPoints(maximum) : points(result.score); }
export function parsePrimary(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,6}([.,]\d{1,2})?$/.test(value)) throw new Error("Укажите первичные баллы с точностью до сотых.");
  const [whole, part = ""] = value.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}
export function finalRating(score: number) { return Math.floor((score + 99) / 100); }
export function gradeFor(control: Control, rating: number) {
  return control === "CREDIT" ? rating >= 60 ? "Зачёт" : "Незачёт" : rating >= 85 ? "5" : rating >= 71 ? "4" : rating >= 50 ? "3" : "2";
}
export function template(control: Control, count: number) {
  if (!Object.hasOwn(controlLabels, control) || ![2, 3].includes(count)) throw new Error("Выберите вид контроля и два или три модуля.");
  const exam = control === "EXAM";
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1, seminarMax: count === 2 ? exam ? 500 : 600 : i === 2 ? 400 : 300,
    workMax: count === 2 ? exam ? 1500 : 2200 : exam ? 1000 : 1500,
    controlMax: count === 2 ? exam ? 1500 : 2200 : exam ? 1000 : 1500,
  }));
}
export function distribute(total: number, count: number) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(count) || count < 1) throw new Error("Нет подходящих занятий для распределения фонда.");
  return Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i >= count - total % count ? 1 : 0));
}
export type ResultInput = { score: number | null; primaryScore?: number | null; primaryMax?: number | null; exactNumerator?: string | null; exactDenominator?: string | null; scoreSource?: string; submissionTiming?: string | null; passed: boolean | null; labStatus: string | null; deleted: boolean; submittedOn?: Date | string | null; checkedOn?: Date | string | null; performedOn?: Date | string | null; defendedOn?: Date | string | null };
export type CalcEvent = { id: string; title: string; kind: EventKind; maxScore: number; required: boolean; labMinScore: number | null; labRequiresDefense: boolean; result?: ResultInput };
export type CalcModule = { id: string; number: number; state: string; seminarMax: number; workMax: number; controlMax: number; events: CalcEvent[] };
export function workStatus(event: Pick<CalcEvent, "kind">, result?: ResultInput) {
  if (!result || result.deleted) return event.kind === "LAB" ? "Не начата" : "Не сдано";
  if (event.kind === "LAB") return labLabel(result.labStatus);
  if (result.submissionTiming) return timingLabels[result.submissionTiming as keyof typeof timingLabels] ?? "Срок сдачи не указан";
  if (event.kind === "HOMEWORK") return "Срок сдачи не указан";
  return "Состояние сдачи не указано";
}
type EffectiveModules<M extends { events: CalcEvent[] }> = (Omit<M, "events"> & { events: (M["events"][number] & { result: ResultInput | undefined })[] })[];
export function effectiveModules<M extends { events: (CalcEvent & { occurrenceId?: string | null })[] }>(modules: M[], results: (ResultInput & { eventId: string })[], attendance: { occurrenceId: string; mark: string | null }[]): EffectiveModules<M> {
  return modules.map(brsModule => ({ ...brsModule, events: brsModule.events.map(event => {
    const mark = attendance.find(item => item.occurrenceId === event.occurrenceId)?.mark;
    const result: ResultInput | undefined = event.kind === "SEMINAR" ? { score: mark == null ? null : mark === "ACTIVE" ? event.maxScore : 0, passed: null, labStatus: null, deleted: false } : results.find(result => result.eventId === event.id);
    return { ...event, required: event.kind === "SEMINAR" ? false : event.required, result };
  }) })) as EffectiveModules<M>;
}
export function completion(event: CalcEvent): "MET" | "FAILED" | "PENDING" {
  const result = event.result;
  if (!result || result.deleted || result.score === null) return "PENDING";
  const score = ratingValue(result, event.maxScore);
  if (["HOMEWORK", "INTERIM", "FINAL"].includes(event.kind)) {
    const submitted = result.submissionTiming ? result.submissionTiming !== "NOT_SUBMITTED" : event.kind === "HOMEWORK" ? !!result.submittedOn && !!result.checkedOn : result.passed !== null;
    return !submitted ? "PENDING" : compare(score, fraction(event.maxScore, 2)) >= 0 ? "MET" : "FAILED";
  }
  if (event.kind === "LAB") {
    if (result.labStatus === "FAILED" || compare(score, fraction(event.labMinScore ?? 0)) < 0) return "FAILED";
    return result.performedOn && (event.labRequiresDefense ? result.labStatus === "DEFENDED" && !!result.defendedOn : ["COMPLETED", "DEFENDED"].includes(result.labStatus ?? "")) ? "MET" : "PENDING";
  }
  return "MET";
}
export function conditions(events: CalcEvent[]) {
  const problems = events.filter(event => event.required && completion(event) !== "MET").map(event => ({ id: event.id, title: event.title, state: completion(event), reason: `${event.title}: ${completion(event) === "PENDING" ? "недостаточно данных / работа не закрыта" : "условие закрытия не выполнено"}` }));
  return { state: problems.some(p => p.state === "FAILED") ? "FAILED" : problems.length ? "PENDING" : "MET", problems };
}
export function calculateBrs(control: Control, modules: CalcModule[], attempts: { id: string; score: number; passed: boolean; deleted: boolean }[], admission?: { approved: boolean; reason: string } | null) {
  const events = modules.flatMap(module => module.events);
  const finalEvent = [...modules].sort((a, b) => b.number - a.number)[0]?.events.find(event => event.kind === "FINAL");
  const sum = (items: CalcEvent[]) => items.reduce((total, event) => add(total, event.result && !event.result.deleted ? ratingValue(event.result, event.maxScore) : fraction(0)), fraction(0));
  const allConditions = conditions(events);
  const previousConditions = conditions(modules.filter(module => module.number < modules.length).flatMap(module => module.events));
  const academic = control === "EXAM" ? allConditions : previousConditions;
  const activeAttempts = attempts.filter(attempt => !attempt.deleted);
  const bestAttempt = activeAttempts.reduce<typeof activeAttempts[number] | null>((best, attempt) => !best || attempt.score > best.score || attempt.score === best.score && attempt.passed ? attempt : best, null);
  const original = finalEvent?.result && !finalEvent.result.deleted ? finalEvent.result.score : null;
  const originalExact = finalEvent?.result && !finalEvent.result.deleted ? ratingValue(finalEvent.result, finalEvent.maxScore) : fraction(0);
  const replacement = control === "DISTRIBUTED" && compare(originalExact, fraction(bestAttempt?.score ?? 0)) > 0 ? originalExact : fraction(bestAttempt?.score ?? 0);
  const semesterScore = sum(events);
  const total = control === "EXAM" ? add(semesterScore, fraction(bestAttempt?.score ?? 0)) : control === "DISTRIBUTED" ? add(subtract(semesterScore, originalExact), replacement) : semesterScore;
  const effectiveFinalPassed = control === "DISTRIBUTED" && finalEvent ? completion(finalEvent) === "MET" || activeAttempts.some(attempt => attempt.score * 2 >= finalEvent.maxScore) : true;
  const remaining = events.filter(event => event.required && completion(event) !== "MET" && !(control === "DISTRIBUTED" && event.id === finalEvent?.id && effectiveFinalPassed));
  const missing = events.filter(event => !event.result || event.result.deleted || event.result.score === null).filter(event => !(control === "DISTRIBUTED" && event.id === finalEvent?.id && bestAttempt));
  const ready = !missing.length && !remaining.length && (control !== "EXAM" || !!bestAttempt) && effectiveFinalPassed;
  const rating = integerRating(total);
  const admissionStatus = academic.state === "FAILED" ? "Не допущен" : academic.state !== "MET" ? "Проверка не завершена" : admission?.approved ? "Допущен" : "Ожидает подтверждения деканата";
  const moduleSum = (brsModule: CalcModule) => control === "DISTRIBUTED" && brsModule.events.some(event => event.id === finalEvent?.id) ? add(subtract(sum(brsModule.events), originalExact), replacement) : sum(brsModule.events);
  return { semesterScore: roundedHundredths(semesterScore), semesterMax: control === "EXAM" ? 7000 : 10000, total: roundedHundredths(total), exactTotal: exactDto(total), exactSemester: exactDto(semesterScore), rating, provisionalGrade: gradeFor(control, rating), finalCalculatedRating: ready ? rating : null, ready,
    academic, admissionStatus, bestAttemptId: bestAttempt?.id ?? null, examScore: control === "EXAM" ? bestAttempt?.score ?? null : roundedHundredths(replacement),
    examMax: control === "EXAM" ? 3000 : control === "DISTRIBUTED" ? finalEvent?.maxScore ?? 0 : 0,
    previousScore: roundedHundredths(sum(modules.filter(module => module.number < modules.length).flatMap(module => module.events))), finalEventId: finalEvent?.id,
    originalFinalScore: original, effectiveFinalPassed, sessionRequired: control === "DISTRIBUTED" && !effectiveFinalPassed,
    debts: remaining.map(event => ({ id: event.id, title: event.title, state: completion(event) })), missing: missing.length,
    modules: modules.map(module => ({ id: module.id, number: module.number, score: roundedHundredths(moduleSum(module)), exactScore: exactDto(moduleSum(module)), seminarScore: roundedHundredths(sum(module.events.filter(event => event.kind === "SEMINAR"))), seminarMissing: module.events.filter(event => event.kind === "SEMINAR" && event.result?.score == null).length, max: module.seminarMax + module.workMax + module.controlMax, debts: remaining.filter(event => module.events.some(item => item.id === event.id)).map(event => ({ id: event.id, title: event.title, reason: `${event.title}: обязательная работа не завершена` })), complete: !remaining.some(event => module.events.some(item => item.id === event.id)) })) };
}
export type BrsCalculation = ReturnType<typeof calculateBrs>;
