import Link from "next/link";
import type { getStudentScheduleOverview } from "@/lib/schedule";
import { currentAcademicDate, isoDate } from "@/lib/schedule-calendar";
import { ScheduleDay } from "./schedule-view";
import { Icon } from "./icon";

export function SchedulePreview({ overview }: { overview: Awaited<ReturnType<typeof getStudentScheduleOverview>> }) {
  return <section className="panel schedule-panel" aria-labelledby="schedule-title">
    <div className="panel-heading"><h2 id="schedule-title">Ближайшие занятия</h2><Link href="/dashboard/schedule" className="text-link">Всё расписание <Icon name="arrow" size={16} /></Link></div>
    {overview.day ? <ScheduleDay day={overview.day} today={isoDate(currentAcademicDate())} /> : <p className="schedule-preview-empty">{overview.linked ? "В ближайшие 14 дней занятий нет." : "Учебная группа пока не привязана к профилю. Обратитесь в учебную часть."}</p>}
    <p className="schedule-note"><Icon name="clock" size={16} />Ближайший день с занятиями в пределах 14 дней · Europe/Moscow</p>
  </section>;
}