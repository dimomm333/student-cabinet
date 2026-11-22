import "server-only";
import type { Prisma, Role } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { deaneryStudentWhere } from "./deanery-repository";
import { ServiceError } from "./services-catalog";
import { localServiceStorage, prepareServiceFile } from "./services-storage";
import { parseDateOnly } from "./date-field";
import { portfolioByteLimit, portfolioCategories, portfolioFileLimit, portfolioFileTypes, type PortfolioItem } from "./portfolio";

type Actor = { id: string; role: Role };
type DB = Prisma.TransactionClient;
const itemSelect = {
  id: true, version: true, title: true, category: true, achievedOn: true, description: true, result: true,
  link: true, award: true, status: true,
  owner: { select: { name: true, studentProfile: { select: { group: { select: { code: true } } } } } },
  attachments: { select: { id: true, name: true, mime: true, size: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  decisions: { select: { reason: true }, orderBy: { version: "desc" }, take: 1 },
} satisfies Prisma.PortfolioAchievementSelect;

function toItem({ owner, decisions, achievedOn, ...item }: Prisma.PortfolioAchievementGetPayload<{ select: typeof itemSelect }>): PortfolioItem {
  return {
    ...item,
    achievedOn: achievedOn?.toISOString().slice(0, 10) ?? "",
    rejection: item.status === "REJECTED" ? decisions[0]?.reason ?? null : null,
    owner: owner.name,
    group: owner.studentProfile?.group?.code ?? null,
  };
}

function scope(actor: Actor): Prisma.PortfolioAchievementWhereInput {
  if (actor.role === "STUDENT") return { ownerId: actor.id, owner: { role: "STUDENT" } };
  if (actor.role === "DEANERY_STAFF") {
    return { status: "PENDING", owner: { studentProfile: deaneryStudentWhere(actor) } };
  }
  throw new ServiceError("Доступ запрещён.", 403);
}

export async function listPortfolio(actor: Actor) {
  const rows = await prisma.portfolioAchievement.findMany({
    where: scope(actor),
    select: itemSelect,
    orderBy: actor.role === "STUDENT" ? [{ achievedOn: "desc" }, { createdAt: "desc" }] : [{ submittedAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toItem);
}

const storage = () => localServiceStorage(process.env.PORTFOLIO_STORAGE_DIR ?? ".local/portfolio-documents");
export async function readPortfolioFile(actor: Actor, id: string) {
  const file = await prisma.portfolioAttachment.findFirst({
    where: { id, achievement: scope(actor) },
    select: { name: true, mime: true, storageKey: true },
  });
  if (!file) throw new ServiceError("Файл недоступен.", 404);
  return { ...file, bytes: await storage().get(file.storageKey) };
}

function textField(form: FormData, name: string, max: number) {
  const values = form.getAll(name);
  if (!values.length) return "";
  const [value] = values;
  if (values.length !== 1 || typeof value !== "string" || value.length > max) {
    throw new ServiceError("Проверьте поля формы и допустимую длину текста.");
  }
  return value.trim();
}

export function portfolioId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9]{20,32}$/.test(value)) throw new ServiceError("Некорректный идентификатор.");
  return value;
}

export function portfolioVersion(value: unknown) {
  const version = typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : value;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 2147483646) {
    throw new ServiceError("Некорректная версия записи.");
  }
  return version;
}

function parseFields(form: FormData) {
  const title = textField(form, "title", 160);
  const category = textField(form, "category", 20);
  const date = textField(form, "achievedOn", 10);
  const achievedOn = date ? parseDateOnly(date) : null;
  const link = textField(form, "link", 2048);
  const award = textField(form, "award", 3);
  if (!title || !Object.hasOwn(portfolioCategories, category)) throw new ServiceError("Укажите название и категорию.");
  if (date && !achievedOn) throw new ServiceError("Укажите существующую дату.");
  const url = link ? URL.parse(link) : null;
  if (link && (!url || !/^https?:\/\//i.test(link) || url.username || url.password)) {
    throw new ServiceError("Укажите ссылку, начинающуюся с https:// или http://.");
  }
  return {
    title, category: category as keyof typeof portfolioCategories, achievedOn, link: url?.href ?? null,
    description: textField(form, "description", 4000) || null,
    result: textField(form, "result", 500) || null,
    award: award === "on",
  };
}

async function removeBlobs(keys: string[]) {
  for (const key of keys) {
    try { await storage().remove(key); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        console.error("portfolio.storage_cleanup_failed");
      }
    }
  }
}

function conflict(): never {
  throw new ServiceError("Запись уже изменилась. Обновите страницу и повторите действие.", 409);
}

async function current(db: DB, actor: Actor, id: string, version: number) {
  const row = await db.portfolioAchievement.findFirst({ where: { id, ...scope(actor) }, include: { attachments: true } });
  if (!row) throw new ServiceError("Достижение недоступно.", 404);
  if (row.version !== version) conflict();
  return row;
}

export async function savePortfolio(actor: Actor, form: FormData) {
  if (actor.role !== "STUDENT") throw new ServiceError("Доступ запрещён.", 403);
  const fields = parseFields(form);
  const rawId = textField(form, "id", 32);
  const id = rawId ? portfolioId(rawId) : null;
  const version = id ? portfolioVersion(textField(form, "version", 10)) : 0;
  const removedIds = new Set(form.getAll("remove").map(portfolioId));
  const files = form.getAll("files");
  if (files.length > portfolioFileLimit || removedIds.size > portfolioFileLimit || (!id && removedIds.size)) {
    throw new ServiceError("Проверьте список вложений.");
  }
  if (id) await current(prisma, actor, id, version);
  const staged: { storageKey: string; name: string; mime: string; size: number }[] = [];

  try {
    for (const file of files) {
      if (typeof file === "string" || !portfolioFileTypes.includes(file.type)) {
        throw new ServiceError("Допустимы PDF, JPEG, PNG и WebP.", 415);
      }
      const prepared = await prepareServiceFile(Buffer.from(await file.arrayBuffer()), file.name, file.type, "portfolio");
      await storage().put(prepared.key, prepared.bytes);
      staged.push({ storageKey: prepared.key, name: prepared.name, mime: prepared.mime, size: prepared.size });
    }

    const result = await prisma.$transaction(async db => {
      if (!await db.user.findFirst({ where: { id: actor.id, role: "STUDENT" }, select: { id: true } })) {
        throw new ServiceError("Доступ запрещён.", 403);
      }
      const previous = id ? await current(db, actor, id, version) : null;
      const removed = previous?.attachments.filter(file => removedIds.has(file.id)) ?? [];
      const kept = previous?.attachments.filter(file => !removedIds.has(file.id)) ?? [];
      if (removed.length !== removedIds.size) throw new ServiceError("Вложение не найдено.", 404);
      const remaining = [...kept, ...staged];
      if (remaining.length > portfolioFileLimit || remaining.reduce((sum, file) => sum + file.size, 0) > portfolioByteLimit) {
        throw new ServiceError("На достижение допускается до 8 файлов общим размером до 32 МиБ.", 413);
      }
      if (!previous) {
        const item = await db.portfolioAchievement.create({
          data: { ownerId: actor.id, ...fields, attachments: { create: staged } },
          select: itemSelect,
        });
        return { item, removed };
      }
      const changed = Boolean(staged.length || removed.length) || previous.achievedOn?.getTime() !== fields.achievedOn?.getTime()
        || previous.title !== fields.title || previous.category !== fields.category || previous.description !== fields.description
        || previous.result !== fields.result || previous.link !== fields.link || previous.award !== fields.award;
      if (changed) {
        const updated = await db.portfolioAchievement.updateMany({
          where: { id: previous.id, version, ...scope(actor) },
          data: { ...fields, status: "SELF_ADDED", submittedAt: null, version: { increment: 1 } },
        });
        if (!updated.count) conflict();
        await db.portfolioAttachment.deleteMany({ where: { achievementId: previous.id, id: { in: [...removedIds] } } });
        if (staged.length) await db.portfolioAttachment.createMany({ data: staged.map(file => ({ ...file, achievementId: previous.id })) });
      }
      const item = await db.portfolioAchievement.findUniqueOrThrow({ where: { id: previous.id }, select: itemSelect });
      return { item, removed };
    });
    await removeBlobs(result.removed.map(file => file.storageKey));
    return toItem(result.item);
  } catch (error) {
    // A failed response can follow a successful commit. Keep referenced blobs.
    if (staged.length) {
      try {
        const keys = staged.map(file => file.storageKey);
        const linked = await prisma.portfolioAttachment.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } });
        const liveKeys = new Set(linked.map(file => file.storageKey));
        await removeBlobs(keys.filter(key => !liveKeys.has(key)));
      } catch { console.error("portfolio.storage_cleanup_failed"); }
    }
    throw error;
  }
}

