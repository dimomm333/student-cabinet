import "server-only";
import { prisma } from "./prisma";
import { getPublicScheduleData, getPersonalScheduleData, getStudentScheduleOverviewData } from "./schedule-repository";
import { type ScheduleQuery } from "./schedule-calendar";
import { requireRole } from "./access";

export type { PublicChoice, PublicLesson } from "./schedule-repository";
export function getPublicSchedule(query: ScheduleQuery) { return getPublicScheduleData(prisma, query); }
export async function getPersonalSchedule(role: "STUDENT" | "TEACHER", query: ScheduleQuery) {
  const user = await requireRole(role);
  return getPersonalScheduleData(prisma, query, { id: user.id, role });
}

export async function getStudentScheduleOverview(now = new Date()) {
  const user = await requireRole("STUDENT");
  return getStudentScheduleOverviewData(prisma, user.id, now);
}
