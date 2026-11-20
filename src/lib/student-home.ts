import "server-only";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { authorizePlan, calculateStudent, freshActor, planInclude, studentPlansWhere, BrsError, type BrsActor } from "./brs-repository.ts";
import { brsSchedule } from "./brs-schedule.ts";
import { controlTitles, numberControlModules, officialState, points, resultPoints, workTitle } from "./brs-rules.ts";
import { currentAcademicDate, isoDate } from "./schedule-calendar.ts";
import { getStudentScheduleOverviewData } from "./schedule-repository.ts";
import { getStudentHomeNews } from "./news-repository.ts";
import { storedDashboardLayout } from "./dashboard-layout.ts";

type Recent = { id: string; discipline: string; title: string; value: string; date: string; href: string };
type Control = { id: string; discipline: string; title: string; date: string; href: string };

export async function studentAcademicSummary(db: PrismaClient, actor: BrsActor, now = new Date()) {
  await freshActor(db, actor);
  if (actor.role !== "STUDENT") throw new BrsError("Доступ закрыт.", 403);
  const scope = { AND: [studentPlansWhere(actor.id), { publishedAt: { lte: now } }] };
  const profile = await db.studentProfile.findUnique({ where: { userId: actor.id }, select: { groupId: true } });
  const [results, finals, plans] = await Promise.all([
    db.brsResult.findMany({ where: { studentId: actor.id, deleted: false, score: { not: null }, updatedAt: { lte: now }, event: { module: { plan: scope } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 3,
      select: { id: true, score: true, scoreSource: true, updatedAt: true, event: { select: { id: true, maxScore: true, module: { select: { planId: true } } } } } }),
    db.brsFinal.findMany({ where: { studentId: actor.id, plan: scope, approvedAt: { lte: now } }, orderBy: [{ approvedAt: "desc" }, { id: "desc" }], take: 3 }),
    db.brsPlan.findMany({ where: { ...scope, groupId: profile?.groupId ?? "" }, include: planInclude, orderBy: { term: { startsOn: "desc" } }, take: 101 }),
  ]);
  if (plans.length > 100) throw new BrsError("Учебных планов слишком много. Требуется уточнить учебный период.", 503);
  const cache = new Map(plans.map(plan => [plan.id, plan]));
  const planFor = async (id: string) => {
    const found = cache.get(id) ?? await authorizePlan(db, actor, id);cache.set(id, found);return found;
  };
  const recent: Recent[] = [];
  const completed = new Set<string>();
  for (const result of results) {
    const plan = await planFor(result.event.module.planId);
    const event = numberControlModules(plan.modules).flatMap(module => module.events).find(event => event.id === result.event.id)!;
    recent.push({ id: result.id, discipline: plan.discipline.title, title: workTitle(event), value: `${resultPoints(result, event.maxScore)} / ${points(event.maxScore)}`,
      date: result.updatedAt.toISOString(), href: `/dashboard/grades?${new URLSearchParams({ planId: plan.id, eventId: event.id })}` });
  }
  for (const final of finals) {
    const plan = await planFor(final.planId);
    const current = await calculateStudent(db, plan, actor.id, isoDate(currentAcademicDate(now, plan.term.timeZone)));
    if (!officialState(final, current.calculation)?.valid) continue;
    completed.add(plan.id);
    recent.push({ id: final.id, discipline: plan.discipline.title, title: controlTitles[plan.control], value: final.grade,
      date: final.approvedAt.toISOString(), href: `/dashboard/session?${new URLSearchParams({ planId: plan.id })}` });
  }
  const upcoming: Control[] = [];
  let undatedHref = "";
  for (const plan of plans) {
    const today = isoDate(currentAcademicDate(now, plan.term.timeZone));
    // Historical plans remain available for results, but do not invent controls
    // outside their actual term or after transfer to a different group.
    if (isoDate(plan.term.endsOn) < today) continue;
    if (completed.has(plan.id)) continue;
    const final = await db.brsFinal.findUnique({ where: { planId_studentId: { planId: plan.id, studentId: actor.id } } });
    if (final && final.approvedAt <= now && officialState(final, (await calculateStudent(db, plan, actor.id, today)).calculation)?.valid) continue;
    const live = await brsSchedule(db, plan);
    const own = await db.brsResult.findMany({ where: { studentId: actor.id, deleted: false, event: { module: { planId: plan.id } } }, select: { eventId: true, score: true } });
    for (const event of numberControlModules(plan.modules).flatMap(module => module.events)) {
      if (event.kind === "SEMINAR" || own.some(result => result.eventId === event.id && result.score !== null)) continue;
      const occurrence = event.occurrenceId ? plan.occurrences.find(item => item.id === event.occurrenceId) : null;
      const actual = occurrence ? live.find(pair => pair.sourceKey === occurrence.sourceKey) : null;
      if (event.occurrenceId && (!actual || actual.cancelled)) continue;
      const date = actual?.date ?? (event.plannedOn ? isoDate(event.plannedOn) : event.deadline ? isoDate(event.deadline) : null);
      const href = `/dashboard/grades?${new URLSearchParams({ planId: plan.id, eventId: event.id })}`;
      if (!date) { undatedHref ||= href;continue; }
      if (date >= today) upcoming.push({ id: event.id, discipline: plan.discipline.title, title: workTitle(event), date, href });
    }
    if (plan.examOn && isoDate(plan.examOn) >= today) upcoming.push({ id: plan.id, discipline: plan.discipline.title, title: controlTitles[plan.control], date: isoDate(plan.examOn), href: `/dashboard/session?${new URLSearchParams({ planId: plan.id })}` });
    else if (!plan.examOn) undatedHref ||= `/dashboard/session?${new URLSearchParams({ planId: plan.id })}`;
  }
  return { recent: recent.sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0,3),
    upcoming: upcoming.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0] ?? null, undatedHref };
}

export async function getStudentHomeData(db: PrismaClient, actor: BrsActor, now = new Date()) {
  await freshActor(db, actor);
  if (actor.role !== "STUDENT") throw new BrsError("Доступ закрыт.", 403);
  const [profile, user, schedule, study, announcements, preference] = await Promise.all([
    db.studentProfile.findUnique({ where: { userId: actor.id }, select: { firstName: true } }),
    db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } }),
    getStudentScheduleOverviewData(db, actor.id, now), studentAcademicSummary(db, actor, now), getStudentHomeNews(db, actor.id, now),
    db.userPreferences.findUnique({ where: { userId: actor.id } }),
  ]);
  return { asOf: now.toISOString(), name: profile?.firstName || user.name.trim().split(/\s+/)[0], schedule, study,
    announcements: announcements.map(item => ({ ...item, publishedAt: item.publishedAt.toISOString() })),
    layout: storedDashboardLayout(preference?.dashboardLayoutJson), layoutVersion: preference?.version ?? 0 };
}
export type StudentHomeData = Awaited<ReturnType<typeof getStudentHomeData>>;