export async function changePortfolio(actor: Actor, command: Record<string, unknown>) {
  const id = portfolioId(command.id);
  const version = portfolioVersion(command.version);
  const operation = command.operation;
  if (operation === "delete" || operation === "submit") {
    if (actor.role !== "STUDENT") throw new ServiceError("Доступ запрещён.", 403);
    if (operation === "delete") {
      const keys = await prisma.$transaction(async db => {
        const row = await current(db, actor, id, version);
        const deleted = await db.portfolioAchievement.deleteMany({ where: { id, version, ...scope(actor) } });
        if (!deleted.count) conflict();
        return row.attachments.map(file => file.storageKey);
      });
      await removeBlobs(keys);
      return null;
    }
    return prisma.$transaction(async db => {
      await current(db, actor, id, version);
      const changed = await db.portfolioAchievement.updateMany({
        where: { id, version, ...scope(actor), status: { in: ["SELF_ADDED", "REJECTED"] } },
        data: { status: "PENDING", submittedAt: new Date(), version: { increment: 1 } },
      });
      if (!changed.count) conflict();
      return toItem(await db.portfolioAchievement.findUniqueOrThrow({ where: { id }, select: itemSelect }));
    });
  }

  if (operation !== "review") throw new ServiceError("Неизвестное действие.");
  if (actor.role !== "DEANERY_STAFF") throw new ServiceError("Доступ запрещён.", 403);
  const { verdict } = command;
  if (verdict !== "CONFIRMED" && verdict !== "REJECTED") throw new ServiceError("Выберите решение.");
  const reason = typeof command.reason === "string" ? command.reason.trim() : "";
  if (verdict === "REJECTED" && (!reason || reason.length > 500)) {
    throw new ServiceError("Укажите причину отклонения длиной до 500 символов.");
  }
  await prisma.$transaction(async db => {
    await current(db, actor, id, version);
    const changed = await db.portfolioAchievement.updateMany({
      where: { id, version, ...scope(actor) },
      data: { status: verdict, version: { increment: 1 } },
    });
    if (!changed.count) conflict();
    await db.portfolioDecision.create({
      data: { achievementId: id, reviewerId: actor.id, version, verdict, reason: verdict === "REJECTED" ? reason : null },
    });
  });
  return null;
}
