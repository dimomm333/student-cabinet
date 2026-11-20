import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, ClearanceReason, ClearanceRule } from "../generated/prisma/client.ts";
import { clearanceActor, clearanceScope, clearanceStepScope, requireClearanceManager, type ClearanceActor, type ClearanceDB, type ClearanceUser } from "./clearance-permissions.ts";
import { ClearanceError, clearanceDate, clearanceInt, clearanceReasons, clearanceRules, clearanceSettled, clearanceStepStatuses, clearanceTerminal, clearanceText, parseClearanceCommand, type ClearanceCommand } from "./clearance-shared.ts";
import { emitNotification } from "./notifications-repository.ts";
import { renderClearancePdf, type ClearanceSnapshot } from "./clearance-pdf.ts";
import { serviceProcessorScope } from "./services-permissions.ts";

const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const id = (v: unknown) => clearanceText(v, "Идентификатор", 100);
const bool = (v: unknown) => { if (typeof v !== "boolean") throw new ClearanceError("Укажите подтверждение."); return v; };
const admin = (u: ClearanceUser) => { if (u.role !== "ADMIN") throw new ClearanceError("Настройки доступны администратору.", 403); };
const stepInclude = { remarks: { orderBy: { createdAt: "desc" as const }, take: 30, include: { replies: { orderBy: { createdAt: "desc" as const }, take: 10 } } } };
type Process = Prisma.ClearanceProcessGetPayload<{ include: { steps: true } }>;
async function audit(tx: ClearanceDB, user: ClearanceUser, action: string, text: string, processId?: string, stepId?: string, studentVisible = false) {
  await tx.clearanceHistory.create({ data: { actorId: user.id, actorName: user.name, action, text, processId, stepId, studentVisible } });
}
async function accessible(tx: ClearanceDB, user: ClearanceUser, processId: string) {
  const p = await tx.clearanceProcess.findFirst({ where: { id: processId, AND: [clearanceScope(user)] }, include: { steps: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } });
  if (!p) throw new ClearanceError("Обходной лист недоступен.", 404); return p;
}
export async function clearanceNotification(tx: ClearanceDB, p: Process, type: string, title: string, stepId?: string, audience = "all") {
  const recipients: { id: string; role: "STUDENT" | "DEANERY_STAFF" | "TECHNICAL_STAFF"; href: string }[] = [];
  if (audience !== "staff") recipients.push({ id: p.studentId, role: "STUDENT", href: `/dashboard/clearance?id=${p.id}` });
  if (audience !== "student") {
    const users = await tx.user.findMany({ where: { OR: [
      { role: "DEANERY_STAFF", deaneryStaffProfile: { departments: { some: { departmentId: p.academicDepartmentId } } } },
      { role: "TECHNICAL_STAFF", clearanceGrants: { some: { active: true, department: { active: true, steps: { some: { processId: p.id, ...(stepId ? { id: stepId } : {}) } } } } } },
    ] }, select: { id: true, role: true } });
    for (const u of users) if (u.role === "TECHNICAL_STAFF" || u.role === "DEANERY_STAFF") {
      if (await tx.clearanceProcess.count({ where: { id: p.id, AND: [clearanceScope(u)] } })) recipients.push({ id: u.id, role: u.role, href: `${u.role === "DEANERY_STAFF" ? "/deanery" : "/staff"}/clearance?id=${p.id}` });
    }
  }
  await emitNotification(tx, { sourceKey: `clearance:${p.id}:${p.version}:${type}`, source: "CLEARANCE", sourceId: p.id, clearanceProcessId: p.id, type, category: "SERVICES", title, body: "Откройте обходной лист, чтобы просмотреть изменения.", mandatory: true, recipients });
}
function applicability(rule: ClearanceRule, p: { residenceStatus: string | null; dormitory: string | null; fundingBasis: string | null }, reason: ClearanceReason) {
  if (rule === "ALWAYS" || rule === "FINAL") return { status: "PENDING" as const, needsClarification: false, applicabilityNote: null };
  if (rule === "DORMITORY" && (p.residenceStatus === "RESIDENT" || p.dormitory)) return { status: "PENDING" as const, needsClarification: false, applicabilityNote: "В профиле указано проживание в общежитии." };
  if (rule === "PAID" && /договор|платн/i.test(p.fundingBasis ?? "")) return { status: "PENDING" as const, needsClarification: false, applicabilityNote: "В профиле указано договорное обучение." };
  if (rule === "GRADUATION" && reason !== "GRADUATION") return { status: "NOT_APPLICABLE" as const, needsClarification: false, applicabilityNote: "Проверка предусмотрена только для выпуска." };
  if (rule === "GRADUATION") return { status: "PENDING" as const, needsClarification: false, applicabilityNote: "Выпускная процедура." };
  return { status: "PENDING" as const, needsClarification: true, applicabilityNote: "Деканату требуется подтвердить применимость проверки: сведения неполны." };
}
function computedStatus(steps: Process["steps"]): "IN_PROGRESS" | "ACTION_REQUIRED" | "READY_FOR_FINAL_REVIEW" {
  const ordinary = steps.filter(s => !s.isFinal);
  if (ordinary.some(s => s.status === "ACTION_REQUIRED")) return "ACTION_REQUIRED";
  if (ordinary.length && ordinary.every(s => clearanceSettled(s.status) && !s.needsClarification)) return "READY_FOR_FINAL_REVIEW";
  return "IN_PROGRESS";
}
async function configure(tx: ClearanceDB, u: ClearanceUser, c: ClearanceCommand) {
  admin(u); const text = clearanceText(c.text, "Причина настройки");
  if (c.operation === "GRANT") {
    const userId = id(c.userId), departmentId = id(c.departmentId), active = bool(c.active);
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target || !["TECHNICAL_STAFF", "DEANERY_STAFF"].includes(target.role)) throw new ClearanceError("Назначьте сотрудника технического персонала или деканата.");
    if (!await tx.clearanceDepartment.count({ where: { id: departmentId } })) throw new ClearanceError("Подразделение не найдено.");
    const before = await tx.clearanceGrant.findUnique({ where: { userId_departmentId: { userId, departmentId } } });
    await tx.clearanceGrant.upsert({ where: { userId_departmentId: { userId, departmentId } }, create: { userId, departmentId, active }, update: { active } });
    await audit(tx, u, "GRANT", `${text}\n${JSON.stringify({ userId, userName: target.name, departmentId, before: before?.active ?? null, after: active })}`); return { id: departmentId };
  }
  const currentId = c.id ? id(c.id) : undefined;
  if (c.operation === "DEPARTMENT") {
    const before = currentId ? await tx.clearanceDepartment.findUnique({ where: { id: currentId } }) : null;
    const code = clearanceText(c.code, "Код", 60); if (!/^[a-z][a-z0-9-]*$/.test(code)) throw new ClearanceError("Код: латинские буквы, цифры и дефис.");
    const data = { code, name: clearanceText(c.name, "Название", 180), description: clearanceText(c.description, "Описание", 1500), contact: clearanceText(c.contact, "Контакты", 500), active: bool(c.active), sortOrder: clearanceInt(c.sortOrder, 0, 10000) };
    if (currentId) { const changed = await tx.clearanceDepartment.updateMany({ where: { id: currentId, version: clearanceInt(c.version) }, data: { ...data, version: { increment: 1 } } }); if (changed.count !== 1) throw new ClearanceError("Настройки изменены. Обновите страницу.", 409); }
    const result = currentId ? { id: currentId } : await tx.clearanceDepartment.create({ data, select: { id: true } });
    await audit(tx, u, "DEPARTMENT", `${text}\n${JSON.stringify({ id: result.id, before, after: data })}`); return result;
  }
  const reason = clearanceText(c.reason, "Основание") as ClearanceReason;
  if (!Object.hasOwn(clearanceReasons, reason) || !Array.isArray(c.rules) || c.rules.length < 2 || c.rules.length > 30) throw new ClearanceError("Выберите основание и от 2 до 30 проверок.");
  const rules = c.rules.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["departmentId", "rule"].includes(k))) throw new ClearanceError("Некорректное правило.");
    const r = raw as { departmentId: unknown; rule: string }; if (!Object.hasOwn(clearanceRules, r.rule)) throw new ClearanceError("Неизвестное правило.");
    return { departmentId: id(r.departmentId), rule: r.rule as ClearanceRule };
  });
  if (new Set(rules.map(r => r.departmentId)).size !== rules.length || rules.filter(r => r.rule === "FINAL").length !== 1) throw new ClearanceError("Нужна ровно одна итоговая проверка; подразделения не должны повторяться.");
  if (await tx.clearanceDepartment.count({ where: { id: { in: rules.map(r => r.departmentId) }, active: true } }) !== rules.length) throw new ClearanceError("В шаблоне есть неактивное подразделение.");
  const data = { name: clearanceText(c.name, "Название", 180), reason, active: bool(c.active) };
  const before = currentId ? await tx.clearanceTemplate.findUnique({ where: { id: currentId }, include: { rules: true } }) : null;
  let result: { id: string };
  if (currentId) {
    const changed = await tx.clearanceTemplate.updateMany({ where: { id: currentId, version: clearanceInt(c.version) }, data: { ...data, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ClearanceError("Шаблон изменён. Обновите страницу.", 409);
    await tx.clearanceTemplateRule.deleteMany({ where: { templateId: currentId } }); result = { id: currentId };
  } else result = await tx.clearanceTemplate.create({ data, select: { id: true } });
  await tx.clearanceTemplateRule.createMany({ data: rules.map(r => ({ ...r, templateId: result.id })) });
  await audit(tx, u, "TEMPLATE", `${text}\n${JSON.stringify({ id: result.id, before, after: { ...data, rules } })}`); return result;
}
async function createProcess(tx: ClearanceDB, u: ClearanceUser, c: ClearanceCommand) {
  if (u.role !== "DEANERY_STAFF") throw new ClearanceError("Обходной лист создаёт деканат.", 403);
  const profile = await tx.studentProfile.findFirst({ where: { userId: id(c.studentId), user: { role: "STUDENT" }, group: { department: { deaneryAssignments: { some: { userId: u.id } } } } }, include: { user: { select: { name: true } }, group: true } });
  if (!profile?.group?.departmentId) throw new ClearanceError("Студент недоступен деканату.", 404);
  const template = await tx.clearanceTemplate.findFirst({ where: { id: id(c.templateId), active: true }, include: { rules: { include: { department: true } } } });
  if (!template || template.rules.length < 2 || template.rules.some(r => !r.department.active) || template.rules.filter(r => r.rule === "FINAL").length !== 1) throw new ClearanceError("Шаблон не настроен или содержит неактивные подразделения.");
  const activeKey = `${profile.userId}:${template.reason}`;
  if (await tx.clearanceProcess.count({ where: { activeKey } })) throw new ClearanceError("По этому основанию уже существует активный обходной лист.", 409);
  const startsOn = clearanceDate(c.startsOn, false)!, plannedOn = clearanceDate(c.plannedOn);
  if (plannedOn && plannedOn < startsOn) throw new ClearanceError("Дата завершения раньше даты начала.");
  const serviceRequestId = c.serviceRequestId ? id(c.serviceRequestId) : null;
  if (serviceRequestId && (template.reason !== "WITHDRAWAL" || !await tx.serviceRequest.count({ where: { id: serviceRequestId, ownerId: profile.userId, serviceCode: "withdrawal", status: { in: ["IN_REVIEW", "IN_PROGRESS", "COMPLETED"] }, AND: [await serviceProcessorScope(tx, u)], deletedAt: null } }))) throw new ClearanceError("Связанное заявление недоступно или ещё не принято деканатом.");
  const p = await tx.clearanceProcess.create({ data: { number: "ОЛ-" + randomUUID().toUpperCase(), studentId: profile.userId, academicDepartmentId: profile.group.departmentId, templateId: template.id, templateName: template.name, templateVersion: template.version,
    reason: template.reason, basisNote: clearanceText(c.basisNote, "Основание оформления"), startsOn, plannedOn, orderNumber: clearanceText(c.orderNumber, "Номер приказа", 100, true) || null, orderDate: clearanceDate(c.orderDate),
    studentName: profile.user.name, groupName: profile.group.code, activeKey, serviceRequestId,
    steps: { create: template.rules.map(r => ({ departmentId: r.departmentId, name: r.department.name, description: r.department.description, contact: r.department.contact, sortOrder: r.department.sortOrder, rule: r.rule, isFinal: r.rule === "FINAL", ...applicability(r.rule, profile, template.reason) })) },
  }, select: { id: true } });
  await audit(tx, u, "CREATE", "Создан черновик обходного листа.", p.id); return p;
}
async function mutateProcess(tx: ClearanceDB, u: ClearanceUser, c: ClearanceCommand) {
  let p = await accessible(tx, u, id(c.id));
  let resolvedRemark = false;
  if (p.version !== clearanceInt(c.version)) throw new ClearanceError("Данные изменены другим участником. Обновите обходной лист.", 409);
  const step = c.stepId ? p.steps.find(s => s.id === c.stepId) : undefined;
  const managers = ["OPEN", "COMPLETE", "CANCEL", "REMIND", "APPLICABILITY", "ADD_STEP"];
  if (managers.includes(c.operation)) await requireClearanceManager(tx, u, p.id);
  if (c.operation === "INVALIDATE") {
    admin(u); if (!bool(c.confirmed) || p.status !== "COMPLETED") throw new ClearanceError("Аннулировать можно только завершённый документ с подтверждением.");
    const text = clearanceText(c.text, "Причина аннулирования");
    await tx.clearanceDocument.update({ where: { processId: p.id }, data: { invalidatedAt: new Date() } });
    await tx.clearanceProcess.update({ where: { id: p.id }, data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } } });
    await audit(tx, u, "INVALIDATE", text, p.id, undefined, true);
  } else {
    if (clearanceTerminal(p.status)) throw new ClearanceError("Процедура закрыта; изменение запрещено.", 409);
    if (c.operation === "OPEN") {
      if (p.status !== "DRAFT") throw new ClearanceError("Обходной лист уже открыт.", 409);
      if (p.steps.some(s => s.needsClarification)) throw new ClearanceError("Подтвердите применимость всех проверок.");
      for (const s of p.steps.filter(s => !s.isFinal && !clearanceSettled(s.status))) {
        const assigned = await tx.clearanceGrant.count({ where: { departmentId: s.departmentId, active: true, department: { active: true }, user: { role: { in: ["TECHNICAL_STAFF", "DEANERY_STAFF"] } } } });
        if (!assigned) throw new ClearanceError(`Не назначен ответственный: ${s.name}.`);
      }
      await tx.clearanceProcess.update({ where: { id: p.id }, data: { status: computedStatus(p.steps), openedAt: new Date() } });
      await audit(tx, u, "OPEN", "Обходной лист открыт.", p.id, undefined, true);
    } else if (c.operation === "CANCEL") {
      if (!bool(c.confirmed)) throw new ClearanceError("Подтвердите отмену.");
      await tx.clearanceProcess.update({ where: { id: p.id }, data: { status: "CANCELLED", activeKey: null, cancelledAt: new Date() } });
      await audit(tx, u, "CANCEL", clearanceText(c.text, "Причина отмены"), p.id, undefined, true);
    } else if (c.operation === "APPLICABILITY") {
      if (!step || step.isFinal || step.status === "APPROVED") throw new ClearanceError("Применимость этой проверки изменить нельзя.");
      const required = bool(c.required), text = clearanceText(c.text, "Основание применимости");
      if (!required && !bool(c.confirmed)) throw new ClearanceError("Подтвердите исключение проверки.");
      if (await tx.clearanceRemark.count({ where: { stepId: step.id, resolvedAt: null } })) throw new ClearanceError("Сначала ответственный должен подтвердить устранение замечаний.");
      await tx.clearanceStep.update({ where: { id: step.id }, data: { needsClarification: false, applicabilityNote: text, status: required ? "PENDING" : "NOT_APPLICABLE", decidedById: u.id, decidedByName: u.name, decidedAt: new Date() } });
      await audit(tx, u, "APPLICABILITY", text, p.id, step.id, true);
    } else if (c.operation === "ADD_STEP") {
      const d = await tx.clearanceDepartment.findFirst({ where: { id: id(c.departmentId), active: true } });
      if (!d || p.steps.some(s => s.departmentId === d.id) || p.steps.length >= 30) throw new ClearanceError("Подразделение недоступно, уже добавлено или достигнут предел проверок.");
      await tx.clearanceStep.create({ data: { processId: p.id, departmentId: d.id, name: d.name, description: d.description, contact: d.contact, sortOrder: d.sortOrder, rule: "MANUAL", applicabilityNote: clearanceText(c.text, "Причина добавления") } });
      await audit(tx, u, "ADD_STEP", `${d.name}: ${clearanceText(c.text, "Причина")}`, p.id, undefined, true);
    } else if (c.operation === "REMIND") {
      if (p.status === "DRAFT") throw new ClearanceError("Сначала откройте процесс.");
      if (await tx.clearanceHistory.count({ where: { processId: p.id, action: "REMIND", createdAt: { gt: new Date(Date.now() - 3600000) } } })) throw new ClearanceError("Напоминание уже отправлено. Повтор доступен через час.", 409);
      await audit(tx, u, "REMIND", "Ответственным направлено напоминание.", p.id);
    } else if (c.operation === "COMPLETE") {
      const final = p.steps.find(s => s.isFinal);
      if (p.status !== "READY_FOR_FINAL_REVIEW" || !final || p.steps.some(s => !s.isFinal && (!clearanceSettled(s.status) || s.needsClarification)) || await tx.clearanceRemark.count({ where: { step: { processId: p.id }, resolvedAt: null } })) throw new ClearanceError("Остались несогласованные проверки или замечания.", 409);
      const now = new Date();
      await tx.clearanceStep.update({ where: { id: final.id }, data: { status: "APPROVED", decidedById: u.id, decidedByName: u.name, decidedAt: now } });
      p = await accessible(tx, u, p.id);
      const snapshot: ClearanceSnapshot = { number: p.number, studentName: p.studentName, groupName: p.groupName, reason: clearanceReasons[p.reason], openedAt: p.openedAt!.toISOString(), completedAt: now.toISOString(), completedBy: u.name,
        steps: p.steps.map(s => ({ name: s.name, status: clearanceStepStatuses[s.status], actor: s.decidedByName ?? "Применимость определена правилом", date: (s.decidedAt ?? p.openedAt!).toISOString(), note: s.status === "NOT_APPLICABLE" ? s.applicabilityNote ?? "" : "" })) };
      const content = await renderClearancePdf(snapshot);
      await tx.clearanceDocument.create({ data: { processId: p.id, snapshotJson: JSON.stringify(snapshot), content: new Uint8Array(content), sha256: hash(content) } });
      await tx.clearanceProcess.update({ where: { id: p.id }, data: { status: "COMPLETED", activeKey: null, completedAt: now } });
      await audit(tx, u, "COMPLETE", "Деканат завершил обходной лист. Итоговый документ сформирован.", p.id, final.id, true);
    } else {
      if (!step || step.isFinal || step.needsClarification || p.status === "DRAFT") throw new ClearanceError("Проверка недоступна для этого действия.", 409);
      if (c.operation === "REPLY") {
        if (u.role !== "STUDENT" || p.studentId !== u.id) throw new ClearanceError("Ответ отправляет владелец обходного листа.", 403);
        const remark = await tx.clearanceRemark.findFirst({ where: { id: id(c.remarkId), stepId: step.id, resolvedAt: null } });
        if (!remark || remark.responsePending) throw new ClearanceError("Замечание уже закрыто или ответ ожидает проверки.", 409);
        const text = clearanceText(c.text, "Сообщение");
        await tx.clearanceReply.create({ data: { remarkId: remark.id, actorId: u.id, actorName: u.name, text } });
        await tx.clearanceRemark.update({ where: { id: remark.id }, data: { responsePending: true } });
        await audit(tx, u, "REPLY", text, p.id, step.id, true);
      } else {
        if (!["TECHNICAL_STAFF", "DEANERY_STAFF"].includes(u.role) || !await tx.clearanceGrant.count({ where: { userId: u.id, departmentId: step.departmentId, active: true, department: { active: true } } })) throw new ClearanceError("Нет действующего назначения на это подразделение.", 403);
        if (u.role === "DEANERY_STAFF") await requireClearanceManager(tx, u, p.id);
        if (step.status === "NOT_APPLICABLE") throw new ClearanceError("Проверка исключена деканатом.", 409);
        if (c.operation === "START") {
          if (step.status !== "PENDING") throw new ClearanceError("Проверка уже начата.", 409);
          await tx.clearanceStep.update({ where: { id: step.id }, data: { status: "IN_REVIEW" } });
          await audit(tx, u, "START", "Начата проверка.", p.id, step.id, true);
        } else if (c.operation === "REMARK") {
          const category = clearanceText(c.category, "Категория", 100), description = clearanceText(c.description, "Замечание"), requiredAction = clearanceText(c.requiredAction, "Действие студента");
          if (await tx.clearanceRemark.count({ where: { stepId: step.id, resolvedAt: null } }) >= 20) throw new ClearanceError("Сначала завершите проверку действующих замечаний.");
          await tx.clearanceRemark.create({ data: { stepId: step.id, category, description, requiredAction, contact: clearanceText(c.contact, "Контакты", 500, true) || step.contact, dueOn: clearanceDate(c.dueOn), amountMinor: c.amountMinor == null ? null : clearanceInt(c.amountMinor, 0), actorId: u.id, actorName: u.name } });
          await tx.clearanceStep.update({ where: { id: step.id }, data: { status: "ACTION_REQUIRED", decidedAt: null, decidedById: null, decidedByName: null } });
          await audit(tx, u, "REMARK", description, p.id, step.id, true);
        } else if (c.operation === "APPROVE") {
          if (step.status === "APPROVED") throw new ClearanceError("Подразделение уже согласовано.", 409);
          const unresolved = await tx.clearanceRemark.count({ where: { stepId: step.id, resolvedAt: null } });
          resolvedRemark = unresolved > 0;
          const text = clearanceText(c.text, unresolved ? "Результат повторной проверки" : "Комментарий", 2000, !unresolved);
          await tx.clearanceRemark.updateMany({ where: { stepId: step.id, resolvedAt: null }, data: { resolvedAt: new Date(), responsePending: false } });
          await tx.clearanceStep.update({ where: { id: step.id }, data: { status: "APPROVED", decidedById: u.id, decidedByName: u.name, decidedAt: new Date() } });
          await audit(tx, u, "APPROVE", text || "Подразделение согласовало проверку.", p.id, step.id, true);
        } else if (c.operation === "REJECT_REPLY") {
          const remark = await tx.clearanceRemark.findFirst({ where: { id: id(c.remarkId), stepId: step.id, resolvedAt: null, responsePending: true } });
          if (!remark) throw new ClearanceError("Ответ уже проверен.", 409);
          const text = clearanceText(c.text, "Причина повторного замечания");
          await tx.clearanceReply.create({ data: { remarkId: remark.id, actorId: u.id, actorName: u.name, text } });
          await tx.clearanceRemark.update({ where: { id: remark.id }, data: { responsePending: false } });
          await audit(tx, u, "REJECT_REPLY", text, p.id, step.id, true);
        } else throw new ClearanceError("Действие недоступно.");
      }
    }
    const next = await accessible(tx, u, p.id);
    if (!clearanceTerminal(next.status) && next.status !== "DRAFT") await tx.clearanceProcess.update({ where: { id: p.id }, data: { status: computedStatus(next.steps) } });
    await tx.clearanceProcess.update({ where: { id: p.id }, data: { version: { increment: 1 } } });
  }
  const next = await accessible(tx, u, p.id);
  const titles: Record<string, string> = { OPEN: "Обходной лист открыт", CANCEL: "Обходной лист отменён", INVALIDATE: "Итоговый документ аннулирован", COMPLETE: "Обходной лист завершён", REMARK: "В обходном листе появилось замечание", APPROVE: "Подразделение согласовало обходной лист", REPLY: "Студент сообщил об устранении замечания", REJECT_REPLY: "Требуется повторное устранение замечания", REMIND: "Ожидается проверка обходного листа", ADD_STEP: "Назначена дополнительная проверка", APPLICABILITY: "Состав проверок уточнён" };
  if (titles[c.operation] && next.status !== "DRAFT") await clearanceNotification(tx, next, c.operation, titles[c.operation], step?.id, ["REPLY", "REMIND"].includes(c.operation) ? "staff" : "all");
  if (resolvedRemark) await clearanceNotification(tx, next, "REMARK_RESOLVED", "Замечание в обходном листе снято", step?.id, "student");
  if (p.status !== next.status && next.status === "READY_FOR_FINAL_REVIEW") await clearanceNotification(tx, next, "READY", "Обходной лист готов к итоговой проверке");
  return { id: p.id, version: next.version };
}
export async function executeClearanceCommand(db: PrismaClient, actor: ClearanceActor, raw: unknown) {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, canonical(val)])) : v;
  const c = parseClearanceCommand(raw), digest = hash(JSON.stringify(canonical(c)));
  try {
    return await db.$transaction(async tx => {
      // SQLite obtains its write lock before any reads. PostgreSQL uses the same
      // row lock; no provider-specific SQL or read-then-write race is required.
      await tx.clearanceWriteState.upsert({ where: { id: "commands" }, create: { id: "commands", version: 1 }, update: { version: { increment: 1 } } });
      const u = await clearanceActor(tx, actor), settings = ["DEPARTMENT", "TEMPLATE", "GRANT"].includes(c.operation);
      const prior = await tx.clearanceReceipt.findUnique({ where: { actorId_key: { actorId: u.id, key: c.requestId } } });
      if (prior) {
        if (settings) admin(u); else if (prior.processId) await accessible(tx, u, prior.processId);
        if (prior.hash !== digest) throw new ClearanceError("Ключ запроса уже использован для других данных.", 409); return JSON.parse(prior.resultJson) as { id: string; version?: number };
      }
      const result = settings ? await configure(tx, u, c) : c.operation === "CREATE" ? await createProcess(tx, u, c) : await mutateProcess(tx, u, c);
      await tx.clearanceReceipt.create({ data: { actorId: u.id, key: c.requestId, hash: digest, processId: settings ? null : result.id, resultJson: JSON.stringify(result) } });
      return result;
    }, { timeout: 30000, maxWait: 15000 });
  } catch (e) {
    if (e instanceof ClearanceError && e.status === 409 && e.message.startsWith("Данные изменены") && typeof c.id === "string") {
      // The rejected mutation was rolled back. Record only an authorized,
      // generic conflict in a separate transaction, without the rejected body.
      await db.$transaction(async tx => {
        await tx.clearanceWriteState.upsert({ where: { id: "commands" }, create: { id: "commands", version: 1 }, update: { version: { increment: 1 } } });
        const u = await clearanceActor(tx, actor), p = await accessible(tx, u, c.id as string), sourceKey = `clearance:conflict:${u.id}:${c.requestId}`;
        if (await tx.notificationEvent.count({ where: { sourceKey } })) return;
        const deans = await tx.user.findMany({ where: { role: "DEANERY_STAFF", deaneryStaffProfile: { departments: { some: { departmentId: p.academicDepartmentId } } } }, select: { id: true, role: true } });
        const recipients = [];
        for (const dean of deans) if (await tx.clearanceProcess.count({ where: { id: p.id, AND: [clearanceScope(dean)] } })) recipients.push({ id: dean.id, role: dean.role, href: `/deanery/clearance?id=${p.id}` });
        await audit(tx, u, "CONFLICT", "Изменение отклонено: использована устаревшая версия процедуры.", p.id);
        await emitNotification(tx, { sourceKey, source: "CLEARANCE", clearanceProcessId: p.id, sourceId: p.id, type: "CONFLICT", category: "SERVICES", title: "Требуется проверить конфликт согласования", body: "Одно из изменений обходного листа отклонено. Откройте историю процедуры.", mandatory: true, recipients });
      }).catch(() => { console.error("clearance.conflict_audit_failed"); });
    }
    if (e instanceof ClearanceError) throw e;
    if (e && typeof e === "object" && "code" in e && ["P2002", "P2034", "P2028"].includes(String(e.code))) throw new ClearanceError("Конфликт изменений. Обновите страницу и повторите действие.", 409);
    throw e;
  }
}

