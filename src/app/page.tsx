import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { PublicNews } from "@/components/public-news";
import { PortalFooter, PortalHeader } from "@/components/portal-shell";
import { CabinetAction, HomeCabinetAction } from "@/components/home-cabinet-action";

export const metadata: Metadata = { title: "Университетский портал", description: "Личный кабинет, расписание занятий и объявления университета." };

export default function Home() {
  return <div className="portal-home">
    <a className="skip-link" href="#main">Перейти к содержимому</a><PortalHeader />
    <main id="main" className="portal-width">
      <div className="portal-title"><h1>Личный кабинет<br />и расписание</h1></div>
      <section className="portal-actions" aria-label="Основные действия">
        <Suspense fallback={<CabinetAction />}><HomeCabinetAction /></Suspense>
        <Link href="/schedule" className="portal-action portal-action-schedule"><div className="portal-action-top"><Icon name="calendar" size={36} /></div><h2>Расписание</h2><div className="portal-action-bottom"><span>По группам и преподавателям</span><span className="portal-action-arrow"><Icon name="arrow" size={25} /></span></div></Link>
      </section>
      <section className="portal-news" aria-labelledby="portal-news-title"><div className="portal-section-heading"><div><h2 id="portal-news-title">Новости и объявления</h2></div></div><Suspense fallback={<div className="panel p-6 muted" role="status">Загружаем объявления…</div>}><PublicNews /></Suspense></section>
    </main><PortalFooter />
  </div>;
}
