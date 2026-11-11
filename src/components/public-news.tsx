import { getLatestNews } from "@/lib/news";
import { io } from "next/cache";
import { NewsCards, type NewsCardItem } from "./news-cards";

// Decorative variants stay in the UI; titles, text and dates come from SQLite.
const appearances = [
  { art: "science", icon: "spark" },
  { art: "community", icon: "user" },
  { art: "library", icon: "book" },
] as const;

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Moscow",
});

export async function PublicNews() {
  // Keep the database query out of the static shell, before handling DB errors.
  await io();

  let records: Awaited<ReturnType<typeof getLatestNews>>;

  try {
    records = await getLatestNews();
  } catch (error: unknown) {
    console.error("Не удалось прочитать новости из базы данных:", error);
    return (
      <div className="panel p-6 text-sm text-foreground" role="status">
        Не удалось загрузить новости. Попробуйте обновить страницу позже.
      </div>
    );
  }

  if (records.length === 0) {
    return <div className="panel p-6 text-sm muted">Пока нет опубликованных новостей.</div>;
  }

  const items: NewsCardItem[] = records.map((record, index) => {
    const [firstParagraph, ...remainingParagraphs] = record.content.trim().split(/\r?\n\s*\r?\n/);
    const excerpt = firstParagraph.length > 180
      ? firstParagraph.slice(0, 177).trimEnd() + "…"
      : firstParagraph;

    return {
      id: record.id,
      title: record.title,
      category: "НОВОСТИ",
      date: dateFormat.format(record.publishedAt).replace(/\s*г\.$/, ""),
      dateTime: record.publishedAt.toISOString(),
      excerpt,
      detail: firstParagraph.length > 180 || remainingParagraphs.length === 0
        ? record.content
        : remainingParagraphs.join("\n\n"),
      ...appearances[index % appearances.length],
    };
  });

  return <NewsCards items={items} />;
}
