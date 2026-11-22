import "server-only";
import { isPhysicalPlan } from "./physical-education-brs.ts";
import { brsResultSignature, emitBrsChanges, type BrsNotificationState } from "./notifications-sources.ts";
import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { authorizePlan, calculateStudent, fail, freshActor, planInclude, studentInPlan, BrsError, type BrsActor, type BrsDB, type FullPlan } from "./brs-repository.ts";
import { requireDeaneryGroup } from "./deanery-repository.ts";
import { brsSchedule, moduleWeeks, syncOccurrences } from "./brs-schedule.ts";
import { controlLabels, template, distribute, type Control, labLabels, attendanceLabels, timingLabels } from "./brs-rules.ts";
import { compare, converted, fraction, roundedHundredths } from "./brs-exact.ts";
import { gradingSettings } from "./brs-scales.ts";
import { isoDate, mondayOf, parseCalendarDate, WEEK_MS } from "./schedule-calendar.ts";

export type BrsCommand = { operation: string; requestId: string; planId?: string; revision?: number;
  groupId?: string; disciplineId?: string; termId?: string; teacherId?: string; assignmentId?: string; control?: string; moduleCount?: number;
  eventId?: string; moduleId?: string; studentId?: string; occurrenceId?: string; attemptId?: string;
  version?: number; score?: number | null; passed?: boolean | null; labStatus?: string | null; mark?: string | null;
  submittedOn?: string | null; checkedOn?: string | null; performedOn?: string | null; defendedOn?: string | null; heldOn?: string;
  comment?: string; commentVisible?: boolean; reason?: string; confirmed?: boolean; state?: string;
  title?: string; kind?: string; week?: number; plannedOn?: string | null; issuedOn?: string | null; deadline?: string | null;
  maxScore?: number; required?: boolean; labMinScore?: number | null; labRequiresDefense?: boolean; examOn?: string | null;
  primaryMax?: number; primaryScore?: number | null; scoringMode?: string; scaleVersion?: number; submissionTiming?: string | null;
};
const json = (value: unknown) => value == null ? null : JSON.stringify(value);
async function notificationState(tx: BrsDB, plan: FullPlan, studentId: string, command: BrsCommand): Promise<BrsNotificationState> {
  const current = await calculateStudent(tx, plan, studentId);
  const final = await tx.brsFinal.findUnique({ where: { planId_studentId: { planId: plan.id, studentId } } });
  const result = command.eventId ? current.results.find(r => r.eventId === command.eventId) : command.operation.includes("ATTEMPT") ? current.attempts.find(a => a.id === command.attemptId) ?? current.attempts.at(-1) : null;
  return { result: brsResultSignature(result), final: final ? JSON.stringify([final.score, final.rating, final.grade, final.needsReview]) : null,
    admission: plan.control === "EXAM" ? current.calculation.admissionStatus : plan.control === "DISTRIBUTED" ? current.calculation.academic.state : "" };
}
function text(value: unknown, max = 1000) { if (typeof value !== "string" || value.length > max) fail("Некорректный текст поля."); return value.trim(); }
function date(value: unknown): Date | null { if (value === null || value === undefined || value === "") return null; if (typeof value !== "string") fail("Некорректная дата."); return parseCalendarDate(value) ?? fail("Укажите существующую дату."); }
function integer(value: unknown, min: number, max: number) { if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) fail("Значение вне допустимого диапазона."); return value as number; }
function version(expected: number | undefined, actual: number) { if (expected !== actual) fail("Данные изменились. Обновите страницу и повторите действие.", 409); }
function requireReason(command: BrsCommand) { const reason = text(command.reason ?? ""); if (reason.length < 5) fail("Укажите причину изменения (не менее 5 символов)."); return reason; }
function role(actor: BrsActor, expected: string) { if (actor.role !== expected) fail("Операция недоступна вашей роли.", 403); }
function validScore(value: unknown, max: number): number | null { return value === null ? null : integer(value, 0, max); }
async function audit(db: BrsDB, actor: BrsActor, command: BrsCommand, objectId: string, before: unknown, after: unknown, hash: string, planId?: string, action = command.operation) {
  await db.brsAudit.create({ data: { actorId: actor.id, requestId: command.requestId, commandHash: hash, objectId, planId, action,
    beforeJson: json(before), afterJson: json(after), reason: text(command.reason ?? "") } });
}
async function reconcileAdmission(tx: BrsDB, actor: BrsActor, command: BrsCommand, plan: FullPlan, studentId: string, hash: string) {
  const current = await calculateStudent(tx, plan, studentId);
  if (!current.admission?.approved) return;
  if (current.calculation.academic.state === "MET") {
    await tx.brsAdmission.update({ where: { id: current.admission.id }, data: { basedRevision: plan.revision + 1 } });
  } else {
    const invalid = await tx.brsAdmission.update({ where: { id: current.admission.id }, data: { approved: false, reason: "Основания допуска утрачены после изменения результатов. Требуется новое подтверждение.", decidedAt: new Date(), basedRevision: plan.revision + 1, version: { increment: 1 } } });
    await audit(tx, actor, { ...command, requestId: command.requestId + ":invalidate:" + studentId, reason: invalid.reason }, studentId, current.admission, invalid, hash, plan.id, "INVALIDATE");
  }
}
export async function createDraft(db: BrsDB, actor: BrsActor, command: BrsCommand) {
  role(actor, "DEANERY_STAFF");
  await requireDeaneryGroup(db, actor, { id: command.groupId ?? "" });
  const term = await db.academicTerm.findUnique({ where: { id: command.termId ?? "" } });
  if (!term || !await db.discipline.findUnique({ where: { id: command.disciplineId ?? "" } })) fail("Выберите существующую дисциплину и период.");
  const control = command.control as Control;
  if (!Object.hasOwn(controlLabels, control)) fail("Выберите вид итогового контроля.");
  const count = integer(command.moduleCount, 2, 3);
  const existing = await db.brsPlan.findUnique({ where: { groupId_disciplineId_termId: { groupId: command.groupId!, disciplineId: command.disciplineId!, termId: term.id } } });
  if (existing) fail("План для этой группы, дисциплины и периода уже существует.", 409);
  const weeks = moduleWeeks(term.startsOn, term.endsOn, count);
  const plan = await db.brsPlan.create({ data: { groupId: command.groupId!, disciplineId: command.disciplineId!, termId: term.id, control, templateVersion: "brs-demo-v1" } });
  const schedule = await brsSchedule(db, plan);
  await syncOccurrences(db, plan.id, schedule);
  for (const item of template(control, count)) {
    const range = weeks[item.number - 1];
    const brsModule = await db.brsModule.create({ data: { ...item, ...range, planId: plan.id } });
    const middle = Math.floor((range.startWeek + range.endWeek) / 2), final = range.endWeek - 1;
    for (const [kind, week, title, maxScore] of [["HOMEWORK", Math.max(range.startWeek, range.endWeek - 2), `ДЗ ${item.number}`, item.workMax], ["INTERIM", middle, `РК ${item.number}`, item.controlMax / 2], ["FINAL", final, `РК/М ${item.number}`, item.controlMax / 2]] as const) {
      const candidates = schedule.filter(pair => !pair.cancelled && pair.week >= range.startWeek && pair.week <= range.endWeek);
      const pair = candidates.sort((a, b) => Math.abs(a.week - week) - Math.abs(b.week - week) || a.date.localeCompare(b.date))[0];
      const issued = schedule.find(pair => pair.week >= range.startWeek && pair.week <= week && !pair.cancelled);
      const occurrence = pair ? await db.brsOccurrence.findUnique({ where: { planId_sourceKey: { planId: plan.id, sourceKey: pair.sourceKey } } }) : null;
      await db.brsEvent.create({ data: { moduleId: brsModule.id, kind, week: pair?.week ?? week, title, number: item.number, maxScore,
        plannedOn: pair ? new Date(pair.date) : null, issuedOn: kind === "HOMEWORK" && issued ? new Date(issued.date) : null,
        deadline: kind === "HOMEWORK" && pair ? new Date(pair.date) : null, occurrenceId: kind !== "HOMEWORK" ? occurrence?.id : null } });
    }
  }
  return plan;
}
export async function publish(db: BrsDB, plan: FullPlan) {
  if (plan.publishedAt) fail("План уже опубликован. Максимумы зафиксированы.");
  const schedule = await brsSchedule(db, plan);
  await syncOccurrences(db, plan.id, schedule);
  const expected = template(plan.control, plan.modules.length);
  let total = plan.control === "EXAM" ? 3000 : 0;
  for (const brsModule of plan.modules) {
    const t = expected[brsModule.number - 1];
    if (!t || t.seminarMax !== brsModule.seminarMax || t.workMax !== brsModule.workMax || t.controlMax !== brsModule.controlMax) fail("Максимумы модуля не соответствуют шаблону.");
    const work = brsModule.events.filter(event => ["HOMEWORK", "LAB"].includes(event.kind));
    const controls = brsModule.events.filter(event => ["INTERIM", "FINAL"].includes(event.kind));
    if (work.reduce((sum, event) => sum + event.maxScore, 0) !== brsModule.workMax) fail(`Модуль ${brsModule.number}: сумма ДЗ/ЛР должна равняться общему фонду.`);
    if (controls.length !== 2 || !controls.some(event => event.kind === "INTERIM") || !controls.some(event => event.kind === "FINAL") || controls.some(event => event.maxScore !== brsModule.controlMax / 2)) fail("Необходимы два РК с равными максимумами.");
    if (controls.find(event => event.kind === "INTERIM")!.plannedOn! > controls.find(event => event.kind === "FINAL")!.plannedOn!) fail("Промежуточный РК не может быть позже итогового РК.");
    for (const event of brsModule.events) {
      if (event.week < brsModule.startWeek || event.week > brsModule.endWeek || !event.plannedOn) fail(`${event.title}: задайте неделю и дату в пределах модуля.`);
      if (["INTERIM", "FINAL"].includes(event.kind) && !event.occurrenceId) fail(`${event.title}: выберите конкретное занятие для контроля.`);
      const live = schedule.find(pair => !pair.cancelled && pair.date === isoDate(event.plannedOn!) && pair.week === event.week && (!event.occurrenceId || plan.occurrences.some(occurrence => occurrence.id === event.occurrenceId && occurrence.sourceKey === pair.sourceKey)));
      const actualWeek = Math.floor((mondayOf(event.plannedOn).getTime() - mondayOf(plan.term.startsOn).getTime()) / WEEK_MS) + 1;
      if (event.plannedOn < plan.term.startsOn || event.plannedOn > plan.term.endsOn || actualWeek !== event.week) fail(`${event.title}: дата не соответствует учебной неделе.`);
      if (!live && (event.occurrenceId || ["INTERIM", "FINAL"].includes(event.kind))) fail(`${event.title}: дата не согласована с фактическим расписанием.`);
      if (event.kind === "HOMEWORK" && (!event.issuedOn || !event.deadline || event.issuedOn > event.deadline || event.deadline > controls.find(event => event.kind === "FINAL")!.plannedOn!)) fail(`${event.title}: проверьте дату выдачи и дедлайн до итогового РК.`);
      if (event.kind === "LAB" && event.required && (event.labMinScore === null || event.labMinScore < 0 || event.labMinScore > event.maxScore)) fail(`${event.title}: задайте критерий закрытия ЛР.`);
    }
    const seminars = schedule.filter(pair => !pair.cancelled && ["PRACTICE", "SEMINAR"].includes(pair.kind) && pair.week >= brsModule.startWeek && pair.week <= brsModule.endWeek);
    if (!seminars.length || seminars.length > 300 || seminars.length > brsModule.seminarMax) fail(`Модуль ${brsModule.number}: нет подходящих семинарских занятий или требуется корректировка плана.`);
    const maxima = distribute(brsModule.seminarMax, seminars.length);
    for (let i = 0; i < seminars.length; i++) {
      const pair = seminars[i];
      const occurrence = await db.brsOccurrence.findUniqueOrThrow({ where: { planId_sourceKey: { planId: plan.id, sourceKey: pair.sourceKey } } });
      await db.brsEvent.create({ data: { moduleId: brsModule.id, kind: "SEMINAR", title: `Семинар ${i + 1} · модуль ${brsModule.number}`, number: i + 1, week: pair.week, plannedOn: new Date(pair.date), occurrenceId: occurrence.id, maxScore: maxima[i], required: false } });
    }
    total += brsModule.seminarMax + brsModule.workMax + brsModule.controlMax;
  }
  if (total !== 10000) fail("Сумма максимумов дисциплины должна быть 100.");
  const assignment = await db.teachingAssignment.findFirst({ where: { groupId: plan.groupId, disciplineId: plan.disciplineId, termId: plan.termId, isActive: true, teacher: { role: "TEACHER" } } });
  if (!assignment) fail("Сначала подтвердите учебное назначение преподавателя.");
  await db.brsPlan.update({ where: { id: plan.id }, data: { publishedAt: new Date() } });
}

