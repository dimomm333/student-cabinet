import type { ServiceConfig } from "./services-catalog";
export const serviceStatusLabels = { DRAFT: "Черновик", SUBMITTED: "Подано", IN_REVIEW: "На рассмотрении", CLARIFICATION_REQUIRED: "Требуется уточнение", IN_PROGRESS: "В работе", COMPLETED: "Исполнено", REJECTED: "Отказано" } as const;
export type ServiceStatus = keyof typeof serviceStatusLabels;
export type CatalogService = ServiceConfig & { enabled: boolean; available: boolean; processingDepartmentId: string | null };
export type RequestRow = { id: string; serviceCode: string; schemaVersion: number; status: ServiceStatus; version: number; createdAt: string; submittedAt: string | null; updatedAt: string };
export type ServiceDocumentView = { id: string; name: string; slot: string; kind: string; size: number; removedAt: string | null; createdAt: string };
export type HistoryView = { id: string; actorName: string; action: string; text: string | null; snapshotJson: string | null; createdAt: string };
export type RequestDetail = RequestRow & { config: ServiceConfig; latestClarification: { text: string | null } | null; permissions: { readFiles: boolean; student: boolean }; fields: Record<string, string | number>; profileSnapshot: Record<string, unknown> | null; profilePreview: { values: Record<string, unknown>; confirmationHash: string; correctionService: string } | null; clarification: { fields: string[]; slots: string[] } | null; documents: ServiceDocumentView[]; history: HistoryView[]; resultText: string | null; completedAt: string | null; completedBy: string | null };
export const serviceDate = (value: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value)) : "—";
export const optionLabel = (value: string) => value === "KEEP" ? "Оставить предыдущую фотографию" : value === "NEW" ? "Загрузить новую фотографию" : value;
export class ServiceApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function serviceFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" }); }
  catch { throw new ServiceApiError("Нет связи с сервером. Введённые данные сохранены на экране; повторите действие.", 0); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ServiceApiError(data?.error ?? "Сервер временно недоступен. Повторите действие.", response.status);
  return data as T;
}
export const serviceUrl = (params: Record<string, string>) => "/api/services?" + new URLSearchParams(params);
