// Scores are integer hundredths everywhere, including persisted maxima.
export const controlLabels = { CREDIT: "З", DIFFERENTIATED: "ДифЗ", EXAM: "Э", DISTRIBUTED: "РЭкз" } as const;
export type Control = keyof typeof controlLabels;
export const eventLabels = { HOMEWORK: "ДЗ", LAB: "ЛР", INTERIM: "РК", FINAL: "РК/М", SEMINAR: "Семинар" } as const;
export type EventKind = keyof typeof eventLabels;
export const attendanceLabels = { PRESENT: "✓", ACTIVE: "✓✓", SICK: "Б", ABSENT: "Н", EXCUSED: "У" } as const;
export const labLabels = { NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Выполнена", DEFENDED: "Защищена", FAILED: "Не зачтена" } as const;
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
export type ResultInput = { score: number | null; passed: boolean | null; labStatus: string | null; deleted: boolean; submittedOn?: Date | string | null; checkedOn?: Date | string | null; performedOn?: Date | string | null; defendedOn?: Date | string | null };
export type CalcEvent = { id: string; title: string; kind: EventKind; maxScore: number; required: boolean; labMinScore: number | null; labRequiresDefense: boolean; result?: ResultInput };
export type CalcModule = { id: string; number: number; state: string; seminarMax: number; workMax: number; controlMax: number; events: CalcEvent[] };
export function completion(event: CalcEvent): "MET" | "FAILED" | "PENDING" {
  const result = event.result;
  if (!result || result.deleted || result.score === null) return "PENDING";
  if (event.kind === "HOMEWORK") return !result.submittedOn || !result.checkedOn ? "PENDING" : result.score * 2 >= event.maxScore ? "MET" : "FAILED";
  if (event.kind === "LAB") {
    if (result.labStatus === "FAILED" || result.score < (event.labMinScore ?? 0)) return "FAILED";
    return result.performedOn && (event.labRequiresDefense ? result.labStatus === "DEFENDED" && !!result.defendedOn : ["COMPLETED", "DEFENDED"].includes(result.labStatus ?? "")) ? "MET" : "PENDING";
  }
  if (event.kind === "INTERIM" || event.kind === "FINAL") return result.passed === null ? "PENDING" : result.passed ? "MET" : "FAILED";
  return "MET";
}
export function conditions(events: CalcEvent[]) {
  const problems = events.filter(event => event.required && completion(event) !== "MET").map(event => ({ id: event.id, title: event.title, state: completion(event), reason: `${event.title}: ${completion(event) === "PENDING" ? "недостаточно данных / работа не закрыта" : "условие закрытия не выполнено"}` }));
  return { state: problems.some(p => p.state === "FAILED") ? "FAILED" : problems.length ? "PENDING" : "MET", problems };
}
export function calculateBrs(control: Control, modules: CalcModule[], attempts: { id: string; score: number; passed: boolean; deleted: boolean }[], admission?: { approved: boolean; reason: string } | null) {
  const events = modules.flatMap(module => module.events);
  const finalEvent = [...modules].sort((a, b) => b.number - a.number)[0]?.events.find(event => event.kind === "FINAL");
  const sum = (items: CalcEvent[]) => items.reduce((total, event) => total + (event.result && !event.result.deleted ? event.result.score ?? 0 : 0), 0);
  const allConditions = conditions(events);
  const previousConditions = conditions(modules.filter(module => module.number < modules.length).flatMap(module => module.events));
  const academic = control === "EXAM" ? allConditions : previousConditions;
  const activeAttempts = attempts.filter(attempt => !attempt.deleted);
  const bestAttempt = activeAttempts.reduce<typeof activeAttempts[number] | null>((best, attempt) => !best || attempt.score > best.score || attempt.score === best.score && attempt.passed ? attempt : best, null);
  const original = finalEvent?.result && !finalEvent.result.deleted ? finalEvent.result.score : null;
  const replacement = control === "DISTRIBUTED" ? Math.max(original ?? 0, bestAttempt?.score ?? 0) : 0;
  const semesterScore = sum(events);
  const total = control === "EXAM" ? semesterScore + (bestAttempt?.score ?? 0) : control === "DISTRIBUTED" ? semesterScore - (original ?? 0) + replacement : semesterScore;
  const effectiveFinalPassed = control === "DISTRIBUTED" && finalEvent ? !!finalEvent.result?.passed && !finalEvent.result.deleted || activeAttempts.some(attempt => attempt.passed) : true;
  const remaining = events.filter(event => event.required && completion(event) !== "MET" && !(control === "DISTRIBUTED" && event.id === finalEvent?.id && effectiveFinalPassed));
  const missing = events.filter(event => !event.result || event.result.deleted || event.result.score === null).filter(event => !(control === "DISTRIBUTED" && event.id === finalEvent?.id && bestAttempt));
  const ready = !missing.length && !remaining.length && modules.every(module => module.state === "CLOSED") && (control !== "EXAM" || !!bestAttempt) && effectiveFinalPassed;
  const rating = finalRating(total);
  const admissionStatus = academic.state === "FAILED" ? "Не допущен" : academic.state !== "MET" ? "Проверка не завершена" : admission?.approved ? "Допущен" : "Ожидает подтверждения деканата";
  return { semesterScore, semesterMax: control === "EXAM" ? 7000 : 10000, total, rating, provisionalGrade: gradeFor(control, rating), finalCalculatedRating: ready ? rating : null, ready,
    academic, admissionStatus, bestAttemptId: bestAttempt?.id ?? null, examScore: control === "EXAM" ? bestAttempt?.score ?? null : replacement,
    examMax: control === "EXAM" ? 3000 : control === "DISTRIBUTED" ? finalEvent?.maxScore ?? 0 : 0,
    previousScore: sum(modules.filter(module => module.number < modules.length).flatMap(module => module.events)), finalEventId: finalEvent?.id,
    originalFinalScore: original, effectiveFinalPassed, sessionRequired: control === "DISTRIBUTED" && !effectiveFinalPassed,
    debts: remaining.map(event => ({ id: event.id, title: event.title, state: completion(event) })), missing: missing.length,
    modules: modules.map(module => ({ id: module.id, number: module.number, score: sum(module.events), max: module.seminarMax + module.workMax + module.controlMax, debts: conditions(module.events).problems })) };
}
export type BrsCalculation = ReturnType<typeof calculateBrs>;
