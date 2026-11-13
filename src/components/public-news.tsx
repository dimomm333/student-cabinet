import { getLatestNews } from "@/lib/news";
import { io } from "next/cache";
import { NewsNotices } from "./news-notices";

export async function PublicNews() {
  await io();
  let records: Awaited<ReturnType<typeof getLatestNews>>;
  try {
    records = await getLatestNews();
  } catch {
    console.error("portal.news_lookup_failed");
    return <div className="panel p-6" role="status">Не удалось загрузить новости. Попробуйте обновить страницу позже.</div>;
  }
  if (!records.length) return <div className="panel p-6 muted">Пока нет опубликованных объявлений.</div>;
  return <NewsNotices items={records} />;
}