export async function finalizeBrs(db: BrsDB, actor: BrsActor, plan: FullPlan, studentId: string, expectedVersion: number | undefined) {
  role(actor, "TEACHER");
  await studentInPlan(db, actor, plan, studentId);
  const where = { planId_studentId: { planId: plan.id, studentId } };
  const official = await db.brsFinal.findUnique({ where });
  version(expectedVersion, official?.version ?? 0);
  const current = await calculateStudent(db, plan, studentId);
  if (!current.calculation.ready) fail(isPhysicalPlan(plan)
    ? "Для зачёта необходимо не менее 25 подтверждённых посещений и 60 баллов."
    : "Для фиксации завершите обязательные работы, выставление баллов, модули и предусмотренный экзамен.");
  const values = { authorId: actor.id, score: current.calculation.total, rating: current.calculation.rating, grade: current.calculation.provisionalGrade,
    basisJson: JSON.stringify({ calculation: current.calculation, resultVersions: current.results.map(r => [r.id, r.version]),
      attemptVersions: current.attempts.map(a => [a.id, a.version]), attendanceVersions: current.attendance.map(a => [a.id, a.version]) }),
    basedRevision: plan.revision + 1, approvedAt: new Date(), needsReview: false };
  return db.brsFinal.upsert({ where, update: { ...values, version: { increment: 1 } }, create: { ...values, planId: plan.id, studentId } });
}

