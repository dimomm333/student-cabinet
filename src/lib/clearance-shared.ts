export const clearanceReasons = { GRADUATION: "Завершение обучения", WITHDRAWAL: "Отчисление", TRANSFER: "Перевод в другую организацию" } as const;
export const clearanceStatuses = { DRAFT: "Черновик", IN_PROGRESS: "Выполняется", ACTION_REQUIRED: "Требуются действия студента", READY_FOR_FINAL_REVIEW: "Ожидает итоговой проверки", COMPLETED: "Завершён", CANCELLED: "Отменён" } as const;
export const clearanceStepStatuses = { PENDING: "Ожидает проверки", IN_REVIEW: "На рассмотрении", ACTION_REQUIRED: "Нужно устранить замечание", APPROVED: "Согласовано", NOT_APPLICABLE: "Не требуется" } as const;
export const clearanceRules = { ALWAYS: "Обязательная", DORMITORY: "Проживание в общежитии", PAID: "Договорное обучение", EQUIPMENT: "Выдача оборудования", GRADUATION: "Выпускная процедура", MANUAL: "Уточнить вручную", FINAL: "Итоговая проверка деканата" } as const;
export class ClearanceError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export type ClearanceCommand = { operation: string; requestId: string; [key: string]: unknown };
export const clearanceTerminal = (status: string) => status === "COMPLETED" || status === "CANCELLED";
export const clearanceSettled = (status: string) => status === "APPROVED" || status === "NOT_APPLICABLE";
export function clearanceText(value: unknown, label: string, max = 2000, optional = false): string {
  if (optional && (value == null || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b-\u001f]/.test(value)) throw new ClearanceError(`${label}: укажите текст до ${max} символов.`);
  return value.trim();
}
export function clearanceInt(value: unknown, min = 1, max = 2147483647) { if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new ClearanceError("Некорректное числовое значение."); return Number(value); }
export const clearanceDateBounds = { min: "2000-01-01", max: "2100-12-31" };
export function clearanceDate(value: unknown, optional = true): Date | null {
  if (optional && (value == null || value === "")) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ClearanceError("Укажите дату в формате ГГГГ-ММ-ДД.");
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value || value < clearanceDateBounds.min || value > clearanceDateBounds.max) throw new ClearanceError("Некорректная дата.");
  return date;
}
const fields: Record<string, string[]> = {
  CREATE: ["studentId", "templateId", "basisNote", "startsOn", "plannedOn", "orderNumber", "orderDate", "serviceRequestId"],
  OPEN: [], COMPLETE: [], CANCEL: ["text", "confirmed"], REMIND: [],
  START: ["stepId"], APPROVE: ["stepId", "text"],
  REMARK: ["stepId", "category", "description", "requiredAction", "contact", "dueOn", "amountMinor"],
  REPLY: ["stepId", "remarkId", "text"], REJECT_REPLY: ["stepId", "remarkId", "text"],
  APPLICABILITY: ["stepId", "required", "text", "confirmed"], ADD_STEP: ["departmentId", "text"],
  DEPARTMENT: ["code", "name", "description", "contact", "active", "sortOrder", "text"],
  TEMPLATE: ["name", "reason", "active", "rules", "text"], GRANT: ["userId", "departmentId", "active", "text"],
  INVALIDATE: ["text", "confirmed"],
};
export function parseClearanceCommand(value: unknown): ClearanceCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClearanceError("Некорректная команда.");
  const c = value as ClearanceCommand;
  if (!Object.hasOwn(fields, c.operation) || typeof c.requestId !== "string" || !/^[\w-]{16,100}$/.test(c.requestId)) throw new ClearanceError("Некорректная операция или ключ запроса.");
  if (Object.keys(c).some(k => !["operation", "requestId", "id", "version", ...fields[c.operation]].includes(k))) throw new ClearanceError("Команда содержит недопустимые поля.");
  for (const k of ["id", "studentId", "templateId", "stepId", "remarkId", "departmentId", "userId", "serviceRequestId"]) if (c[k] != null && !(k === "serviceRequestId" && c[k] === "") && (typeof c[k] !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(c[k] as string))) throw new ClearanceError("Некорректный идентификатор.");
  return c;
}
