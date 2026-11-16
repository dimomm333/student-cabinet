"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { categories } from "@/lib/services-catalog";
import { serviceFetch, serviceUrl, serviceStatusLabels, serviceDate, type CatalogService, type RequestRow } from "@/lib/services-ui";
import { ServiceRequestScreen } from "./services-request-screen";
import { Icon } from "./icon";

export function ServicesWorkspace({ path, student, requestId, serviceCode, initialTab }: { path: string; student: boolean; requestId: string; serviceCode: string; initialTab: string }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogService[]>([]), [matches, setMatches] = useState<CatalogService[]>([]);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""), [question, setQuestion] = useState(""), [suggestions, setSuggestions] = useState<CatalogService[]>([]);
  const [tab, setTab] = useState(student ? initialTab === "drafts" ? "drafts" : initialTab === "requests" ? "requests" : "catalog" : "requests");
  const [appeal, setAppeal] = useState(false), [rows, setRows] = useState<RequestRow[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ status: "", code: "", from: "", to: "" });
  const createKey = useRef<{ code: string; key: string } | null>(null), inFlight = useRef(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    serviceFetch<{ items: CatalogService[] }>("/api/services").then(data => { if (active) { setCatalog(data.items); setMatches(data.items); setError(""); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    if (!student || tab !== "catalog" || requestId || serviceCode) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { serviceFetch<{ items: CatalogService[] }>(serviceUrl({ view: "catalog", q: query }), { signal: controller.signal }).then(data => setMatches(data.items)).catch(e => { if (!controller.signal.aborted) setError(e.message); }); }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, tab, student, requestId, serviceCode]);
  useEffect(() => {
    if (!appeal || !question.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { serviceFetch<{ items: CatalogService[] }>(serviceUrl({ view: "suggest", q: question }), { signal: controller.signal }).then(data => setSuggestions(data.items.filter(s => s.code !== "deanery-appeal").slice(0, 4))).catch(e => { if (!controller.signal.aborted) setError(e.message); }); }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [question, appeal]);
  useEffect(() => {
    if (tab === "catalog" || requestId || serviceCode) return;
    let active = true;
    const params: Record<string, string> = { view: "requests", page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
    if (tab === "drafts") params.status = "DRAFT";
    serviceFetch<{ items: RequestRow[]; total: number }>(serviceUrl(params)).then(data => { if (active) { setRows(data.items); setTotal(data.total); setError(""); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, requestId, serviceCode, page, filters, reload]);
  async function create(code: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    if (createKey.current?.code !== code) createKey.current = { code, key: crypto.randomUUID() };
    try {
      const result = await serviceFetch<{ id: string }>("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "CREATE", code, requestId: createKey.current.key }) });
      createKey.current = null;
      router.push(path + "?requestId=" + encodeURIComponent(result.id));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); inFlight.current = false; }
  }
  const changeTab = (value: string) => { setLoading(value !== "catalog"); setTab(value); setPage(0); setError(""); };
  const selected = catalog.find(s => s.code === serviceCode);
  return <div className="services-workspace">
    <div className="dashboard-title"><div><span className="eyebrow">{student ? "Кабинет студента" : "Обработка заявлений"}</span><h1>{student ? "Услуги" : path.startsWith("/deanery") ? "Заявки и заявления" : path.startsWith("/admin") ? "Заявки студентов" : "Заявления студентов"}</h1><p>{student ? "Документы, учебные и личные вопросы — в одном месте." : "Только заявления в пределах ваших действующих полномочий."}</p></div></div>
    {requestId ? <ServiceRequestScreen key={requestId} id={requestId} path={path} student={student} /> : <>
      {error && <div className="services-error" role="alert">{error} <button type="button" onClick={() => setReload(n => n + 1)}>Повторить загрузку</button></div>}
      {serviceCode ? selected ? <section className="panel services-panel"><Link href={path} className="text-link">← Каталог услуг</Link><h2>{selected.title}</h2><p>{selected.description}</p><p>Подготовьте сведения: {selected.fields.map(f => f.label).join(", ")}.</p><p>{selected.documents.length ? "Приложения: " + selected.documents.map(d => d.label).join(", ") + ". PNG/JPEG до 8 МиБ." : "Обязательных приложений нет."}</p>{!selected.available && <p className="services-notice">{!selected.enabled ? "Приём по услуге отключён." : "Маршрут обработки пока не настроен. Можно подготовить черновик."}</p>}<button className="button button-primary" disabled={busy || !selected.enabled} onClick={() => void create(selected.code)}>{busy ? "Создаём…" : "Создать черновик"}</button></section> : <p role="status">{loading ? "Загружаем услугу…" : "Услуга не найдена."}</p> : <>
        {student && <nav className="services-tabs" aria-label="Услуги и заявления">{[["catalog", "Каталог услуг"], ["requests", "Мои заявления"], ["drafts", "Черновики"]].map(([value, label]) => <button key={value} type="button" aria-current={tab === value ? "page" : undefined} onClick={() => changeTab(value)}>{label}</button>)}</nav>}
        {tab === "catalog" ? <>
          <label className="services-search"><Icon name="grid" /><span className="sr-only">Поиск услуг</span><input type="search" placeholder="Название услуги или ваш вопрос" aria-label="Поиск услуг" maxLength={1000} value={query} onChange={e => setQuery(e.target.value)} /></label>
          {loading && <p role="status">Загружаем каталог…</p>}
          {!loading && !matches.some(s => s.category) && <p className="panel services-panel" role="status">Подходящих услуг не найдено. Попробуйте другие слова или обратитесь в деканат.</p>}
          <div className="services-categories">{Object.entries(categories).map(([category, title]) => {
            const items = matches.filter(s => s.category === category);
            return items.length ? <section className="panel services-category" key={category}><h2><Icon name={category === "DOCUMENTS" ? "folder" : category === "FINANCE" ? "briefcase" : category === "ACADEMIC" ? "book" : "user"} />{title}</h2><ul>{items.map(service => <li key={service.code}><Link href={path + "?service=" + service.code}><span><strong>{service.title}</strong><small>{service.description}</small>{!service.available && <small className="services-muted">{service.enabled ? "Доступен черновик · приём пока не настроен" : "Приём отключён"}</small>}</span><Icon name="chevron" size={17} /></Link></li>)}</ul></section> : null;
          })}</div>
          <section className="panel services-panel services-appeal"><span className="eyebrow">Не нашли нужную услугу?</span><h2>Обращение в деканат</h2><p>Опишите вопрос — предложим подходящую услугу. Общее обращение доступно независимо от подсказок.</p>{!appeal ? <button className="button button-secondary" onClick={() => setAppeal(true)}>Описать вопрос</button> : <><label className="services-field">Ваш вопрос<textarea value={question} maxLength={1000} onChange={e => setQuestion(e.target.value)} /></label>{question.trim() && <div className="services-suggestions"><h3>Возможно, вам подойдёт</h3>{suggestions.length ? suggestions.map(s => <Link key={s.code} href={path + "?service=" + s.code}>{s.title}<small>{s.category ? categories[s.category] : ""}</small></Link>) : <p>Подходящих подсказок пока нет.</p>}</div>}<button className="button button-primary" onClick={() => void create("deanery-appeal")} disabled={busy}>{busy ? "Создаём…" : "Продолжить общее обращение"}</button><p className="services-muted">Вопрос для поиска не переносится в выбранную форму.</p></>}</section>
        </> : <>
          <section className="panel services-panel"><h2>{student ? tab === "drafts" ? "Мои черновики" : "Мои заявления" : "Очередь обработки"}</h2>
            <div className="services-filters">
              {tab !== "drafts" && <label>Статус<select value={filters.status} onChange={e => { setLoading(true); setFilters({ ...filters, status: e.target.value }); setPage(0); }}><option value="">Все статусы</option>{Object.entries(serviceStatusLabels).filter(([key]) => student || key !== "DRAFT").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
              <label>Услуга<select value={filters.code} onChange={e => { setLoading(true); setFilters({ ...filters, code: e.target.value }); setPage(0); }}><option value="">Все услуги</option>{catalog.map(s => <option key={s.code} value={s.code}>{s.title}</option>)}</select></label>
              <label>С даты<input type="date" value={filters.from} onChange={e => { setLoading(true); setFilters({ ...filters, from: e.target.value }); setPage(0); }} /></label><label>По дату<input type="date" value={filters.to} onChange={e => { setLoading(true); setFilters({ ...filters, to: e.target.value }); setPage(0); }} /></label>
              <button type="button" className="button button-secondary" onClick={() => setReload(n => n + 1)}>Обновить</button>
            </div>
            {loading ? <p role="status">Загружаем заявления…</p> : rows.length ? <div className="services-request-list">{rows.map(row => <Link className="services-request-row" href={path + "?requestId=" + row.id} key={row.id}><div><strong>{catalog.find(s => s.code === row.serviceCode)?.title ?? row.serviceCode}</strong><small>№ {row.id}</small><small>Подача: {serviceDate(row.submittedAt)} · Обновлено: {serviceDate(row.updatedAt)}</small></div><span className={"services-status status-" + row.status}>{serviceStatusLabels[row.status]}</span><Icon name="chevron" size={16} /></Link>)}</div> : <p className="services-empty">{student ? "Заявлений пока нет. Выберите услугу в каталоге." : "Нет доступных заявлений по выбранным условиям. Для обработки необходимы явные назначения на услуги и подразделения."}</p>}
            <div className="services-pagination"><button disabled={page === 0 || loading} onClick={() => { setLoading(true); setPage(n => n - 1); }}>← Назад</button><span>Страница {page + 1} · Всего: {total}</span><button disabled={(page + 1) * 50 >= total || loading} onClick={() => { setLoading(true); setPage(n => n + 1); }}>Далее →</button></div>
          </section>
        </>}
      </>}
    </>}
  </div>;
}
