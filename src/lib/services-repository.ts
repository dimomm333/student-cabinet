import "server-only";
import type { Prisma, PrismaClient, ServiceRequest } from "../generated/prisma/client.ts";
import { configFor, ServiceError, serviceCatalog, validateFields, validateDocuments, type ServiceConfig } from "./services-catalog.ts";
import { digest, type ServiceStorage } from "./services-storage.ts";
import { isSessionWithinLifetime } from "./session-policy.ts";

type DB = Prisma.TransactionClient;
export type ServiceActor = { id: string; sessionId: string };
export async function liveActor(db: DB, actor: ServiceActor) {
  const session = await db.session.findFirst({ where: { id: actor.sessionId, userId: actor.id }, include: { user: true } });
  if (!session || !isSessionWithinLifetime(session)) throw new ServiceError("Войдите в систему.", 401);
  return session.user;
}
export async function seedServices(db: PrismaClient) {
  for (const config of serviceCatalog) await db.serviceDefinition.upsert({ where: { code_version: { code: config.code, version: config.version } }, create: { code: config.code, version: config.version, configJson: JSON.stringify(config) }, update: {} });
  await db.serviceWriteState.upsert({ where: { id: "services" }, create: { id: "services" }, update: {} });
}
export async function processorScope(db: DB, actor: ServiceActor, files = false, military = false): Promise<Prisma.ServiceRequestWhereInput> {
  const user = await liveActor(db, actor);
  if (!["DEANERY_STAFF", "TECHNICAL_STAFF", "ADMIN"].includes(user.role)) return { id: { in: [] } };
  const grants = await db.serviceGrant.findMany({ where: { userId: user.id, active: true, ...(files ? { readFiles: true } : {}), ...(military ? { readMilitary: true } : {}), ...(user.role === "DEANERY_STAFF" ? { department: { deaneryAssignments: { some: { userId: user.id } } } } : {}) } });
  const valid = grants.filter(grant => Boolean(grant.serviceCode) !== Boolean(grant.category));
  if (!valid.length) return { id: { in: [] } };
  return { OR: valid.map(grant => ({ departmentId: grant.departmentId, ...(grant.serviceCode ? { serviceCode: grant.serviceCode } : { category: grant.category }), ...(grant.readMilitary ? {} : { AND: [{ serviceCode: { not: "military-change" } }] }), OR: [{ assigneeId: null }, { assigneeId: user.id }] })) };
}
export async function visibleRequest(db: DB, actor: ServiceActor, id: string, files = false) {
  const user = await liveActor(db, actor);
  const scope = user.role === "STUDENT" ? { ownerId: user.id } : { AND: [{ status: { not: "DRAFT" as const } }, await processorScope(db, actor, files)] };
  const request = await db.serviceRequest.findFirst({ where: { id, deletedAt: null, ...scope } });
  if (!request) throw new ServiceError("Заявление недоступно.", 404);
  return request;
}
export async function profileFor(db: DB, ownerId: string, config: ServiceConfig) {
  const user = await db.user.findUniqueOrThrow({ where: { id: ownerId }, select: { name: true, studentProfile: { include: { group: true } } } });
  const p = user.studentProfile, snapshot: Record<string, unknown> = {};
  for (const key of config.profile) {
    if (key === "name") snapshot.name = p?.lastName && p?.firstName ? [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ") : user.name;
    if (key === "group") snapshot.group = p?.group?.code ?? p?.groupName ?? null;
    if (key === "studentNumber") snapshot.studentNumber = p?.studentNumber ?? null;
    if (key === "program") snapshot.program = p?.group?.programme ?? p?.program ?? null;
    if (key === "military") {
      const record = await db.militaryRecord.findUnique({ where: { userId: ownerId }, select: { registrationStatus: true, office: true, documentType: true, documentNumber: true, verifiedAt: true } });
      snapshot.military = record;
    }
  }
  return { snapshot, hash: digest(JSON.stringify(snapshot)), sourceDepartmentId: p?.group?.departmentId ?? null };
}
export type ServiceCommand = {
  operation: "CREATE" | "SAVE" | "DELETE" | "SUBMIT" | "TRANSITION" | "COMMENT" | "UPLOAD" | "REMOVE_FILE";
  requestId: string; id?: string; version?: number; code?: string; fields?: unknown;
  confirmed?: boolean; confirmationHash?: string; status?: string; text?: string;
  clarificationFields?: string[]; clarificationSlots?: string[]; documentId?: string; slot?: string; kind?: string;
};
export type StagedFile = { key: string; name: string; mime: string; size: number; sha256: string };
const transitions: Record<string, string[]> = { SUBMITTED: ["IN_REVIEW"], IN_REVIEW: ["CLARIFICATION_REQUIRED", "IN_PROGRESS", "REJECTED"], IN_PROGRESS: ["CLARIFICATION_REQUIRED", "COMPLETED", "REJECTED"] };
function stable(value: unknown): string { if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"; if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v !== undefined).map(([k, v]) => JSON.stringify(k) + ":" + stable(v)).join(",") + "}"; return JSON.stringify(value); }
function message(text: unknown, required = false) {
  if (text === undefined && !required) return null;
  if (typeof text !== "string" || text.length > 4000 || (required && !text.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new ServiceError("Укажите понятный комментарий (до 4000 символов).");
  return text.trim() || null;
}
function editable(request: ServiceRequest, owner: boolean, slot?: string, fieldKeys?: string[]) {
  if (!owner || !["DRAFT", "CLARIFICATION_REQUIRED"].includes(request.status)) throw new ServiceError("Редактирование недоступно.", 409);
  if (request.status === "CLARIFICATION_REQUIRED") {
    const allowed = JSON.parse(request.clarificationJson!) as { fields: string[]; slots: string[] };
    if ((slot && !allowed.slots.includes(slot)) || fieldKeys?.some(key => !allowed.fields.includes(key))) throw new ServiceError("Изменение не входит в запрос уточнения.", 403);
  }
}
export async function executeServiceCommand(db: PrismaClient, actor: ServiceActor, command: ServiceCommand, file?: StagedFile) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(command.requestId ?? "")) throw new ServiceError("Нужен уникальный requestId (16–100 символов).");
  const hash = digest(stable({ command, file: file && { ...file, key: undefined } }));
  return db.$transaction(async tx => {
    // First statement takes the SQLite writer lock. Every command then sees live
    // grants, session, request version and receipt under the same transaction.
    await tx.serviceWriteState.update({ where: { id: "services" }, data: { version: { increment: 1 } } });
    const user = await liveActor(tx, actor);
    const old = await tx.serviceReceipt.findUnique({ where: { actorId_key: { actorId: user.id, key: command.requestId } } });
    if (old) {
      if (old.hash !== hash) throw new ServiceError("Ключ запроса уже использован с другими данными.", 409);
      const result = JSON.parse(old.resultJson) as { id: string; version: number; documentId?: string };
      if (command.operation === "DELETE") {
        if (user.role !== "STUDENT" || !await tx.serviceRequest.findFirst({ where: { id: result.id, ownerId: user.id, status: "DRAFT" } })) throw new ServiceError("Заявление недоступно.", 404);
      } else await visibleRequest(tx, actor, result.id, command.operation === "UPLOAD" || command.operation === "REMOVE_FILE");
      return { ...result, replayed: true };
    }
    let request: ServiceRequest;
    let documentId: string | undefined;
    let notify: string | undefined;
    let historyText: string | null = null;
    let snapshotJson: string | undefined;
    if (command.operation === "CREATE") {
      if (user.role !== "STUDENT") throw new ServiceError("Только студент создаёт заявления.", 403);
      const config = configFor(command.code ?? "");
      const definition = await tx.serviceDefinition.findUnique({ where: { code_version: { code: config.code, version: config.version } } });
      if (!definition?.enabled) throw new ServiceError("Услуга недоступна.", 409);
      if (await tx.serviceRequest.count({ where: { ownerId: user.id, status: "DRAFT", deletedAt: null } }) >= 50) throw new ServiceError("Не более 50 черновиков.", 409);
      request = await tx.serviceRequest.create({ data: { ownerId: user.id, serviceCode: config.code, schemaVersion: config.version, category: config.category, fieldsJson: JSON.stringify(validateFields(config, command.fields ?? {}, true)) } });
    } else {
      request = await visibleRequest(tx, actor, command.id ?? "", command.operation === "UPLOAD" || command.operation === "REMOVE_FILE");
      if (!Number.isSafeInteger(command.version) || request.version !== command.version) throw new ServiceError("Заявление изменено. Откройте актуальную версию.", 409);
      const owner = user.role === "STUDENT" && user.id === request.ownerId;
      const config = configFor(request.serviceCode, request.schemaVersion);
      const patch: Prisma.ServiceRequestUncheckedUpdateInput = { version: { increment: 1 } };
      switch (command.operation) {
        case "SAVE": {
          const fields = validateFields(config, command.fields, true);
          // Null/empty values explicitly clear fields; unknown keys were rejected above.
          editable(request, owner, undefined, Object.keys(command.fields as object));
          const merged = { ...JSON.parse(request.fieldsJson) };
          for (const key of Object.keys(command.fields as object)) { delete merged[key]; if (key in fields) merged[key] = fields[key]; }
          patch.fieldsJson = JSON.stringify(validateFields(config, merged, true));
          break;
        }
        case "DELETE":
          if (!owner || request.status !== "DRAFT") throw new ServiceError("Удаление недоступно.", 409);
          patch.deletedAt = new Date(); break;
        case "SUBMIT": {
          editable(request, owner);
          const definition = await tx.serviceDefinition.findUniqueOrThrow({ where: { code_version: { code: config.code, version: config.version } } });
          if (!definition.enabled) throw new ServiceError("Услуга отключена.", 409);
          const fields = validateFields(config, JSON.parse(request.fieldsJson), false);
          const docs = await tx.serviceDocument.findMany({ where: { requestId: request.id } });
          validateDocuments(config, fields, docs);
          const profile = await profileFor(tx, user.id, config);
          if (command.confirmed !== true || command.confirmationHash !== profile.hash) throw new ServiceError("Просмотрите и подтвердите актуальные сведения профиля. Для исправления используйте personal-change.", 409);
          if (!request.submittedAt) {
            if (!profile.sourceDepartmentId) throw new ServiceError("В профиле нет подтверждённого подразделения.", 409);
            const route = await tx.serviceRoute.findUnique({ where: { serviceCode_sourceDepartmentId: { serviceCode: config.code, sourceDepartmentId: profile.sourceDepartmentId } } });
            if (!route?.active) throw new ServiceError("Подразделение обработки ещё не настроено.", 409);
            patch.departmentId = route.departmentId;
            patch.profileJson = JSON.stringify(profile.snapshot);
            patch.confirmationHash = profile.hash;
            patch.submittedAt = new Date();
            patch.status = "SUBMITTED";
          } else {
            // The original official snapshot is immutable across clarification cycles.
            patch.status = "IN_REVIEW"; patch.clarificationJson = null;
          }
          snapshotJson = JSON.stringify({ fields, profile: request.profileJson ? JSON.parse(request.profileJson) : profile.snapshot, documents: docs.filter(doc => !doc.removedAt).map(doc => doc.id) });
          notify = request.submittedAt ? "RESUBMITTED" : "SUBMITTED";
          break;
        }
        case "TRANSITION": {
          if (owner || !(transitions[request.status] ?? []).includes(command.status ?? "")) throw new ServiceError("Переход статуса запрещён.", 409);
          const status = command.status as "IN_REVIEW" | "CLARIFICATION_REQUIRED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED";
          historyText = message(command.text, ["CLARIFICATION_REQUIRED", "COMPLETED", "REJECTED"].includes(status));
          if (status === "CLARIFICATION_REQUIRED") {
            const fields = command.clarificationFields ?? [], slots = command.clarificationSlots ?? [];
            if (!Array.isArray(fields) || !Array.isArray(slots) || !fields.length && !slots.length || fields.some(key => !config.fields.some(f => f.key === key)) || slots.some(key => !config.documents.some(d => d.key === key))) throw new ServiceError("Укажите поля или документы для уточнения.");
            patch.clarificationJson = JSON.stringify({ fields, slots });
          }
          patch.status = status;
          if (status === "IN_REVIEW") patch.assigneeId = user.id;
          if (status === "COMPLETED" || status === "REJECTED") { patch.completedAt = new Date(); patch.completedBy = user.id; patch.resultText = historyText; }
          notify = status; break;
        }
        case "COMMENT":
          if (["DRAFT", "COMPLETED", "REJECTED"].includes(request.status)) throw new ServiceError("Переписка закрыта.", 409);
          historyText = message(command.text, true); if (!owner) notify = "STAFF_REPLY"; break;
        case "UPLOAD": {
          if (!file) throw new ServiceError("Отсутствует файл.");
          const kind = owner ? "STUDENT" : "RESULT";
          if (command.kind !== kind) throw new ServiceError("Недопустимый вид документа.");
          if (owner) {
            editable(request, owner, command.slot);
            if (!config.documents.some(slot => slot.key === command.slot)) throw new ServiceError("Неизвестный вид приложения.");
          } else if (request.status !== "IN_PROGRESS" || command.slot !== "result") throw new ServiceError("Итоговые файлы добавляются в работе.", 409);
          const count = await tx.serviceDocument.count({ where: { requestId: request.id, removedAt: null } });
          if (count >= 20) throw new ServiceError("Не более 20 активных файлов.", 409);
          const doc = await tx.serviceDocument.create({ data: { requestId: request.id, uploadedBy: user.id, kind, slot: command.slot!, ...file } });
          documentId = doc.id; break;
        }
        case "REMOVE_FILE": {
          if (typeof command.documentId !== "string" || !command.documentId) throw new ServiceError("Укажите документ.");
          const doc = await tx.serviceDocument.findFirst({ where: { id: command.documentId, requestId: request.id, removedAt: null } });
          if (!doc) throw new ServiceError("Документ недоступен.", 404);
          if (owner) { editable(request, owner, doc.slot); if (doc.kind !== "STUDENT") throw new ServiceError("Документ недоступен.", 403); }
          else if (doc.kind !== "RESULT" || request.status !== "IN_PROGRESS") throw new ServiceError("Удаление недоступно.", 409);
          await tx.serviceDocument.update({ where: { id: doc.id }, data: { removedAt: new Date() } });
          documentId = doc.id; break;
        }
        default: throw new ServiceError("Неизвестная операция.");
      }
      const changed = await tx.serviceRequest.updateMany({ where: { id: request.id, version: command.version }, data: patch });
      if (changed.count !== 1) throw new ServiceError("Конфликт версий.", 409);
      request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    }
    snapshotJson ??= JSON.stringify({ version: request.version, status: request.status, fields: JSON.parse(request.fieldsJson), documentId });
    await tx.serviceHistory.create({ data: { requestId: request.id, actorId: user.id, actorName: user.name, action: command.operation === "TRANSITION" ? request.status : command.operation, text: historyText, snapshotJson } });
    if (notify) await tx.serviceEvent.create({ data: { recipientId: request.ownerId, requestId: request.id, version: request.version, type: notify } });
    const result = { id: request.id, version: request.version, ...(documentId ? { documentId } : {}) };
    await tx.serviceReceipt.create({ data: { actorId: user.id, key: command.requestId, hash, resultJson: JSON.stringify(result) } });
    return { ...result, replayed: false };
  }, { timeout: 15000, maxWait: 15000 });
}

export async function getServiceRequest(db: PrismaClient, actor: ServiceActor, id: string, page = 0) {
  return db.$transaction(async tx => {
    const request = await visibleRequest(tx, actor, id);
    const user = await liveActor(tx, actor);
    let readFiles = user.role === "STUDENT";
    if (!readFiles) readFiles = Boolean(await tx.serviceRequest.findFirst({ where: { id, AND: [await processorScope(tx, actor, true)] } }));
    const documents = readFiles ? await tx.serviceDocument.findMany({ where: { requestId: id }, select: { id: true, name: true, mime: true, size: true, kind: true, slot: true, removedAt: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50, skip: page * 50 }) : [];
    const history = await tx.serviceHistory.findMany({ where: { requestId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50, skip: page * 50 });
    const profile = user.role === "STUDENT" ? await profileFor(tx, request.ownerId, configFor(request.serviceCode, request.schemaVersion)) : null;
    return { ...request, fields: JSON.parse(request.fieldsJson), profileSnapshot: request.profileJson ? JSON.parse(request.profileJson) : null, clarification: request.clarificationJson ? JSON.parse(request.clarificationJson) : null, fieldsJson: undefined, profileJson: undefined, clarificationJson: undefined, confirmationHash: undefined, profilePreview: profile && { values: profile.snapshot, confirmationHash: profile.hash, correctionService: "personal-change" }, documents, history, page, pageSize: 50 };
  });
}
export async function listServiceRequests(db: PrismaClient, actor: ServiceActor, filters: { page: number; code?: string; status?: string; from?: Date; to?: Date }) {
  return db.$transaction(async tx => {
    const user = await liveActor(tx, actor);
    const scope = user.role === "STUDENT" ? { ownerId: user.id } : { AND: [{ status: { not: "DRAFT" as const } }, await processorScope(tx, actor)] };
    if (filters.status && !["DRAFT", "SUBMITTED", "IN_REVIEW", "CLARIFICATION_REQUIRED", "IN_PROGRESS", "COMPLETED", "REJECTED"].includes(filters.status)) throw new ServiceError("Неизвестный статус.");
    const where: Prisma.ServiceRequestWhereInput = { AND: [scope, { deletedAt: null, serviceCode: filters.code, status: filters.status as ServiceRequest["status"] | undefined, createdAt: { gte: filters.from, lte: filters.to } }] };
    return { items: await tx.serviceRequest.findMany({ where, select: { id: true, serviceCode: true, schemaVersion: true, status: true, version: true, createdAt: true, updatedAt: true, assigneeId: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: filters.page * 50, take: 50 }), total: await tx.serviceRequest.count({ where }), page: filters.page, pageSize: 50 };
  });
}
export async function downloadServiceDocument(db: PrismaClient, actor: ServiceActor, id: string, storage: ServiceStorage) {
  return db.$transaction(async tx => {
    const doc = await tx.serviceDocument.findUnique({ where: { id } });
    if (!doc) throw new ServiceError("Документ недоступен.", 404);
    await visibleRequest(tx, actor, doc.requestId, true);
    const bytes = await storage.get(doc.key);
    if (bytes.length !== doc.size || digest(bytes) !== doc.sha256) throw new ServiceError("Хранилище документа недоступно.", 503);
    return { bytes, name: doc.name, mime: doc.mime };
  });
}
export async function getMilitaryRecord(db: PrismaClient, actor: ServiceActor, studentId: string) {
  return db.$transaction(async tx => {
    const user = await liveActor(tx, actor);
    if (user.role === "STUDENT") { if (user.id !== studentId) throw new ServiceError("Сведения недоступны.", 404); }
    else {
      const grants = await tx.serviceGrant.findMany({ where: { userId: user.id, serviceCode: "military-change", readMilitary: true, active: true, ...(user.role === "DEANERY_STAFF" ? { department: { deaneryAssignments: { some: { userId: user.id } } } } : {}) } });
      if (!["DEANERY_STAFF", "TECHNICAL_STAFF", "ADMIN"].includes(user.role) || !await tx.militaryRecord.findFirst({ where: { userId: studentId, departmentId: { in: grants.map(g => g.departmentId) } } })) throw new ServiceError("Сведения недоступны.", 404);
    }
    return tx.militaryRecord.findUnique({ where: { userId: studentId }, select: { registrationStatus: true, office: true, documentType: true, documentNumber: true, verifiedAt: true, updatedAt: true } });
  });
}