export type ClearanceFilters = { id?: string; page?: number; q?: string; status?: string; reason?: string; departmentId?: string; group?: string };
function pageNumber(v = 0) { return clearanceInt(v, 0, 99999); }
// SQLite's LIKE folds ASCII only. Common Russian name/code spellings are
// searched with Prisma predicates, without loading profiles into memory or
// introducing provider-specific SQL. Tokens allow surname + first name.
const searchTokens = (q: string) => q.trim().split(/\s+/u).filter(Boolean).slice(0, 8);
function searchVariants(q: string) { const lower = q.toLocaleLowerCase("ru-RU"); return [...new Set([q, lower, q.toLocaleUpperCase("ru-RU"), lower.replace(/(^|-)(\p{L})/gu, (_m, prefix: string, c: string) => prefix + c.toLocaleUpperCase("ru-RU"))])]; }
function nameSearch(q: string): Prisma.UserWhereInput[] { return searchTokens(q).map(token => ({ OR: searchVariants(token).map(v => ({ name: { contains: v } })) })); }
export async function listClearances(db: PrismaClient, actor: ClearanceActor, f: ClearanceFilters = {}) {
  const page = pageNumber(f.page);
  return db.$transaction(async tx => {
    const u = await clearanceActor(tx, actor), scope = clearanceScope(u);
    if (u.role === "TECHNICAL_STAFF" && f.reason) throw new ClearanceError("Фильтр по основанию недоступен сотруднику подразделения.", 403);
    if (f.status && !["DRAFT", "IN_PROGRESS", "ACTION_REQUIRED", "READY_FOR_FINAL_REVIEW", "COMPLETED", "CANCELLED"].includes(f.status)) throw new ClearanceError("Неизвестный статус.");
    if (f.reason && !Object.hasOwn(clearanceReasons, f.reason)) throw new ClearanceError("Неизвестное основание.");
    const searchWhere: Prisma.ClearanceProcessWhereInput[] = searchTokens(f.q ?? "").map(token => ({ OR: searchVariants(token).flatMap(v => [{ studentName: { contains: v } }, { groupName: { contains: v } }, { number: { contains: v } }]) }));
    const where: Prisma.ClearanceProcessWhereInput = { AND: [scope, ...searchWhere], ...(f.status ? { status: f.status as Prisma.EnumClearanceStatusFilter["equals"] } : {}), ...(f.reason ? { reason: f.reason as ClearanceReason } : {}),
      ...(f.group ? { OR: searchVariants(f.group).map(v => ({ groupName: { contains: v } })) } : {}), ...(f.departmentId ? { steps: { some: { departmentId: f.departmentId } } } : {}) };
    const [total, records, counters] = await Promise.all([
      tx.clearanceProcess.count({ where }),
      tx.clearanceProcess.findMany({ where, select: { id: true, number: true, studentName: true, groupName: true, reason: true, status: true, createdAt: true, openedAt: true, steps: { where: clearanceStepScope(u), select: { status: true, isFinal: true, remarks: { where: { resolvedAt: null, responsePending: true }, select: { id: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: page * 20 }),
      tx.clearanceProcess.groupBy({ by: ["status"], where: scope, _count: true }),
    ]);
    return { total, page, role: u.role, counters: Object.fromEntries(counters.map(c => [c.status, c._count])), items: records.map(({ steps, ...p }) => ({ ...p, reason: u.role === "TECHNICAL_STAFF" ? null : p.reason, approved: steps.filter(s => !s.isFinal && s.status === "APPROVED").length, totalSteps: steps.filter(s => !s.isFinal && s.status !== "NOT_APPLICABLE").length, replies: steps.reduce((sum, s) => sum + s.remarks.length, 0) })) };
  });
}
export async function clearanceDetail(db: PrismaClient, actor: ClearanceActor, processId: string, page = 0) {
  pageNumber(page);
  return db.$transaction(async tx => {
    const u = await clearanceActor(tx, actor), p = await accessible(tx, u, processId), technical = u.role === "TECHNICAL_STAFF";
    const grants = await tx.clearanceGrant.findMany({ where: { userId: u.id, active: true, department: { active: true } }, select: { departmentId: true } });
    const steps = await tx.clearanceStep.findMany({ where: { processId, AND: [clearanceStepScope(u)] }, include: stepInclude, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    const historyWhere: Prisma.ClearanceHistoryWhereInput = { processId, ...(u.role === "STUDENT" ? { studentVisible: true } : {}), ...(technical ? { stepId: { in: steps.map(s => s.id) } } : {}) };
    const history = await tx.clearanceHistory.findMany({ where: historyWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, skip: page * 30 });
    const historyTotal = await tx.clearanceHistory.count({ where: historyWhere });
    const document = !technical ? await tx.clearanceDocument.findUnique({ where: { processId }, select: { createdAt: true, invalidatedAt: true } }) : null;
    return { id: p.id, number: p.number, studentName: p.studentName, groupName: p.groupName, reason: technical ? null : p.reason, basisNote: technical ? null : p.basisNote, orderNumber: technical ? null : p.orderNumber, orderDate: technical ? null : p.orderDate,
      serviceRequestId: u.role === "STUDENT" || u.role === "DEANERY_STAFF" ? p.serviceRequestId : null, templateName: technical ? null : p.templateName, startsOn: p.startsOn, plannedOn: p.plannedOn, openedAt: p.openedAt, completedAt: p.completedAt, status: p.status, version: p.version, role: u.role,
      steps: steps.map(s => ({ ...s, canReview: ["TECHNICAL_STAFF", "DEANERY_STAFF"].includes(u.role) && grants.some(g => g.departmentId === s.departmentId) && !s.isFinal })), history, historyTotal, historyPage: page, hasDocument: Boolean(document && !document.invalidatedAt && p.status === "COMPLETED") };
  });
}
export async function clearanceContext(db: PrismaClient, actor: ClearanceActor, q = "", page = 0) {
  pageNumber(page);
  return db.$transaction(async tx => {
    const u = await clearanceActor(tx, actor);
    const departments = await tx.clearanceDepartment.findMany({ where: u.role === "TECHNICAL_STAFF" ? { active: true, grants: { some: { userId: u.id, active: true } } } : u.role === "STUDENT" ? { id: { in: [] } } : {}, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 200, include: { grants: { select: { userId: true, active: true, user: { select: { name: true, role: true } } } } } });
    const templates = ["ADMIN", "DEANERY_STAFF"].includes(u.role) ? await tx.clearanceTemplate.findMany({ where: u.role === "ADMIN" ? {} : { active: true }, include: { rules: true }, orderBy: { name: "asc" }, take: 100 }) : [];
    const studentWhere: Prisma.StudentProfileWhereInput = { user: { role: "STUDENT", AND: nameSearch(q) }, group: { department: { deaneryAssignments: { some: { userId: u.id } } } } };
    const students = u.role === "DEANERY_STAFF" ? await tx.studentProfile.findMany({ where: { AND: [studentWhere] }, select: { userId: true, user: { select: { name: true } }, group: { select: { code: true } } }, orderBy: { userId: "asc" }, take: 20, skip: page * 20 }) : [];
    const studentTotal = u.role === "DEANERY_STAFF" ? await tx.studentProfile.count({ where: studentWhere }) : 0;
    const users = u.role === "ADMIN" ? await tx.user.findMany({ where: { role: { in: ["DEANERY_STAFF", "TECHNICAL_STAFF"] }, AND: nameSearch(q) }, select: { id: true, name: true, role: true }, take: 20, skip: page * 20, orderBy: { id: "asc" } }) : [];
    const userTotal = u.role === "ADMIN" ? await tx.user.count({ where: { role: { in: ["DEANERY_STAFF", "TECHNICAL_STAFF"] }, AND: nameSearch(q) } }) : 0;
    const audit = u.role === "ADMIN" ? await tx.clearanceHistory.findMany({ where: { processId: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, skip: page * 30 }) : [];
    return { role: u.role, departments, templates, students, studentTotal, users, userTotal, audit };
  });
}
export async function downloadClearance(db: PrismaClient, actor: ClearanceActor, processId: string) {
  return db.$transaction(async tx => {
    const u = await clearanceActor(tx, actor), p = await accessible(tx, u, processId);
    if (u.role === "TECHNICAL_STAFF" || p.status !== "COMPLETED") throw new ClearanceError("Итоговый документ недоступен.", 404);
    const document = await tx.clearanceDocument.findUnique({ where: { processId } });
    if (!document || document.invalidatedAt || hash(Buffer.from(document.content)) !== document.sha256) throw new ClearanceError("Документ недоступен или не прошёл проверку целостности.", 404);
    return { bytes: Buffer.from(document.content), number: p.number };
  });
}
export type ClearanceWire<T> = T extends Date ? string : T extends (infer R)[] ? ClearanceWire<R>[] : T extends object ? { [K in keyof T]: ClearanceWire<T[K]> } : T;
export type ClearanceDetail = ClearanceWire<Awaited<ReturnType<typeof clearanceDetail>>>;
export type ClearanceFeed = ClearanceWire<Awaited<ReturnType<typeof listClearances>>>;
export type ClearanceContext = ClearanceWire<Awaited<ReturnType<typeof clearanceContext>>>;
