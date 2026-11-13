import { Suspense } from "react";
import { PersonalSchedule } from "@/components/personal-schedule";

export default function StudentSchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<p role="status">Загружаем расписание…</p>}><PersonalSchedule role="STUDENT" searchParams={searchParams} /></Suspense>;
}
