import type { BrsWorkspace } from "@/lib/brs-repository";

type Course = BrsWorkspace["overview"][number];
export type AcademicAppearance = "complete" | "failed" | "pending";
export const academicLabels = { complete: "Обязательные работы выполнены, результаты выставлены", failed: "Есть долги по обязательным работам", pending: "Обучение продолжается или недостаточно данных" };
export const academicSymbols = { complete: "✓", failed: "!", pending: "…" };

// Presentation of the existing calculation only; no new academic criteria or scores.
export function moduleAppearance(course: Course, moduleId: string): AcademicAppearance {
  const brsModule = course.modules.find(item => item.id === moduleId)!;
  const calculation = course.calculation.modules.find(item => item.id === moduleId)!;
  if (course.calculation.debts.some(debt => debt.state === "FAILED" && brsModule.events.some(event => event.id === debt.id))) return "failed";
  const unknown = brsModule.events.some(event => event.score === null && !(course.control === "DISTRIBUTED" && event.id === course.calculation.finalEventId && course.calculation.bestAttemptId));
  return calculation.complete && !calculation.seminarMissing && !unknown ? "complete" : "pending";
}
export function semesterAppearance(course: Course): AcademicAppearance {
  const states = course.modules.map(module => moduleAppearance(course, module.id));
  return states.includes("failed") ? "failed" : states.length && states.every(state => state === "complete") ? "complete" : "pending";
}
export function shortSubmission(event: Course["modules"][number]["events"][number]) {
  const labels: Record<string, string> = { "Сдано досрочно": "досрочно", "Сдано вовремя": "вовремя", "Сдано с опозданием": "с опозданием", "Не сдано": "не сдано" };
  const label = labels[event.status] ?? "";
  return event.score === null && event.status !== "Не сдано" ? [label, "ещё не оценено"].filter(Boolean).join(" · ") : label;
}
