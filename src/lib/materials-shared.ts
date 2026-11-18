export const materialCategories = { LECTURES: "Лекции", PRACTICE: "Практики", LABS: "Лабораторные", OTHER: "Прочее" } as const;
export type MaterialCategory = keyof typeof materialCategories;
export class MaterialError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export function materialText(value: unknown, max = 200, required = true): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value.replace(/[\r\n\t]/g, "")) || (required && !value.trim())) throw new MaterialError(`Укажите текст от ${required ? 1 : 0} до ${max} символов.`);
  return value.trim();
}
// The teacher's punctuation is part of the title; never strip filename suffixes
// heuristically from existing titles, which have no provenance marker.
export function materialTitle(value: unknown, filename?: string | null): string {
  const title = materialText(value ?? "", 200, false);
  return title || materialText(filename?.replace(/\.[^.]+$/u, "").slice(0, 200) ?? "");
}
export function materialUrl(value: unknown) {
  const text = materialText(value, 2048);
  let url: URL; try { url = new URL(text); } catch { throw new MaterialError("Укажите полный адрес http:// или https://."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020\\]/.test(text)) throw new MaterialError("Допустимы только обычные ссылки HTTP/HTTPS без пароля.");
  return url.href;
}
export type MaterialCourse = { disciplineId: string; termId: string; title: string; term: string; year: string; startsOn: string; endsOn: string; teachers: string[]; groups: { id: string; code: string }[]; count: number; editable: boolean };
export type MaterialItem = { id: string; title: string; description: string; category: string; folderId: string | null; author: { name: string }; status: string; version: number; url: string | null; createdAt: string; updatedAt: string; publishedAt: string | null; file: { name: string; mime: string; size: number } | null; targets: { group: { id: string; code: string } }[]; editable: boolean };
export type MaterialFolderItem = { id: string; name: string; category: string; parentId: string | null; version: number; editable: boolean };
export type MaterialsData = { courses: MaterialCourse[]; items: MaterialItem[]; folders: MaterialFolderItem[]; total: number; page: number; maxFileBytes: number };
