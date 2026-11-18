import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { emitNotification } from "./notifications-repository.ts";
import { materialActor, materialScope, materialGroupAncestors, materialStudentGroups, materialTeachingGroups, requireMaterialTeaching, type MaterialActor, type MaterialDB } from "./materials-permissions.ts";
import { MaterialError, materialCategories, materialText, materialTitle, materialUrl, type MaterialsData, type MaterialCourse } from "./materials-shared.ts";
import { maxMaterialBytes, type MaterialBlob } from "./materials-storage.ts";

export type MaterialCommand = { operation: string; requestId: string; disciplineId: string; termId: string; id?: string; version?: number; title?: string; description?: string; category?: string; folderId?: string | null; groupIds?: string[]; url?: string; name?: string; parentId?: string | null; confirmed?: boolean; items?: { id: string; version: number }[] };
const allowedFields = new Set("operation requestId disciplineId termId id version title description category folderId groupIds url name parentId confirmed items".split(" "));
export function parseMaterialCommand(value: unknown): MaterialCommand {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowedFields.has(k))) throw new MaterialError("Некорректная команда.");
  const c = value as MaterialCommand;
  for (const field of ["operation", "requestId", "disciplineId", "termId"] as const) if (typeof c[field] !== "string" || !c[field] || c[field].length > 120) throw new MaterialError("Не указан ключ команды, дисциплина или семестр.");
  for (const field of ["id", "folderId", "parentId"] as const) if (c[field] !== undefined && c[field] !== null && (typeof c[field] !== "string" || c[field]!.length > 120)) throw new MaterialError("Некорректный идентификатор.");
  if (c.version !== undefined && (!Number.isSafeInteger(c.version) || c.version < 1)) throw new MaterialError("Некорректная версия.");
  if (c.items !== undefined && (!Array.isArray(c.items) || !c.items.length || c.items.length > 100 || c.items.some(i => !i || typeof i.id !== "string" || i.id.length > 120 || !Number.isSafeInteger(i.version) || i.version < 1 || Object.keys(i).some(k => !["id", "version"].includes(k))) || new Set(c.items.map(i => i.id)).size !== c.items.length)) throw new MaterialError("Выберите от 1 до 100 разных материалов.");
  if (c.groupIds !== undefined && (!Array.isArray(c.groupIds) || !c.groupIds.length || c.groupIds.length > 100 || c.groupIds.some(id => typeof id !== "string" || !id || id.length > 120))) throw new MaterialError("Выберите от 1 до 100 целевых групп.");
  return c;
}
function stable(value: unknown): string { if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"; if (value && typeof value === "object") return "{" + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ":" + stable(v)).join(",") + "}"; return JSON.stringify(value); }
const conflict = () => { throw new MaterialError("Материал или папка изменены в другом окне. Обновите список и повторите действие.", 409); };
function category(value: unknown) { if (typeof value !== "string" || !Object.hasOwn(materialCategories, value)) throw new MaterialError("Выберите категорию."); return value; }
async function folderFor(db: MaterialDB, userId: string, c: MaterialCommand, id?: string | null, cat?: string) {
  if (!id) return null;
  const folder = await db.materialFolder.findFirst({ where: { id, authorId: userId, disciplineId: c.disciplineId, termId: c.termId, ...(cat ? { category: cat } : {}) } });
  if (!folder) throw new MaterialError("Папка недоступна или находится в другой категории.", 404);
  return folder;
}
export async function executeMaterialCommand(db: PrismaClient, actor: MaterialActor, input: MaterialCommand, file?: MaterialBlob) {
  const c = parseMaterialCommand(input);
  const hash = createHash("sha256").update(stable({ command: c, file: file ? { name: file.name, mime: file.mime, sha256: file.sha256, size: file.size } : null })).digest("hex");
  return db.$transaction(async tx => {
    // First write serializes SQLite mutations, including folder graph changes.
    await tx.materialWriteState.upsert({ where: { id: "materials" }, create: { id: "materials", version: 1 }, update: { version: { increment: 1 } } });
    const user = await materialActor(tx, actor);
    const allowed = await requireMaterialTeaching(tx, user, c.disciplineId, c.termId);
    const prior = await tx.materialReceipt.findUnique({ where: { actorId_key: { actorId: user.id, key: c.requestId } } });
    if (prior) { if (prior.hash !== hash) throw new MaterialError("Ключ команды уже использован с другими данными.", 409); return JSON.parse(prior.resultJson) as { id: string }; }
    const audit = async (action: string, objectId: string) => tx.materialAudit.create({ data: { actorId: user.id, action, objectId } });
    let result: { id: string };
    if (["CREATE_FOLDER", "EDIT_FOLDER", "DELETE_FOLDER"].includes(c.operation)) {
      const current = c.operation === "CREATE_FOLDER" ? null : await folderFor(tx, user.id, c, c.id);
      if (c.operation !== "CREATE_FOLDER" && (!current || c.version !== current.version)) conflict();
      const cat = category(c.category ?? current?.category);
      const parent = await folderFor(tx, user.id, c, c.parentId, cat);
      if (parent) {
        const visited = new Set<string>(current ? [current.id] : []); let cursor: Awaited<ReturnType<typeof folderFor>> = parent;
        for (let depth = 0; cursor; depth++) { if (visited.has(cursor.id) || depth > 30) throw new MaterialError("Циклическое вложение или слишком глубокое дерево папок."); visited.add(cursor.id); cursor = await folderFor(tx, user.id, c, cursor.parentId, cat); }
      }
      if (c.operation === "DELETE_FOLDER") {
        if (c.confirmed !== true) throw new MaterialError("Подтвердите удаление папки.");
        if (await tx.materialFolder.count({ where: { parentId: current!.id } }) || await tx.learningMaterial.count({ where: { folderId: current!.id } })) throw new MaterialError("Папка не пуста. Сначала переместите материалы и подпапки. Содержимое не удалено.", 409);
        await tx.materialFolder.delete({ where: { id: current!.id } }); result = { id: current!.id };
      } else {
        const data = { name: materialText(c.name), category: cat, parentId: parent?.id ?? null };
        if (current && current.category !== cat) throw new MaterialError("Категория папки сохраняется. Переместите материалы отдельно.");
        const folder = current ? await tx.materialFolder.update({ where: { id: current.id, version: c.version }, data: { ...data, version: { increment: 1 } } }) : await tx.materialFolder.create({ data: { ...data, authorId: user.id, disciplineId: c.disciplineId, termId: c.termId } });
        result = { id: folder.id };
      }
      await audit(c.operation, result.id);
    } else if (["CREATE_LINK", "UPLOAD"].includes(c.operation)) {
      if (!c.groupIds?.length) throw new MaterialError("Выберите целевые группы.");
      await requireMaterialTeaching(tx, user, c.disciplineId, c.termId, c.groupIds);
      const cat = category(c.category), folder = await folderFor(tx, user.id, c, c.folderId, cat);
      if (c.operation === "UPLOAD" && !file) throw new MaterialError("Файл не получен.");
      const physical = c.operation === "UPLOAD" ? await tx.materialFile.create({ data: file! }) : null;
      const title = materialTitle(c.title, physical?.name);
      const material = await tx.learningMaterial.create({ data: { disciplineId: c.disciplineId, termId: c.termId, authorId: user.id, title, searchTitle: title.toLocaleLowerCase("ru"), description: materialText(c.description ?? "", 4000, false), category: cat, folderId: folder?.id, url: physical ? null : materialUrl(c.url), fileId: physical?.id, targets: { create: [...new Set(c.groupIds)].map(groupId => ({ groupId })) } } });
      await audit(c.operation, material.id); result = { id: material.id };
    } else if (["EDIT", "DELETE", "PUBLISH", "UNPUBLISH"].includes(c.operation)) {
      const items = c.operation === "PUBLISH" ? c.items : [{ id: c.id ?? "", version: c.version ?? 0 }];
      if (!items?.length) throw new MaterialError("Выберите материалы для публикации.");
      const newlyPublished: string[] = [];
      for (const item of items) {
        const current = await tx.learningMaterial.findFirst({ where: { id: item.id, authorId: user.id, disciplineId: c.disciplineId, termId: c.termId, deletedAt: null }, include: { targets: true, file: { select: { name: true } } } });
        if (!current) throw new MaterialError("Материал недоступен.", 404);
        if (current.version !== item.version) conflict();
        // Losing even one target assignment freezes mutations until authority is restored.
        if (current.targets.some(t => !allowed.includes(t.groupId))) throw new MaterialError("Назначение на одну из групп отозвано. Изменение материала запрещено.", 403);
        if (c.operation === "DELETE" && c.confirmed !== true) throw new MaterialError("Подтвердите удаление материала.");
        if (c.operation === "EDIT") {
          if (!c.groupIds?.length) throw new MaterialError("Выберите целевые группы.");
          await requireMaterialTeaching(tx, user, c.disciplineId, c.termId, c.groupIds);
          const cat = category(c.category), folder = await folderFor(tx, user.id, c, c.folderId, cat);
          const title = materialTitle(c.title, current.file?.name);
          await tx.learningMaterial.update({ where: { id: current.id, version: item.version }, data: { title, searchTitle: title.toLocaleLowerCase("ru"), description: materialText(c.description ?? "", 4000, false), category: cat, folderId: folder?.id ?? null, ...(current.url ? { url: materialUrl(c.url) } : {}), version: { increment: 1 }, targets: { deleteMany: {}, create: [...new Set(c.groupIds)].map(groupId => ({ groupId })) } } });
        } else {
          if (c.operation === "PUBLISH" && !current.publishedAt) newlyPublished.push(current.id);
          await tx.learningMaterial.update({ where: { id: current.id, version: item.version }, data: { version: { increment: 1 }, ...(c.operation === "DELETE" ? { deletedAt: new Date(), folderId: null } : { status: c.operation === "PUBLISH" ? "PUBLISHED" : "DRAFT", ...(c.operation === "PUBLISH" && !current.publishedAt ? { publishedAt: new Date() } : {}) }) } });
        }
        await audit(c.operation, current.id);
      }
      if (newlyPublished.length) {
        const publication = await tx.materialPublication.create({ data: { items: { create: newlyPublished.map(materialId => ({ materialId })) } } });
        const materials = await tx.learningMaterial.findMany({ where: { id: { in: newlyPublished } }, include: { targets: true, discipline: true } });
        const students = await tx.user.findMany({ where: { role: "STUDENT", studentProfile: { groupId: { not: null } } }, select: { id: true, studentProfile: { select: { groupId: true } } } });
        const hierarchy = await tx.studyGroup.findMany({ select: { id: true, parentId: true } });
        const recipients = [];
        for (const student of students) {
          const groups = materialGroupAncestors(hierarchy, student.studentProfile?.groupId);
          const target = materials.find(m => m.targets.some(t => groups.includes(t.groupId)));
          if (target) recipients.push({ id: student.id, role: "STUDENT" as const, href: `/dashboard/materials?termId=${encodeURIComponent(c.termId)}&disciplineId=${encodeURIComponent(c.disciplineId)}&materialId=${target.id}` });
        }
        await emitNotification(tx, { source: "MATERIALS", sourceId: publication.id, sourceKey: `materials:${publication.id}`, type: "PUBLISHED", category: "STUDY", mandatory: false, title: `По дисциплине «${materials[0].discipline.title}» опубликованы новые учебные материалы`, body: "Откройте дисциплину, чтобы посмотреть и скачать материалы.", recipients });
      }
      result = { id: items[0].id };
    } else throw new MaterialError("Неизвестная операция.");
    await tx.materialReceipt.create({ data: { actorId: user.id, key: c.requestId, hash, resultJson: JSON.stringify(result) } });
    return result;
  }, { timeout: 30000 });
}

export async function listMaterials(db: PrismaClient, actor: MaterialActor, query: { termId?: string; disciplineId?: string; q?: string; page?: number; category?: string; folderId?: string; materialId?: string } = {}): Promise<MaterialsData> {
  if ((query.q?.length ?? 0) > 200 || !Number.isSafeInteger(query.page ?? 0) || (query.page ?? 0) < 0 || (query.page ?? 0) > 100000) throw new MaterialError("Некорректный поиск или страница.");
  return db.$transaction(async tx => {
    const user = await materialActor(tx, actor), scope = await materialScope(tx, user), studentGroups = user.role === "STUDENT" ? await materialStudentGroups(tx, user.id) : [];
    const assignments = await tx.teachingAssignment.findMany({ where: user.role === "TEACHER" ? { teacherId: user.id, isActive: true } : { groupId: { in: studentGroups }, isActive: true }, include: { discipline: true, term: true, teacher: { select: { name: true } } } });
    const plans = user.role === "STUDENT" ? await tx.brsPlan.findMany({ where: { groupId: { in: studentGroups }, publishedAt: { not: null } }, include: { discipline: true, term: true } }) : [];
    const records = await tx.learningMaterial.findMany({ where: scope, distinct: ["termId", "disciplineId"], select: { discipline: true, term: true } });
    const courses = new Map<string, MaterialCourse>();
    for (const record of [...assignments, ...plans, ...records]) {
      const key = record.term.id + ":" + record.discipline.id;
      if (courses.has(key)) continue;
      const { term, discipline } = record;
      const startYear = term.startsOn.getUTCFullYear() - (term.startsOn.getUTCMonth() < 7 ? 1 : 0);
      const groupIds = user.role === "TEACHER" ? await materialTeachingGroups(tx, user.id, discipline.id, term.id) : studentGroups;
      courses.set(key, { disciplineId: discipline.id, termId: term.id, title: discipline.title, term: term.name, year: `${startYear}/${startYear + 1}`, startsOn: term.startsOn.toISOString(), endsOn: term.endsOn.toISOString(), teachers: [...new Set(assignments.filter(a => a.termId === term.id && a.disciplineId === discipline.id).map(a => a.teacher.name))], groups: await tx.studyGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, code: true }, orderBy: { code: "asc" } }), count: await tx.learningMaterial.count({ where: { AND: [scope, { termId: term.id, disciplineId: discipline.id, status: "PUBLISHED" }] } }), editable: user.role === "TEACHER" && groupIds.length > 0 });
    }
    const now = Date.now(), active = (c: MaterialCourse) => Number(Date.parse(c.startsOn) <= now && Date.parse(c.endsOn) + 86400000 >= now);
    const courseList = [...courses.values()].sort((a,b) => active(b) - active(a) || b.startsOn.localeCompare(a.startsOn) || a.title.localeCompare(b.title, "ru"));
    if (!query.termId || !query.disciplineId) return { courses: courseList, items: [], folders: [], total: 0, page: 0, maxFileBytes: maxMaterialBytes() };
    const course = courses.get(query.termId + ":" + query.disciplineId);
    if (!course) throw new MaterialError("Дисциплина недоступна.", 404);
    const where = { AND: [scope, { termId: query.termId, disciplineId: query.disciplineId, ...(query.materialId ? { id: query.materialId } : { ...(query.q ? { searchTitle: { contains: query.q.toLocaleLowerCase("ru") } } : {}), ...(query.category ? { category: query.category } : {}), ...(query.folderId ? { folderId: query.folderId } : {}) }) }] };
    const items = await tx.learningMaterial.findMany({ where, include: { author: { select: { name: true } }, file: { select: { name: true, mime: true, size: true } }, targets: { include: { group: { select: { id: true, code: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page ?? 0) * 50, take: 50 });
    let folders = await tx.materialFolder.findMany({ where: { termId: query.termId, disciplineId: query.disciplineId, ...(user.role === "TEACHER" ? { authorId: user.id } : {}) }, orderBy: { name: "asc" } });
    if (user.role === "STUDENT") {
      const visible = new Set((await tx.learningMaterial.findMany({ where: { AND: [scope, { termId: query.termId, disciplineId: query.disciplineId }] }, select: { folderId: true } })).map(m => m.folderId).filter(Boolean));
      for (let changed = true; changed;) { changed = false; for (const f of folders) if (visible.has(f.id) && f.parentId && !visible.has(f.parentId)) { visible.add(f.parentId); changed = true; } }
      folders = folders.filter(f => visible.has(f.id));
    }
    const allowed = course.groups.map(g => g.id);
    return { courses: courseList, total: await tx.learningMaterial.count({ where }), page: query.page ?? 0, maxFileBytes: maxMaterialBytes(), folders: folders.map(f => ({ id: f.id, name: f.name, category: f.category, parentId: f.parentId, version: f.version, editable: course.editable })), items: items.map(m => ({ id: m.id, title: m.title, description: m.description, category: m.category, folderId: m.folderId, author: m.author, status: m.status, version: m.version, url: m.url, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString(), publishedAt: m.publishedAt?.toISOString() ?? null, file: m.file, targets: m.targets.map(t => ({ group: t.group })), editable: course.editable && m.targets.every(t => allowed.includes(t.groupId)) })) };
  }, { timeout: 30000 });
}
export async function downloadMaterial(db: PrismaClient, actor: MaterialActor, id: string) {
  return db.$transaction(async tx => {
    const user = await materialActor(tx, actor);
    const material = await tx.learningMaterial.findFirst({ where: { AND: [await materialScope(tx, user), { id }] }, include: { file: true } });
    if (!material?.file) throw new MaterialError("Файл недоступен.", 404);
    await tx.materialAudit.create({ data: { actorId: user.id, action: "DOWNLOAD", objectId: id } });
    return material.file;
  });
}
