import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import CabinetPageLoading from "@/components/cabinet-page-loading";
import { NewsNotices } from "@/components/news-notices";
import { studentNewsScope } from "@/lib/news-repository";
export const metadata = { title: "Новости и объявления" };
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("STUDENT"), { id } = await searchParams;
  if (id !== undefined && (typeof id !== "string" || id.length > 128)) notFound();
  if (!id) {
    const items = await prisma.$transaction(async tx => tx.news.findMany({ where: await studentNewsScope(tx, user.id), orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 50 }));
    return <><div className="dashboard-title"><h1>Новости и объявления</h1></div>{items.length ? <NewsNotices items={items} /> : <section className="panel notification-settings">Опубликованных объявлений пока нет.</section>}</>;
  }
  const news = await prisma.$transaction(async tx => tx.news.findFirst({ where: { id, isDemo: false, ...await studentNewsScope(tx, user.id) } }));
  if (!news) notFound();
  return <><div className="dashboard-title"><h1>{news.title}</h1></div><article className="panel notification-settings"><time dateTime={news.publishedAt.toISOString()}>{news.publishedAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</time><p style={{ whiteSpace: "pre-wrap" }}>{news.content}</p></article><Link href="/dashboard/notifications" className="text-link">К уведомлениям</Link></>;
}
export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <Suspense fallback={<CabinetPageLoading />}><Content {...props} /></Suspense>; }
