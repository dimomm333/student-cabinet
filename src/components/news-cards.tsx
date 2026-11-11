import { news } from "@/lib/demo-data";
import { Icon } from "./icon";

export function NewsCards({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`news-grid ${compact ? "news-grid-compact" : ""}`}>
      {news.map((item) => (
        <article className="news-card" key={item.id}>
          <div className={`news-art news-art-${item.art}`} aria-hidden="true">
            <span className="art-orbit orbit-one" />
            <span className="art-orbit orbit-two" />
            <Icon name={item.icon} size={54} />
            <span className="art-label">СУ / {item.category}</span>
          </div>
          <div className="news-card-body">
            <div className="news-meta"><span>{item.category}</span><time>{item.date}</time></div>
            <h3>{item.title}</h3>
            <p>{item.excerpt}</p>
            <details className="news-details">
              <summary>Читать новость <Icon name="arrow" size={16} /></summary>
              <p>{item.detail}</p>
            </details>
          </div>
        </article>
      ))}
    </div>
  );
}
