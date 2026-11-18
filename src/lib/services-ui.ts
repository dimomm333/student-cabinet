import type { ServiceConfig } from "./services-catalog";
import { clearRecovery } from "./services-recovery";
export const serviceStatusLabels = { DRAFT: "Черновик", SUBMITTED: "Подано", IN_REVIEW: "На рассмотрении", CLARIFICATION_REQUIRED: "Требуется уточнение", IN_PROGRESS: "В работе", COMPLETED: "Исполнено", REJECTED: "Отказано" } as const;
export type ServiceStatus = keyof typeof serviceStatusLabels;
export type CatalogService = ServiceConfig & { score: number; enabled: boolean; available: boolean; eligibility?: "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN"; processingDepartmentId: string | null };
export type RequestRow = { id: string; serviceCode: string; schemaVersion: number; status: ServiceStatus; version: number; createdAt: string; submittedAt: string | null; updatedAt: string };
export type ServiceDocumentView = { id: string; name: string; slot: string; kind: string; size: number; removedAt: string | null; createdAt: string };
export type HistoryView = { id: string; actorName: string; action: string; text: string | null; snapshotJson: string | null; createdAt: string };
export type RequestDetail = RequestRow & { eligibility?: "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN"; config: ServiceConfig; latestClarification: { text: string | null } | null; permissions: { readFiles: boolean; student: boolean }; fields: Record<string, string | number>; profileSnapshot: Record<string, unknown> | null; profilePreview: { values: Record<string, unknown>; confirmationHash: string; correctionService: string } | null; clarification: { fields: string[]; slots: string[] } | null; documents: ServiceDocumentView[]; history: HistoryView[]; historyHasMore: boolean; documentsHasMore: boolean; resultText: string | null; completedAt: string | null; completedBy: string | null };
export const serviceDate = (value: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value)) : "—";
export const optionLabel = (value: string) => value === "KEEP" ? "Оставить предыдущую фотографию" : value === "NEW" ? "Загрузить новую фотографию" : value;
export type ServiceDiagnostic = { stage: string; status: number; code: string; trace?: string };
export class ServiceApiError extends Error { constructor(message: string, public status: number, public diagnostic?: ServiceDiagnostic) { super(message); } }
function responseError(data: unknown, status: number, fallback: string, stage: string) {
  const body = data && typeof data === "object" ? data as { error?: unknown; diagnostic?: { stage?: unknown; code?: unknown; trace?: unknown } } : null;
  const safe = (value: unknown) => typeof value === "string" && /^[A-Z0-9_-]{1,40}$/i.test(value) ? value : "";
  const diagnostic = body?.diagnostic;
  const detail = { stage: safe(diagnostic?.stage) || stage, status, code: safe(diagnostic?.code) || "RESPONSE", trace: safe(diagnostic?.trace) || undefined };
  return new ServiceApiError(typeof body?.error === "string" ? body.error : fallback, status, detail);
}
export async function serviceFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" }); }
  catch { throw new ServiceApiError("Нет связи с сервером. Введённые данные сохранены на экране; повторите действие.", 0); }
  const data = await response.json().catch(() => null);
  if (response.status === 401) clearRecovery();
  if (!response.ok) throw responseError(data, response.status, "Сервер временно недоступен. Повторите действие.", "READ_OR_COMMAND");
  return data as T;
}
export const serviceUrl = (params: Record<string, string>) => "/api/services?" + new URLSearchParams(params);

export function serviceUpload<T>(url: string, file: File, progress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url); xhr.timeout = 120000;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.upload.onload = () => progress(100);
    xhr.onload = () => {
      let data; try { data = JSON.parse(xhr.responseText); } catch { /* Invalid server response. */ }
      if (xhr.status === 401) clearRecovery();
      if (xhr.status >= 200 && xhr.status < 300 && typeof data?.id === "string" && Number.isSafeInteger(data?.version)) resolve(data as T);
      else reject(responseError(data, xhr.status, "Ответ загрузки не подтверждает сохранение. Проверьте список документов перед повтором.", "UPLOAD_RESPONSE"));
    };
    xhr.onerror = () => reject(new ServiceApiError("Нет связи с сервером. Проверьте список документов перед повтором.", 0, { stage: "XHR_NETWORK", status: 0, code: "NETWORK" }));
    xhr.onabort = () => reject(new ServiceApiError("Загрузка отменена. Проверьте список документов перед повтором.", 0, { stage: "XHR_ABORT", status: 0, code: "ABORT" }));
    xhr.ontimeout = () => reject(new ServiceApiError("Сервер не ответил вовремя. Проверьте список документов перед повтором.", 0, { stage: "XHR_TIMEOUT", status: 0, code: "TIMEOUT" }));
    xhr.send(file);
  });
}
