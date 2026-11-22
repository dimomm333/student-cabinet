import type { PrismaClient } from "../generated/prisma/client.ts";
import { officialHttpUrl } from "./useful-catalog.ts";

export const usefulSelect = {
  id: true, parentId: true, title: true, description: true, status: true, kind: true, sortOrder: true,
  officialUrl: true, academicDepartment: { select: { name: true } },
} as const;

export class UsefulError extends Error {}

export async function saveUsefulEntry(db: PrismaClient, id: string | null, form: FormData) {
  function field(name: string, max: number) {
    const value = form.get(name) ?? "";
    if (typeof value !== "string" || value.length > max) throw new UsefulError("Проверьте длину заполненных полей.");
    return value.trim();
  }

  const title = field("title", 160);
  const description = field("description", 500);
  const body = field("body", 12000);
  const contacts = field("contacts", 1000);
  const location = field("location", 500);
  const parentId = field("parentId", 64) || null;
  const academicDepartmentId = field("academicDepartmentId", 64) || null;
  const kind = field("kind", 20);
  const status = field("status", 20);
  const sortOrder = Number(field("sortOrder", 10));
  const rawUrl = field("officialUrl", 2048);
  const officialUrl = rawUrl ? officialHttpUrl(rawUrl) : null;

  if (!title || !Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100000) {
    throw new UsefulError("Укажите название и целое число от −100000 до 100000 для порядка.");
  }
  if (kind !== "DIRECTORY" && kind !== "ARTICLE" && kind !== "EXTERNAL") throw new UsefulError("Выберите тип записи.");
  if (status !== "DRAFT" && status !== "PUBLISHED" && status !== "ARCHIVED") throw new UsefulError("Выберите состояние публикации.");
  if (kind === "ARTICLE" && !body) throw new UsefulError("Добавьте текст статьи.");
  if (rawUrl && !officialUrl) throw new UsefulError("Введите полный адрес HTTP или HTTPS без логина и пароля.");
  if (!parentId && kind !== "DIRECTORY") throw new UsefulError("Выберите родительский раздел для материала.");
  if (academicDepartmentId && kind !== "DIRECTORY") throw new UsefulError("Связь с учебным подразделением доступна для справочника.");

  return db.$transaction(async tx => {
    const entries = await tx.usefulEntry.findMany({ select: { id: true, parentId: true, kind: true, status: true } });
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const current = id ? byId.get(id) : undefined;
    if (id && !current) throw new UsefulError("Запись не найдена.");

    const seen = new Set(id ? [id] : []);
    let ancestor = parentId;
    while (ancestor) {
      if (seen.has(ancestor)) throw new UsefulError("Запись нельзя перенести внутрь её собственной ветки.");
      const parent = byId.get(ancestor);
      if (parent?.kind !== "DIRECTORY") throw new UsefulError("В качестве родителя выберите справочник.");
      seen.add(ancestor);
      ancestor = parent.parentId;
    }

    const hasChildren = Boolean(id && entries.some(entry => entry.parentId === id));
    if (hasChildren && kind !== "DIRECTORY") throw new UsefulError("Сначала переместите дочерние записи в другой справочник.");
    if (hasChildren && status === "ARCHIVED" && current?.status !== "ARCHIVED" && form.get("confirmArchive") !== "yes") {
      throw new UsefulError("Подтвердите архивирование ветки. Вложенные карточки будут скрыты для студентов.");
    }
    if (academicDepartmentId && !await tx.academicDepartment.findUnique({ where: { id: academicDepartmentId }, select: { id: true } })) {
      throw new UsefulError("Учебное подразделение не найдено.");
    }
    const data = { title, description, body, contacts, location, parentId, academicDepartmentId, kind, status, sortOrder, officialUrl } as const;
    const select = { id: true };
    return id ? tx.usefulEntry.update({ where: { id }, data, select }) : tx.usefulEntry.create({ data, select });
  }, { isolationLevel: "Serializable" });
}
