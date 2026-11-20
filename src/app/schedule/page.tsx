import type { Metadata } from "next";
import { Suspense } from "react";
import { PortalFooter, PortalHeader } from "@/components/portal-shell";
import { PublicSchedule } from "@/components/public-schedule";

export const metadata: Metadata = { title: "Публичное расписание", description: "Расписание занятий по группам и преподавателям. Поиск без входа в личный кабинет." };
export default function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <div className="public-schedule"><a className="skip-link" href="#schedule-main">Перейти к содержимому</a><PortalHeader schedule /><main id="schedule-main" className="portal-width"><Suspense fallback={<div className="schedule-loading panel" role="status">Загружаем расписание…</div>}><PublicSchedule searchParams={searchParams} /></Suspense></main><PortalFooter /></div>;
}
