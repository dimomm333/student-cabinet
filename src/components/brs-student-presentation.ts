import type { BrsWorkspace } from "@/lib/brs-repository";

type Course = BrsWorkspace["overview"][number];
export type AcademicAppearance = "complete" | "failed" | "pending";
export const academicLabels = { complete: "Обязательные работы выполнены, результаты выставлены", failed: "Есть долги по обязательным работам", pending: "Обучение продолжается или недостаточно данных" };
export const academicSymbols = { complete: "✓", failed: "!", pending: "…" };

// Presentation of the existing calculation only; no new academic criteria or scores.
export function moduleAppearance(course: Course, moduleId: string): AcademicAppearance {
  const calculation = course.calculation.modules.find(item => item.id === moduleId)!;
  return calculation.academicStatus === "DEBT" ? "failed" : calculation.academicStatus === "COMPLETE" ? "complete" : "pending";
}
export function semesterAppearance(course: Course): AcademicAppearance {
  return course.calculation.semesterStatus === "DEBT" ? "failed" : course.calculation.semesterStatus === "COMPLETE" ? "complete" : "pending";
}
export function shortSubmission(event: Course["modules"][number]["events"][number], condition?: Course["calculation"]["workStates"][string]) {
  if (condition?.coveredByAttempt) return "Учтена сессионная замена";
  if (condition?.category === "DEBT") return condition.required ? "Есть задолженность" : "Работа не выполнена успешно";
  if (condition?.category === "UPCOMING") return "Предстоит";
  if (condition?.category === "WAITING") return "Ожидается оценивание / подтверждение";
  const labels: Record<string, string> = { "Сдано досрочно": "досрочно", "Сдано вовремя": "вовремя", "Сдано с опозданием": "с опозданием", "Не сдано": "не сдано" };
  const label = labels[event.status] ?? "";
  return event.score === null && event.status !== "Не сдано" ? [label, "ещё не оценено"].filter(Boolean).join(" · ") : label;
}