export async function executeBrsCommand(db: PrismaClient, actor: BrsActor, command: BrsCommand) {
  if (!command || typeof command.operation !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(command.requestId ?? "")) fail("Некорректная команда или ключ запроса.");
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  try {
    return await db.$transaction(async tx => {
      // Same schedule lock as the editor: publication/result checks see a stable timetable.
      await tx.scheduleWriteState.upsert({ where: { id: "schedule" }, create: { id: "schedule", revision: 0 }, update: { revision: { increment: 0 } } });
      await tx.brsWriteState.upsert({ where: { id: "brs" }, create: { id: "brs", revision: 0 }, update: { revision: { increment: 0 } } });
      await freshActor(tx, actor, true);
      if (actor.role === "STUDENT") fail("Студенту доступен только просмотр.", 403);
      let plan = command.planId ? await authorizePlan(tx, actor, command.planId) : null;
      if (plan && isPhysicalPlan(plan) && command.operation !== "FINALIZE") fail("Изменения учебных результатов выполняются в разделе «Физкультура».");
      if (command.operation === "CREATE_PLAN" || command.operation === "ASSIGN") {
        role(actor, "DEANERY_STAFF"); await requireDeaneryGroup(tx, actor, { id: command.groupId ?? "" });
        if (await tx.peGroup.count({ where: { plan: { groupId: command.groupId ?? "" } } })) fail("Спортивные назначения меняются в разделе «Физкультура».");
      }
      if (command.operation === "REVOKE_ASSIGN") {
        role(actor, "DEANERY_STAFF");
        const assignment = await tx.teachingAssignment.findUnique({ where: { id: command.assignmentId ?? "" } });
        if (!assignment) fail("Назначение недоступно.");
        await requireDeaneryGroup(tx, actor, { id: assignment.groupId });
      }
      const retry = await tx.brsAudit.findUnique({ where: { actorId_requestId: { actorId: actor.id, requestId: command.requestId } } });
      if (retry) { if (retry.commandHash !== hash) fail("Ключ запроса уже использован для другой команды.", 409); return { objectId: retry.objectId, planId: retry.planId, message: "Запрос уже выполнен." }; }
      const notificationStudents = plan?.publishedAt ? command.studentId ? [command.studentId] : ["RELINK", "SYNC", "EXAM_DATE"].includes(command.operation) ? (await tx.studentProfile.findMany({ where: { groupId: plan.groupId, user: { role: "STUDENT" } }, select: { userId: true } })).map(s => s.userId) : [] : [];
      const notificationBefore = new Map<string, BrsNotificationState>();
      for (const id of notificationStudents) notificationBefore.set(id, await notificationState(tx, plan!, id, command));
      let objectId = plan?.id ?? "", before: unknown = null, after: unknown = null;
      if (command.operation === "CREATE_PLAN") {
        plan = await tx.brsPlan.findUniqueOrThrow({ where: { id: (await createDraft(tx, actor, command)).id }, include: planInclude }); objectId = plan.id; after = plan;
      } else if (command.operation === "ASSIGN" || command.operation === "REVOKE_ASSIGN") {
        role(actor, "DEANERY_STAFF");
        if (command.operation === "ASSIGN") {
          if (!await tx.user.findFirst({ where: { id: command.teacherId ?? "", role: "TEACHER" } }) || !await tx.discipline.findUnique({ where: { id: command.disciplineId ?? "" } }) || !await tx.academicTerm.findUnique({ where: { id: command.termId ?? "" } })) fail("Выберите существующие данные назначения.");
          const key = { teacherId: command.teacherId!, groupId: command.groupId!, disciplineId: command.disciplineId!, termId: command.termId! };
          const old = await tx.teachingAssignment.findUnique({ where: { teacherId_groupId_disciplineId_termId: key } });
          if (old) { version(command.version, old.version); requireReason(command); }
          before = old;
          const saved = old ? await tx.teachingAssignment.update({ where: { id: old.id }, data: { isActive: true, confirmedAt: new Date(), version: { increment: 1 } } }) : await tx.teachingAssignment.create({ data: key });
          objectId = saved.id; after = saved;
        } else {
          const old = await tx.teachingAssignment.findUniqueOrThrow({ where: { id: command.assignmentId! } });
          version(command.version, old.version); requireReason(command); before = old;
          after = await tx.teachingAssignment.update({ where: { id: old.id }, data: { isActive: false, version: { increment: 1 } } }); objectId = old.id;
        }
      } else {
        if (!plan) fail("Выберите план БРС.");
        version(command.revision, plan.revision);
        const event = plan.modules.flatMap(brsModule => brsModule.events).find(event => event.id === command.eventId);
        if (event && command.moduleId && command.moduleId !== event.moduleId) fail("Мероприятие не относится к указанному модулю.");
        const brsModule = plan.modules.find(brsModule => brsModule.id === (event?.moduleId ?? command.moduleId));
        if (["GRADING_SETTINGS", "PRIMARY_SCALE"].includes(command.operation)) {
          role(actor, "TEACHER");
          if (!event || !plan.publishedAt) fail("Выберите мероприятие опубликованного плана.");
          if (command.maxScore !== undefined && command.maxScore !== event.maxScore) fail("Рейтинговый максимум зафиксирован планом и недоступен преподавателю для изменения.");
          version(command.scaleVersion, event.scaleVersion);
          if (event.kind === "SEMINAR") fail("Семинарские баллы определяются посещаемостью.");
          const settings = gradingSettings(command.scoringMode ?? "PRIMARY", command.primaryMax);
          before = event;
          after = await tx.brsEvent.update({ where: { id: event.id }, data: { ...settings, scaleVersion: { increment: 1 } } });
          objectId = event.id;
        } else if (["EDIT_EVENT", "ADD_WORK", "REMOVE_WORK"].includes(command.operation)) {
          role(actor, "DEANERY_STAFF");
          if (plan.publishedAt) fail("Опубликованный план неизменяем. Максимумы и история сохранены.");
          if (command.operation === "REMOVE_WORK") {
            if (!event || !["HOMEWORK", "LAB"].includes(event.kind)) fail("Удалять можно только ДЗ/ЛР черновика.");
            before = event; objectId = event.id; await tx.brsEvent.delete({ where: { id: event.id } });
          } else {
            if (!brsModule || command.operation === "EDIT_EVENT" && !event) fail("Мероприятие недоступно.");
            if (command.operation === "ADD_WORK" && brsModule.events.length >= 100) fail("В одном модуле поддерживается до 100 работ. Уточните план.");
            const kind = command.operation === "EDIT_EVENT" ? event!.kind : command.kind;
            if (command.operation === "ADD_WORK" && !["HOMEWORK", "LAB"].includes(kind ?? "")) fail("Выберите ДЗ или ЛР.");
            const maxScore = integer(command.maxScore, 1, 10000);
            if (["INTERIM", "FINAL"].includes(kind!) && maxScore !== brsModule.controlMax / 2) fail("РК делят фонд поровну.");
            const plannedOn = date(command.plannedOn), occurrenceId = command.occurrenceId || null;
            const occurrence = occurrenceId ? plan.occurrences.find(item => item.id === occurrenceId) : null;
            if (occurrenceId && !occurrence) fail("Занятие недоступно.");
            const values = { title: text(command.title, 160), week: integer(command.week, brsModule.startWeek, brsModule.endWeek), plannedOn,
              issuedOn: date(command.issuedOn), deadline: date(command.deadline), maxScore, required: command.required === true,
              labMinScore: command.labMinScore == null ? null : integer(command.labMinScore, 0, maxScore), labRequiresDefense: command.labRequiresDefense !== false, occurrenceId };
            if (!values.title) fail("Укажите название мероприятия.");
            before = event;
            const saved = event ? await tx.brsEvent.update({ where: { id: event.id }, data: values }) : await tx.brsEvent.create({ data: { ...values, moduleId: brsModule.id, kind: kind as "LAB", number: brsModule.events.filter(item => item.kind === kind).length + 1 } });
            objectId = saved.id; after = saved;
          }
        } else if (command.operation === "PUBLISH") {
          role(actor, "DEANERY_STAFF"); before = plan; await publish(tx, plan); after = await tx.brsPlan.findUnique({ where: { id: plan.id }, include: planInclude });
        } else if (command.operation === "EXAM_DATE") {
          role(actor, "DEANERY_STAFF"); requireReason(command); before = { examOn: plan.examOn };
          if (!["EXAM", "DISTRIBUTED"].includes(plan.control)) fail("Для этой дисциплины отдельный экзамен не предусмотрен.");
          after = await tx.brsPlan.update({ where: { id: plan.id }, data: { examOn: date(command.examOn) } });
        } else if (command.operation === "SYNC" || command.operation === "RELINK") {
          role(actor, "DEANERY_STAFF"); requireReason(command);
          const schedule = await brsSchedule(tx, plan); await syncOccurrences(tx, plan.id, schedule);
          if (command.operation === "RELINK") {
            if (!event || event.kind === "HOMEWORK") fail("Выберите мероприятие с привязкой к занятию.");
            const occurrence = await tx.brsOccurrence.findFirst({ where: { id: command.occurrenceId, planId: plan.id } });
            const live = occurrence && schedule.find(pair => pair.sourceKey === occurrence.sourceKey && !pair.cancelled);
            if (event.kind === "SEMINAR" && plan.modules.some(item => item.events.some(other => other.kind === "SEMINAR" && other.id !== event.id && other.occurrenceId === occurrence?.id))) fail("Это занятие уже связано с другим семинаром плана. Двойное начисление недопустимо.");
            if (!live || !brsModule || live.week < brsModule.startWeek || live.week > brsModule.endWeek || event.kind === "SEMINAR" && !["SEMINAR", "PRACTICE"].includes(live.kind)) fail("Занятие должно подходить мероприятию и входить в его модуль.");
            const protectedFinals = event.kind === "SEMINAR" && event.occurrenceId !== occurrence!.id ? await tx.brsFinal.findMany({ where: { planId: plan.id } }) : [];
            const previous = new Map<string, Awaited<ReturnType<typeof calculateStudent>>["calculation"]>();
            for (const final of protectedFinals) previous.set(final.studentId, (await calculateStudent(tx, plan, final.studentId)).calculation);
            before = event;
            const saved = await tx.brsEvent.update({ where: { id: event.id }, data: { occurrenceId: occurrence!.id, plannedOn: new Date(live.date), week: live.week } }); objectId = event.id;
            const reviewIds: string[] = [];
            if (protectedFinals.length) {
              const nextPlan = await tx.brsPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
              for (const final of protectedFinals) {
                const next = (await calculateStudent(tx, nextPlan, final.studentId)).calculation, prior = previous.get(final.studentId)!;
                if (JSON.stringify(prior.exactTotal) !== JSON.stringify(next.exactTotal) || prior.missing !== next.missing) {
                  await tx.brsFinal.update({ where: { id: final.id }, data: { needsReview: true, version: { increment: 1 } } }); reviewIds.push(final.id);
                }
              }
            }
            after = { event: saved, officialReviews: reviewIds };
          } else after = { synced: true, maximaUnchanged: true };
        } else {
          if (!plan.publishedAt) fail("Сначала опубликуйте план БРС.");
          if (command.operation === "MODULE_STATE") {
            fail("Академическая завершённость модуля определяется автоматически по обязательным работам студента.");
          } else {
            const studentId = text(command.studentId, 128);
            objectId = studentId;
            const existingResult = event ? await tx.brsResult.findUnique({ where: { eventId_studentId: { eventId: event.id, studentId } } }) : null;
            const existingAttempt = command.attemptId ? await tx.brsExamAttempt.findFirst({ where: { id: command.attemptId, planId: plan.id, studentId } }) : null;
            const existingAttendance = command.occurrenceId ? await tx.brsAttendance.findUnique({ where: { occurrenceId_studentId: { occurrenceId: command.occurrenceId, studentId } } }) : null;
            const historicalCorrection = actor.role === "TEACHER" && (
              ["RESULT", "DELETE_RESULT", "RESTORE_RESULT"].includes(command.operation) ? existingResult?.authorId === actor.id
                : ["ATTEMPT", "DELETE_ATTEMPT", "RESTORE_ATTEMPT"].includes(command.operation) ? existingAttempt?.authorId === actor.id
                  : command.operation === "ATTENDANCE" ? existingAttendance?.authorId === actor.id : false);
            await studentInPlan(tx, actor, plan, studentId, historicalCorrection);
            const official = await tx.brsFinal.findUnique({ where: { planId_studentId: { planId: plan.id, studentId } } });
            if (["RESULT", "DELETE_RESULT", "RESTORE_RESULT"].includes(command.operation)) {
              role(actor, "TEACHER");
              if (!event || !brsModule) fail("Мероприятие недоступно.");
              if (event.kind === "SEMINAR") fail("Семинарские баллы определяются посещаемостью. Измените отметку занятия.");
              if (existingResult && existingResult.authorId !== actor.id) fail("Изменять чужую запись запрещено.", 403);
              version(command.version, existingResult?.version ?? 0);
              if (event.occurrenceId) {
                const occurrence = plan.occurrences.find(item => item.id === event.occurrenceId)!;
                const live = (await brsSchedule(tx, plan)).find(pair => pair.sourceKey === occurrence.sourceKey);
                if ((!live || live.cancelled || live.kind !== occurrence.kind || live.week < brsModule.startWeek || live.week > brsModule.endWeek) && command.operation !== "DELETE_RESULT") fail("Занятие отменено или изменено. Деканату необходимо разрешить конфликт привязки.");
              }
              if (["RESULT", "RESTORE_RESULT"].includes(command.operation) && plan.control === "DISTRIBUTED" && event.kind === "FINAL" && brsModule.number === plan.modules.length) {
                if ((await calculateStudent(tx, plan, studentId)).calculation.academic.state !== "MET") fail("К последнему РК не допущен: закройте обязательные работы предыдущих модулей. Сессионная попытка доступна отдельно.");
              }
              before = existingResult;
              if (command.operation === "DELETE_RESULT") {
                if (!existingResult || existingResult.deleted) fail("Активная запись для удаления не найдена.");
                after = await tx.brsResult.update({ where: { id: existingResult.id }, data: { deleted: true, version: { increment: 1 } } });
              } else if (command.operation === "RESTORE_RESULT") {
                if (!existingResult || !existingResult.deleted) fail("Удалённая запись для восстановления не найдена.");
                after = await tx.brsResult.update({ where: { id: existingResult.id }, data: { deleted: false, version: { increment: 1 } } });
              } else {
                const timed = ["HOMEWORK", "INTERIM", "FINAL"].includes(event.kind);
                const submissionTiming = timed ? command.submissionTiming ?? "NOT_SUBMITTED" : null;
                if (submissionTiming != null && !Object.hasOwn(timingLabels, submissionTiming)) fail("Выберите состояние сдачи работы.");
                const mode = command.scoringMode ?? event.scoringMode;
                if (mode !== event.scoringMode) fail("Способ ввода изменился. Откройте форму заново.", 409);
                let primaryScore: number | null = null, primaryMax: number | null = null, score: number | null = null;
                let exact = null, scoreSource = event.scoringMode;
                if (timed && submissionTiming === "NOT_SUBMITTED") {
                  // The result is intentionally unset and the prior value remains in the audit.
                } else if (timed && submissionTiming === "LATE") {
                  exact = fraction(event.maxScore, 2); scoreSource = "LATE";
                } else if (mode === "PRIMARY") {
                  if (!event.primaryMax) fail("Сначала настройте максимальный первичный балл работы.");
                  primaryMax = event.primaryMax;
                  primaryScore = command.primaryScore == null ? null : integer(command.primaryScore, 0, primaryMax);
                  if (primaryScore !== null) exact = converted(primaryScore, primaryMax, event.maxScore);
                } else if (mode === "RATING") {
                  score = validScore(command.score ?? null, event.maxScore);
                  if (score !== null) exact = fraction(score);
                } else fail("Выберите способ выставления баллов.");
                if (exact) score = roundedHundredths(exact);
                const passed = timed ? score === null || submissionTiming === "NOT_SUBMITTED" ? null : compare(exact!, fraction(event.maxScore, 2)) >= 0 : null;
                const labStatus = command.labStatus === undefined ? existingResult?.labStatus ?? null : command.labStatus;
                if (labStatus != null && !Object.hasOwn(labLabels, labStatus) && !(labStatus === "IN_PROGRESS" && existingResult?.labStatus === labStatus)) fail("Некорректный статус ЛР.");
                const values = { score, primaryScore, primaryMax, scoreSource, exactNumerator: exact ? String(exact.n) : null, exactDenominator: exact ? String(exact.d) : null, submissionTiming, passed, labStatus, submittedOn: command.submittedOn === undefined ? existingResult?.submittedOn ?? null : date(command.submittedOn), checkedOn: command.checkedOn === undefined ? existingResult?.checkedOn ?? null : date(command.checkedOn), performedOn: date(command.performedOn), defendedOn: date(command.defendedOn), comment: text(command.comment ?? ""), commentVisible: command.commentVisible === true, deleted: false };
                if (values.checkedOn && values.submittedOn && values.checkedOn < values.submittedOn) fail("Проверка не может предшествовать сдаче.");
                if (values.defendedOn && (!values.performedOn || values.defendedOn < values.performedOn)) fail("Защита не может предшествовать выполнению ЛР.");
                after = existingResult ? await tx.brsResult.update({ where: { id: existingResult.id }, data: { ...values, version: { increment: 1 } } }) : await tx.brsResult.create({ data: { ...values, eventId: event.id, studentId, authorId: actor.id } });
              }
            } else if (command.operation === "ATTENDANCE") {
              role(actor, "TEACHER");
              const occurrence = plan.occurrences.find(item => item.id === command.occurrenceId);
              if (!occurrence) fail("Занятие недоступно.");
              const live = (await brsSchedule(tx, plan)).find(pair => pair.sourceKey === occurrence.sourceKey);
              if (!live || live.cancelled) fail("За отменённое занятие посещаемость не требуется. Существующие отметки сохранены.");
              const changesSeminar = plan.modules.some(item => item.events.some(event => event.kind === "SEMINAR" && event.occurrenceId === occurrence.id)) && existingAttendance?.mark !== (command.mark ?? null);
              if (existingAttendance && existingAttendance.authorId !== actor.id) fail("Изменять чужую отметку запрещено.", 403);
              version(command.version, existingAttendance?.version ?? 0);
              if (command.mark != null && !Object.hasOwn(attendanceLabels, command.mark)) fail("Некорректная отметка.");
              before = existingAttendance;
              after = existingAttendance ? await tx.brsAttendance.update({ where: { id: existingAttendance.id }, data: { mark: command.mark ?? null, version: { increment: 1 } } }) : await tx.brsAttendance.create({ data: { occurrenceId: occurrence.id, studentId, authorId: actor.id, mark: command.mark ?? null } });
              if (official && changesSeminar) await tx.brsFinal.update({ where: { id: official.id }, data: { needsReview: true, version: { increment: 1 } } });
            } else if (command.operation === "CONFIRM" || command.operation === "REVOKE") {
              role(actor, "DEANERY_STAFF"); requireReason(command);
              if (plan.control !== "EXAM") fail("Официальный допуск деканата применяется только к обычному экзамену.");
              const current = await calculateStudent(tx, plan, studentId);
              version(command.version, current.admission?.version ?? 0);
              if (command.operation === "CONFIRM" && current.calculation.academic.state !== "MET") fail("Академические условия не выполнены. Подтверждение допуска невозможно.");
              if (command.operation === "REVOKE" && !current.admission?.approved) fail("Действующий допуск отсутствует.");
              before = current.admission;
              const values = { approved: command.operation === "CONFIRM", authorId: actor.id, decidedAt: new Date(), basedRevision: plan.revision + 1, reason: command.reason! };
              after = current.admission ? await tx.brsAdmission.update({ where: { id: current.admission.id }, data: { ...values, version: { increment: 1 } } }) : await tx.brsAdmission.create({ data: { ...values, planId: plan.id, studentId } });
            } else if (["ATTEMPT", "DELETE_ATTEMPT", "RESTORE_ATTEMPT"].includes(command.operation)) {
              role(actor, "TEACHER");
              if (!["EXAM", "DISTRIBUTED"].includes(plan.control)) fail("Отдельный экзамен не предусмотрен.");
              if (command.attemptId && !existingAttempt) fail("Попытка недоступна.", 403);
              if (existingAttempt && existingAttempt.authorId !== actor.id) fail("Изменять чужую попытку запрещено.", 403);
              version(command.version, existingAttempt?.version ?? 0);
              const current = await calculateStudent(tx, plan, studentId);
              before = existingAttempt;
              if (command.operation === "DELETE_ATTEMPT") {
                if (!existingAttempt || existingAttempt.deleted) fail("Активная попытка для удаления не найдена.");
                after = await tx.brsExamAttempt.update({ where: { id: existingAttempt.id }, data: { deleted: true, version: { increment: 1 } } });
              } else if (command.operation === "RESTORE_ATTEMPT") {
                if (!existingAttempt || !existingAttempt.deleted) fail("Удалённая попытка для восстановления не найдена.");
                if (plan.control === "EXAM" && current.calculation.admissionStatus !== "Допущен") fail(`Экзамен недоступен: ${current.calculation.admissionStatus}.`);
                after = await tx.brsExamAttempt.update({ where: { id: existingAttempt.id }, data: { deleted: false, version: { increment: 1 } } });
              } else {
                if ((!existingAttempt || existingAttempt.deleted) && plan.control === "EXAM" && current.calculation.admissionStatus !== "Допущен") fail(`Экзамен недоступен: ${current.calculation.admissionStatus}.`);
                const score = integer(command.score, 0, current.calculation.examMax);
                const heldOn = date(command.heldOn); if (!heldOn || typeof command.passed !== "boolean") fail("Укажите фактическую дату и успешность попытки.");
                const values = { score, passed: plan.control === "DISTRIBUTED" ? score * 2 >= current.calculation.examMax : command.passed, heldOn, comment: text(command.comment ?? ""), commentVisible: command.commentVisible === true, deleted: false };
                after = existingAttempt ? await tx.brsExamAttempt.update({ where: { id: existingAttempt.id }, data: { ...values, version: { increment: 1 } } }) : await tx.brsExamAttempt.create({ data: { ...values, planId: plan.id, studentId, authorId: actor.id, admissionVersion: plan.control === "EXAM" ? current.admission!.version : null, number: (await tx.brsExamAttempt.aggregate({ where: { planId: plan.id, studentId }, _max: { number: true } }))._max.number! + 1 || 1 } });
              }
            } else if (command.operation === "FINALIZE") {
              before = official;
              after = await finalizeBrs(tx, actor, plan, studentId, command.version);
            } else fail("Неизвестная операция.");
            if (["RESULT", "DELETE_RESULT", "RESTORE_RESULT", "ATTEMPT", "DELETE_ATTEMPT", "RESTORE_ATTEMPT"].includes(command.operation) && official) await tx.brsFinal.update({ where: { id: official.id }, data: { needsReview: true, version: { increment: 1 } } });
            if (["RESULT", "DELETE_RESULT", "RESTORE_RESULT"].includes(command.operation) && plan.control === "EXAM") {
              await reconcileAdmission(tx, actor, command, plan, studentId, hash);
            }
          }
        }
        await tx.brsPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
      }
      await audit(tx, actor, command, objectId, before, after, hash, plan?.id);
      if (plan && notificationStudents.length) {
        const updatedPlan = await tx.brsPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
        for (const studentId of notificationStudents) await emitBrsChanges(tx, { key: `${actor.id}:${command.requestId}`, planId: plan.id, studentId, eventId: command.eventId, before: notificationBefore.get(studentId)!, after: await notificationState(tx, updatedPlan, studentId, command) });
      }
      return { objectId, planId: plan?.id ?? null, message: "Изменения сохранены." };
    }, { timeout: 30000, maxWait: 15000 });
  } catch (error) {
    if (error instanceof BrsError) throw error;
    if (error instanceof Error && "code" in error && ["P2034", "P1008", "P2028", "P2002"].includes(String(error.code))) fail("Данные изменяются другим пользователем. Обновите страницу и повторите действие.", 409);
    throw error;
  }
}
