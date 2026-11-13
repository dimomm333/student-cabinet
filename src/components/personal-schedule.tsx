import { getPersonalSchedule } from "@/lib/schedule";
import { parseScheduleQuery } from "@/lib/schedule-calendar";
import { ScheduleView } from "./schedule-view";
import { io } from "next/cache";

export async function PersonalSchedule({ role, searchParams }: { role: "STUDENT" | "TEACHER"; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await io();
  const params = await searchParams;
  const query = parseScheduleQuery({ week: params.week, day: params.day, term: params.term });
  const model = await getPersonalSchedule(role, query);
  return <div className="personal-schedule"><div className="dashboard-title"><div><span className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</span><h1>Моё расписание</h1><p>{role === "STUDENT" ? "Занятия вашей учебной группы." : "Ваши занятия по всем учебным группам."}</p></div></div><ScheduleView model={model} path={role === "STUDENT" ? "/dashboard/schedule" : "/teacher/schedule"} view={role === "STUDENT" ? "group" : "teacher"} day={query.day} invalid={query.invalid} personal /></div>;
}
