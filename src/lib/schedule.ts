import "server-only";
import { prisma } from "./prisma";
import { getPublicScheduleData, getPersonalScheduleData } from "./schedule-repository";
import { DAY_MS, WEEK_MS, currentAcademicDate, isoDate, parseScheduleQuery, type ScheduleQuery } from "./schedule-calendar";
import { requireRole } from "./access";

export type { PublicChoice, PublicLesson } from "./schedule-repository";
export function getPublicSchedule(query: ScheduleQuery) { return getPublicScheduleData(prisma, query); }
export async function getPersonalSchedule(role: "STUDENT" | "TEACHER", query: ScheduleQuery) {
  const user = await requireRole(role);
  return getPersonalScheduleData(prisma, query, { id: user.id, role });
}

export async function getStudentScheduleOverview(now = new Date()) {
  const user = await requireRole("STUDENT");
  const query = parseScheduleQuery({}, now);
  const actor = { id: user.id, role: "STUDENT" as const };
  const current = await getPersonalScheduleData(prisma, query, actor);
  const today = isoDate(currentAcademicDate(now));
  const todayCount = current.days.find(day => day.date === today)?.lessons.length ?? 0;
  if (!current.selected) return { todayCount, todayFirst: null, day: null, linked: false };
  const limit = isoDate(new Date(currentAcademicDate(now).getTime() + 14 * DAY_MS));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const candidates = [...current.days];
  for (let i = 1; i <= 2; i++) candidates.push(...(await getPersonalScheduleData(prisma, { ...query, week: new Date(query.week.getTime() + i * WEEK_MS) }, actor)).days);
  const day = candidates.map(day => ({ ...day, lessons: day.lessons.filter(lesson => day.date > today || lesson.end > time) })).find(day => day.date >= today && day.date < limit && day.lessons.length) ?? null;
  return { todayCount, todayFirst: current.days.find(day => day.date === today)?.lessons[0]?.start ?? null, day, linked: true };
}
