import "server-only";
import type { Prisma } from "../generated/prisma/client.ts";
import { calculateBrs, effectiveModules, finalRating, type BrsCalculation } from "./brs-rules.ts";
import { exactDto, fraction } from "./brs-exact.ts";
import { physicalLimits, physicalPlan } from "./physical-education-rules.ts";
import { compareSlot, occurrenceKey } from "./physical-education-schedule.ts";
import { effectiveSchedule, loadScheduleRecords, type EffectivePair } from "./schedule-effective.ts";
import type { FullPlan } from "./brs-repository.ts";

export const isPhysicalPlan = (plan: { templateVersion: string }) => plan.templateVersion === physicalPlan;

export async function latestHealth(db: Prisma.TransactionClient, studentId: string) {
  return db.peHealth.findFirst({ where: { studentId }, orderBy: [{ assignedAt: "desc" }, { id: "desc" }] });
}

export async function physicalCalculation(db: Prisma.TransactionClient, plan: FullPlan, studentId: string, now = new Date(), termSlots?: EffectivePair[]) {
  const memberships = await db.peMembership.findMany({
    where: { enrollment: { studentId, termId: plan.termId } },
    select: { group: { select: { planId: true, plan: { select: { groupId: true, disciplineId: true, termId: true } } } } },
  });
  const groups = memberships.map(row => row.group.plan);
  const planIds = [...new Set(memberships.map(row => row.group.planId))];
  const [marks, scores, health, schedule] = await Promise.all([
    db.brsAttendance.findMany({ where: { studentId, occurrence: { planId: { in: planIds } } }, include: { occurrence: true } }),
    db.brsResult.findMany({ where: { studentId, deleted: false, event: { physicalWork: { isNot: null }, module: { planId: { in: planIds } } } }, include: { event: true } }),
    latestHealth(db, studentId),
    termSlots ?? loadScheduleRecords(db).then(records => effectiveSchedule(records, plan.term.startsOn, plan.term.endsOn, "personal")),
  ]);
  const live = new Map(schedule.filter(slot => slot.status !== "MOVED_FROM" && groups.some(group =>
    slot.record.termId === group.termId && slot.record.lesson.disciplineId === group.disciplineId
      && slot.record.lesson.groups.some(link => link.groupId === group.groupId)))
    .map(slot => [occurrenceKey(slot), slot]));
  const attendance = marks.filter(mark => {
    const slot = live.get(mark.occurrence.sourceKey);
    return slot && !slot.cancelled && compareSlot(slot.date, slot.record.endMinute, slot.record.term.timeZone, now) <= 0;
  });
  const visits = new Set(attendance.filter(mark => mark.mark === "PRESENT" || mark.mark === "ACTIVE")
    .map(mark => mark.occurrence.sourceKey)).size;
  const sum = (kind: "STANDARD" | "INTERIM") => scores.filter(item => item.event.kind === kind).reduce((total, item) => total + (item.score ?? 0), 0);
  const physical = { visits, attendance: Math.min(physicalLimits.attendance, visits * physicalLimits.visitScore),
    standards: Math.min(physicalLimits.standards, sum("STANDARD")), control: Math.min(physicalLimits.controls, sum("INTERIM")) };
  const total = physical.attendance + physical.standards + physical.control;
  const ready = visits >= physicalLimits.visits && total >= physicalLimits.minimum;
  const eligibility = health ? [health.category] : [];
  const applicable = await db.peWork.findMany({
    where: { event: { module: { planId: plan.id } }, categories: { some: { category: { in: eligibility } } } },
    select: { eventId: true },
  });
  const workIds = new Set([...applicable.map(item => item.eventId), ...scores.map(item => item.eventId)]);
  const modules = effectiveModules(plan.modules.map(item => ({ ...item, events: item.events.filter(event => workIds.has(event.id)) })), scores, []);
  const base = calculateBrs("CREDIT", modules, []);
  const rating = finalRating(total);
  const workStates = { ...base.workStates };
  for (const event of modules.flatMap(module => module.events)) {
    if (event.result?.score != null) workStates[event.id] = { ...workStates[event.id], state: "MET", category: "COMPLETE", reason: "Выставлены баллы" };
  }
  const calculation: BrsCalculation = {
    ...base, physical, total, semesterScore: total, rating, exactTotal: exactDto(fraction(total)), exactSemester: exactDto(fraction(total)),
    ready, provisionalGrade: ready ? "Зачтено" : "Не зачтено", finalCalculatedRating: ready ? rating : null,
    academic: { state: ready ? "MET" : "PENDING", problems: [] }, semesterStatus: ready ? "COMPLETE" : "WAITING",
    missing: ready ? 0 : Number(visits < physicalLimits.visits) + Number(total < physicalLimits.minimum), workStates,
    modules: base.modules.map(module => ({ ...module, score: total, exactScore: exactDto(fraction(total)), seminarScore: physical.attendance,
      academicStatus: ready ? "COMPLETE" : "WAITING", complete: ready })),
  };
  return { calculation, results: scores, attendance, attempts: [], admission: null, modules };
}
