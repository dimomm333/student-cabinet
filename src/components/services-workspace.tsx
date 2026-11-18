"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { categories } from "@/lib/services-catalog";
import { serviceFetch, ServiceApiError, serviceUrl, serviceStatusLabels, serviceDate, type CatalogService, type RequestRow } from "@/lib/services-ui";
import { ServiceRequestScreen } from "./services-request-screen";
import { Icon } from "./icon";
import { recoveryKey, readRecovery, writeRecovery, clearRecovery } from "@/lib/services-recovery";

export function ServicesWorkspace({ path, student, requestId, serviceCode, initialTab, ownerId }: { path: string; student: boolean; requestId: string; serviceCode: string; initialTab: string; ownerId: string }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogService[]>([]), [matches, setMatches] = useState<CatalogService[]>([]);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""), [catalogReviewed, setCatalogReviewed] = useState(false);
  const [tab, setTab] = useState(student ? initialTab === "drafts" ? "drafts" : initialTab === "requests" ? "requests" : "catalog" : "requests");
  const [rows, setRows] = useState<RequestRow[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ status: "", code: "", from: "", to: "" });
  const createKey = useRef<{ code: string; key: string } | null>(null), inFlight = useRef(false);
  const [reload, setReload] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null), [deleting, setDeleting] = useState<string | null>(null);
  const deleteCommands = useRef(new Map<string, { operation: string; id: string; version: number; requestId: string }>());
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
    const pendingCreateKey = recoveryKey(ownerId, "create-" + code);
    if (createKey.current?.code !== code) createKey.current = { code, key: readRecovery<{ key: string }>(pendingCreateKey)?.key ?? crypto.randomUUID() };
    try {
      writeRecovery(pendingCreateKey, { key: createKey.current.key });
      const result = await serviceFetch<{ id: string }>("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "CREATE", code, requestId: createKey.current.key }) });
      clearRecovery(pendingCreateKey);
      createKey.current = null;
      router.push(path + "?requestId=" + encodeURIComponent(result.id));
    } catch (e) {
      if (e instanceof ServiceApiError && e.status >= 400 && e.status < 500) { clearRecovery(pendingCreateKey); createKey.current = null; }
      setError((e as Error).message);
    }
    finally { setBusy(false); inFlight.current = false; }
  }
  const changeTab = (value: string) => { setLoading(value !== "catalog"); setTab(value); setPage(0); setError(""); };
  async function deleteDraft(row: RequestRow) {
    if (inFlight.current || !student || tab !== "drafts" || row.status !== "DRAFT") return;
    inFlight.current = true; setDeleting(row.id); setError("");
    const command = deleteCommands.current.get(row.id) ?? { operation: "DELETE", id: row.id, version: row.version, requestId: crypto.randomUUID() };
    deleteCommands.current.set(row.id, command);
    try {
      await serviceFetch("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      deleteCommands.current.delete(row.id); clearRecovery(recoveryKey(ownerId, row.id));
      setRows(old => old.filter(item => item.id !== row.id)); setTotal(n => Math.max(0, n - 1)); setDeleteConfirm(null);
      if (rows.length === 1 && page > 0) setPage(n => n - 1);
      setReload(n => n + 1); window.dispatchEvent(new Event("services-updated"));
    } catch (error) {
      if (error instanceof ServiceApiError && error.status >= 400 && error.status < 500) deleteCommands.current.delete(row.id);
      setError((error as Error).message);
    } finally { inFlight.current = false; setDeleting(null); }
  }
  const selected = catalog.find(s => s.code === serviceCode);
  return <div className="services-workspace">
    <div className="dashboard-title"><div><span className="eyebrow">{student ? "Кабинет студента" : "Обработка заявлений"}</span><h1>{student ? "Услуги" : path.startsWith("/deanery") ? "Заявки и заявления" : path.startsWith("/admin") ? "Заявки студентов" : "Заявления студентов"}</h1><p>{student ? "Документы, учебные и личные вопросы — в одном месте." : "Только заявления в пределах ваших действующих полномочий."}</p></div></div>
    {requestId ? <ServiceRequestScreen key={requestId} id={requestId} path={path} student={student} ownerId={ownerId} /> : <>
      {error && <div className="services-error" role="alert">{error} <button type="button" onClick={() => setReload(n => n + 1)}>Повторить загрузку</button></div>}
      {serviceCode ? selected ? <section className="panel services-panel"><Link href={path} className="button button-primary services-back">← К каталогу услуг</Link><h2>{selected.title}</h2><p>{selected.description}</p>{selected.eligibility === "NOT_REQUIRED" ? <p className="services-notice">Воинский учёт для вас не требуется</p> : selected.eligibility === "UNKNOWN" ? <p className="services-notice">Статус воинского учёта пока не подтверждён. Вы можете подать заявление для ручной проверки уполномоченным сотрудником. Отсутствие записи не означает освобождение от учёта.</p> : null}{selected.eligibility !== "NOT_REQUIRED" && <><p>Подготовьте сведения: {selected.fields.map(f => f.label).join(", ")}.</p><p>{selected.documents.length ? "Приложения: " + selected.documents.map(d => d.label).join(", ") + "." : "Обязательных приложений нет."}</p>{!selected.available && <p className="services-notice">{!selected.enabled ? "Приём по услуге отключён." : "Маршрут обработки пока не настроен. Можно подготовить черновик."}</p>}<button className="button button-primary" disabled={busy || !selected.enabled} onClick={() => void create(selected.code)}>{busy ? "Создаём…" : "Создать черновик"}</button></>}</section> : <p role="status">{loading ? "Загружаем услугу…" : "Услуга не найдена."}</p> : <>
        {student && <nav className="services-tabs" aria-label="Услуги и заявления">{[["catalog", "Каталог услуг"], ["requests", "Мои заявления"], ["drafts", "Черновики"]].map(([value, label]) => <button key={value} type="button" aria-current={tab === value ? "page" : undefined} onClick={() => changeTab(value)}>{label}</button>)}</nav>}
        {tab === "catalog" ? <>
          <label className="services-search"><Icon name="grid" /><span className="sr-only">Поиск услуг</span><input type="search" placeholder="Название услуги или ваш вопрос" aria-label="Поиск услуг" maxLength={1000} value={query} onChange={e => setQuery(e.target.value)} /></label>
          {loading && <p role="status">Загружаем каталог…</p>}
          {!loading && !matches.some(s => s.category) && <p className="panel services-panel" role="status">Подходящих услуг не найдено. Попробуйте другие слова или обратитесь в деканат.</p>}
          <div className="services-categories">{Object.entries(categories).map(([category, title]) => {
            const items = matches.filter(s => s.category === category);
            return items.length ? <section className="panel services-category" key={category}><h2><Icon name={category === "DOCUMENTS" ? "folder" : category === "FINANCE" ? "briefcase" : category === "ACADEMIC" ? "book" : "user"} />{title}</h2><ul>{items.map(service => <li key={service.code}><Link href={path + "?service=" + service.code}><span><strong>{service.title}</strong><small>{service.description}</small>{!service.available && <small className="services-muted">{service.eligibility === "NOT_REQUIRED" ? "Воинский учёт для вас не требуется" : service.enabled ? "Доступен черновик · приём пока не настроен" : "Приём отключён"}</small>}</span><Icon name="chevron" size={17} /></Link></li>)}</ul></section> : null;
          })}</div>
          <section className="panel services-panel services-appeal" aria-labelledby="deanery-appeal-title">
            <div className="services-appeal-icon" aria-hidden="true"><Icon name="mail" size={24} /></div>
            <div className="services-appeal-copy"><h2 id="deanery-appeal-title">Не нашли подходящую услугу?</h2><p>Если ваш вопрос не относится ни к одной из представленных услуг, вы можете направить общее обращение в деканат.</p><p className="services-muted">Для типовых заявлений пользуйтесь готовыми услугами из каталога.</p>
              <label className="services-confirm"><input type="checkbox" checked={catalogReviewed} onChange={e => setCatalogReviewed(e.target.checked)} />Я просмотрел каталог и не нашёл подходящей услуги</label>
              <button className="button button-primary" disabled={!catalogReviewed || busy} onClick={() => void create("deanery-appeal")}>{busy ? "Создаём…" : "Написать обращение в деканат"}</button>
            </div>
          </section>
        </> : <>
          <section className="panel services-panel"><h2>{student ? tab === "drafts" ? "Мои черновики" : "Мои заявления" : "Очередь обработки"}</h2>
            <div className="services-filters">
              {tab !== "drafts" && <label>Статус<select value={filters.status} onChange={e => { setLoading(true); setFilters({ ...filters, status: e.target.value }); setPage(0); }}><option value="">Все статусы</option>{Object.entries(serviceStatusLabels).filter(([key]) => student || key !== "DRAFT").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
              <label>Услуга<select value={filters.code} onChange={e => { setLoading(true); setFilters({ ...filters, code: e.target.value }); setPage(0); }}><option value="">Все услуги</option>{catalog.map(s => <option key={s.code} value={s.code}>{s.title}</option>)}</select></label>
              <label>С даты<input type="date" value={filters.from} onChange={e => { setLoading(true); setFilters({ ...filters, from: e.target.value }); setPage(0); }} /></label><label>По дату<input type="date" value={filters.to} onChange={e => { setLoading(true); setFilters({ ...filters, to: e.target.value }); setPage(0); }} /></label>
              <button type="button" className="button button-secondary" onClick={() => setReload(n => n + 1)}>Обновить</button>
            </div>
            {loading ? <p role="status">Загружаем заявления…</p> : rows.length ? <div className="services-request-list">{rows.map(row => <div className="services-list-item" key={row.id}><Link className="services-request-row" href={path + "?requestId=" + row.id} key={row.id}><div><strong>{catalog.find(s => s.code === row.serviceCode)?.title ?? row.serviceCode}</strong><small>№ {row.id}</small><small>Подача: {serviceDate(row.submittedAt)} · Обновлено: {serviceDate(row.updatedAt)}</small></div><span className={"services-status status-" + row.status}>{serviceStatusLabels[row.status]}</span><Icon name="chevron" size={16} /></Link>{student && tab === "drafts" && row.status === "DRAFT" && <div className="services-list-actions"><button type="button" className="services-delete-draft" aria-label="Удалить черновик" title="Удалить черновик" disabled={deleting !== null} onClick={() => setDeleteConfirm(row.id)}><Icon name="trash" size={18} /></button></div>}{deleteConfirm === row.id && <div className="services-list-confirm" role="group" aria-label="Подтверждение удаления черновика"><p>Удалить этот черновик?</p><button className="button button-secondary" disabled={deleting !== null} onClick={() => setDeleteConfirm(null)}>Отмена</button><button className="button button-primary" disabled={deleting !== null} onClick={() => void deleteDraft(row)}>{deleting === row.id ? "Удаляем…" : "Да, удалить"}</button></div>}</div>)}</div> : <p className="services-empty">{student ? "Заявлений пока нет. Выберите услугу в каталоге." : "Нет доступных заявлений по выбранным условиям. Для обработки необходимы явные назначения на услуги и подразделения."}</p>}
            <div className="services-pagination"><button disabled={page === 0 || loading} onClick={() => { setLoading(true); setPage(n => n - 1); }}>← Назад</button><span>Страница {page + 1} · Всего: {total}</span><button disabled={(page + 1) * 50 >= total || loading} onClick={() => { setLoading(true); setPage(n => n + 1); }}>Далее →</button></div>
          </section>
        </>}
      </>}
    </>}
  </div>;
}
