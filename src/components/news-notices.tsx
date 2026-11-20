import type { getLatestNews } from "@/lib/news";
import { Icon } from "./icon";
import { presentNews } from "@/lib/news-presentation";

const format = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });

export function NewsNotices({ items }: { items: Awaited<ReturnType<typeof getLatestNews>> }) {
  return <div className="notice-grid">{items.map(record => {
    const item = presentNews(record);
    const [excerpt, ...detail] = item.content.split(/\r?\n\s*\r?\n/);
    return <article className="notice-card" key={item.id}>
      <div className="notice-meta"><span>{item.category}</span><time dateTime={item.publishedAt.toISOString()}>{format.format(item.publishedAt)}</time></div>
      <h3>{item.title}</h3><p>{excerpt}</p>
      {detail.length > 0 && <details className="news-details"><summary>Подробнее <Icon name="arrow" size={16} /></summary><p>{detail.join("\n\n")}</p></details>}
    </article>;
  })}</div>;
}
