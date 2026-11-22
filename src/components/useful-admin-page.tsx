import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { searchUseful, usefulAdminPath, usefulKinds, usefulStatuses, usefulTree } from "@/lib/useful-catalog";
import { usefulSelect } from "@/lib/useful-repository";
import CabinetPageLoading from "./cabinet-page-loading";
import { UsefulEditor } from "./useful-editor";

type Props = {
  params?: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Content({ params, searchParams }: Props) {
  await requireRole("ADMIN");
  const id = (await params)?.id;
  const query = await searchParams;
  const rows = await prisma.usefulEntry.findMany({
    select: usefulSelect, orderBy: [{ sortOrder: "asc" }, { title: "asc" }, { id: "asc" }],
  });
  const tree = usefulTree(rows.map(row => ({ ...row, title: row.academicDepartment?.name ?? row.title })));
  const nodes = tree.descendants(null);
  const pathName = (entryId: string) => tree.trail(entryId).map(node => node.title).join(" → ");

  if (!id) {
    const filter = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
    const visible = searchUseful(nodes, filter);
    return <div className="services-workspace useful-workspace">
      <header className="dashboard-title"><div><h1>Справочник «Полезное»</h1><p>Категории, инструкции и официальные ресурсы для студентов.</p></div></header>
      <div className="useful-form-actions"><Link className="button button-primary" href={usefulAdminPath + "/new"}>Добавить запись</Link></div>
      <form action={usefulAdminPath} className="useful-search">
        <label className="services-field">Поиск записей <input name="q" type="search" defaultValue={filter} maxLength={120} /></label>
        <button type="submit" className="button button-outline">Найти</button>
      </form>
      <section className="panel services-panel" aria-label="Записи каталога">
        {!visible.length ? <p>Записи не найдены.</p> : <ul className="useful-admin-list">
          {visible.map(row => <li key={row.id}>
            <Link className="services-request-row" href={usefulAdminPath + "/" + row.id}>
              <div><strong>{row.title}</strong><small>{tree.trail(row.id).slice(0, -1).map(item => item.title).join(" → ")}</small></div>
              <span className="services-status">{usefulStatuses[row.status]}</span>
            </Link>
          </li>)}
        </ul>}
      </section>
    </div>;
  }

  const entry = id === "new" ? null : await prisma.usefulEntry.findUnique({ where: { id } });
  if (id !== "new" && !entry) notFound();
  const requestedParent = typeof query.parent === "string" ? tree.byId.get(query.parent) : undefined;
  const excluded = new Set(entry ? [entry.id, ...tree.descendants(entry.id).map(row => row.id)] : []);
  const parents = nodes.filter(row => row.kind === "DIRECTORY" && !excluded.has(row.id))
    .map(row => ({ id: row.id, title: pathName(row.id) }));
  const departments = await prisma.academicDepartment.findMany({
    select: { id: true, name: true, faculty: true }, orderBy: [{ faculty: "asc" }, { name: "asc" }],
  });
  const parentId = entry ? entry.parentId ?? "" : requestedParent?.kind === "DIRECTORY" ? requestedParent.id : "";
  return <div className="services-workspace useful-workspace">
    <header className="dashboard-title"><div><h1>{entry ? "Редактирование записи" : "Новая запись"}</h1>
      {entry && <p>{pathName(entry.id)} · {usefulKinds[entry.kind]}</p>}
    </div></header>
    {entry && query.saved === "1" && <p className="services-success" role="status">Запись сохранена.</p>}
    {entry?.kind === "DIRECTORY" && <div className="useful-form-actions">
      <Link className="button button-outline" href={usefulAdminPath + "/new?parent=" + entry.id}>Добавить вложенную запись</Link>
    </div>}
    <UsefulEditor key={entry ? entry.id + entry.updatedAt.toISOString() : "new-" + parentId} id={entry?.id ?? null}
      parents={parents} departments={departments.map(item => ({ id: item.id, title: item.faculty + " → " + item.name }))}
      hasChildren={Boolean(entry && tree.children.get(entry.id)?.length)}
      initial={{
        title: entry?.title ?? "", description: entry?.description ?? "", body: entry?.body ?? "",
        contacts: entry?.contacts ?? "", location: entry?.location ?? "", officialUrl: entry?.officialUrl ?? "",
        parentId, academicDepartmentId: entry?.academicDepartmentId ?? "", kind: entry?.kind ?? "DIRECTORY",
        status: entry?.status ?? "DRAFT", sortOrder: String(entry?.sortOrder ?? 0),
      }} />
  </div>;
}

export function UsefulAdminPage(props: Props) {
  return <Suspense fallback={<CabinetPageLoading />}><Content {...props} /></Suspense>;
}
