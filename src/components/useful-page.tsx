import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { officialHttpUrl, searchUseful, usefulHref, usefulKinds, usefulPath, usefulTree } from "@/lib/useful-catalog";
import { usefulSelect } from "@/lib/useful-repository";
import CabinetPageLoading from "./cabinet-page-loading";
import { Icon } from "./icon";
import { UsefulMarkdown } from "./useful-markdown";

type Props = {
  params?: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" });
const notConnected = "Официальный ресурс пока не подключён. Ссылка появится после её добавления администрацией университета";

async function UsefulContent({ params, searchParams }: Props) {
  await requireRole("STUDENT");
  const id = (await params)?.id;
  const filters = await searchParams;
  const query = typeof filters.q === "string" ? filters.q.trim().slice(0, 120) : "";
  const category = typeof filters.category === "string" ? filters.category : "";
  const published = prisma.usefulEntry.findMany({
    where: { status: "PUBLISHED" }, select: usefulSelect, orderBy: [{ sortOrder: "asc" }, { title: "asc" }, { id: "asc" }],
  });
  const [rows, details] = id ? await prisma.$transaction([
    published,
    prisma.usefulEntry.findUnique({
      where: { id, status: "PUBLISHED" },
      select: { body: true, contacts: true, location: true, updatedAt: true },
    }),
  ]) : [await published, null] as const;
  const tree = usefulTree(rows.map(row => ({ ...row, title: row.academicDepartment?.name ?? row.title })));
  const visibleIds = new Set(tree.descendants(null).map(row => row.id));
  const trail = id && visibleIds.has(id) ? tree.trail(id) : [];
  const entry = trail.at(-1);
  if (id && (!entry || !details)) notFound();
  const entryUrl = officialHttpUrl(entry?.officialUrl ?? "");
  if (entry?.kind === "EXTERNAL" && entryUrl) redirect(entryUrl);

  const roots = tree.children.get(null) ?? [];
  const categoryId = !id ? roots.find(row => row.id === category)?.id : undefined;
  const scope = id ?? categoryId ?? null;
  const matches = query ? searchUseful(tree.descendants(scope), query) : tree.children.get(scope) ?? [];
  const title = entry?.title ?? "Полезное";
  const parent = trail.at(-2);
  const isDirectory = !entry || entry.kind === "DIRECTORY";
  const showCards = isDirectory && matches.length > 0;
  const hasDetails = Boolean(details?.body || details?.contacts || details?.location || entryUrl);

  return <div className="services-workspace useful-workspace">
    {entry && <nav className="useful-crumbs" aria-label="Хлебные крошки"><ol>
      <li><Link href={usefulPath}>Полезное</Link></li>
      {trail.map(item => <li key={item.id}>{item.id === entry.id
        ? <span aria-current="page">{item.title}</span>
        : <Link href={usefulHref(item.id)}>{item.title}</Link>}</li>)}
    </ol></nav>}
    <header className="dashboard-title"><div><h1>{title}</h1>
      <p>{entry?.description || (!entry ? "Инструкции, справочники и официальные ресурсы для студентов." : null)}</p>
    </div></header>

    {entry?.kind === "EXTERNAL" ? <section className="panel services-panel useful-reading">
      <p role="status">{notConnected}</p>
      <Link className="button button-primary" href={usefulPath}>Вернуться в «Полезное»</Link>
    </section> : <>
      {entry && details && (hasDetails || entry.kind === "ARTICLE") &&
        <article className="panel services-panel useful-reading">
          {details.body && <UsefulMarkdown text={details.body} visibleIds={visibleIds} />}
          {(details.contacts || details.location) && <dl className="useful-facts">
            {details.contacts && <div><dt>Контакты</dt><dd>{details.contacts}</dd></div>}
            {details.location && <div><dt>Место</dt><dd>{details.location}</dd></div>}
          </dl>}
          {entryUrl && <p><a href={entryUrl} rel="noreferrer">Официальный ресурс</a></p>}
          <p className="useful-updated">Обновлено <time dateTime={details.updatedAt.toISOString()}>{dateFormat.format(details.updatedAt)}</time></p>
        </article>}

      {isDirectory && (!entry || query || (tree.children.get(scope)?.length ?? 0) > 0) &&
        <form action={entry ? usefulHref(entry.id) : usefulPath} className="useful-search" key={scope ?? "root"}>
          <label className="services-field">Поиск {entry ? "в справочнике" : "по каталогу"}
            <input type="search" name="q" placeholder={entry ? "Название или описание" : "Например, справка об обучении"} defaultValue={query} maxLength={120} />
          </label>
          {!entry && <label className="services-field">Категория
            <select name="category" defaultValue={categoryId ?? ""}>
              <option value="">Все категории</option>
              {roots.map(root => <option key={root.id} value={root.id}>{root.title}</option>)}
            </select>
          </label>}
          <button className="button button-primary" type="submit">Найти</button>
          {(query || categoryId) && <Link className="button button-outline" href={entry ? usefulHref(entry.id) : usefulPath}>Сбросить</Link>}
        </form>}
      {showCards && <section aria-labelledby="useful-results">
        <h2 id="useful-results" className="useful-results-title">{query ? `Результаты поиска (${matches.length})` : !entry && !scope ? "Категории" : "Материалы и разделы"}</h2>
        <ul className="useful-grid">{matches.map(item => {
          const url = item.kind === "EXTERNAL" ? officialHttpUrl(item.officialUrl ?? "") : null;
          const card = <>
            <span className="useful-card-icon"><Icon name={item.kind === "DIRECTORY" ? "folder" : item.kind === "ARTICLE" ? "book" : "arrow"} size={20} /></span>
            <span className="useful-card-copy">
              <strong>{item.title}</strong>
              {item.description && <span>{item.description}</span>}
              {query && <small>{tree.trail(item.id).slice(0, -1).map(parent => parent.title).join(" → ")}</small>}
              {item.kind === "EXTERNAL" && <small>{url ? usefulKinds.EXTERNAL : "Ресурс пока не подключён"}</small>}
            </span>
            <Icon name="chevron" size={16} />
          </>;
          return <li className="panel useful-card" key={item.id}>
            {url ? <a href={url} rel="noreferrer">{card}</a> : <Link href={usefulHref(item.id)}>{card}</Link>}
          </li>;
        })}</ul>
      </section>}
      {isDirectory && !showCards && (query || (!hasDetails && !entry?.academicDepartment)) &&
        <p className="panel services-panel" role="status">{query ? "Ничего не найдено. Попробуйте сократить запрос или изменить категорию." : "Опубликованных вложенных записей пока нет."}</p>}
      {entry && <Link className="button button-outline useful-back" href={parent ? usefulHref(parent.id) : usefulPath}>
        {parent ? "← К разделу" : "← В «Полезное»"}
      </Link>}
    </>}
  </div>;
}

export function UsefulPage(props: Props) {
  return <Suspense fallback={<CabinetPageLoading />}><UsefulContent {...props} /></Suspense>;
}
