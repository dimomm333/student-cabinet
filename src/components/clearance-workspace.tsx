"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/generated/prisma/enums";
import type { ClearanceContext, ClearanceDetail, ClearanceFeed } from "@/lib/clearance-repository";
import { clearanceReasons, clearanceStatuses, clearanceStepStatuses, clearanceTerminal } from "@/lib/clearance-shared";
import { ClearanceDialog } from "./clearance-dialog";
import { ClearanceSettings } from "./clearance-settings";
const date = (v: string | null) => v ? new Date(v).toLocaleDateString("ru-RU") : "—";
const formValues = (form: HTMLFormElement) => Object.fromEntries(new FormData(form).entries());
async function read<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T> { const r = await fetch("/api/clearance?" + params, { cache: "no-store", signal }); const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; }
function Status({ value, step = false }: { value: string; step?: boolean }) { return <span className={"clearance-status clearance-status-" + value.toLowerCase()}>{step ? clearanceStepStatuses[value as keyof typeof clearanceStepStatuses] : clearanceStatuses[value as keyof typeof clearanceStatuses]}</span>; }
type Step = ClearanceDetail["steps"][number];
type Modal = { kind: string; step?: Step; remarkId?: string };
export function ClearanceWorkspace({ role }: { role: Role }) {
  const router = useRouter(), pathname = usePathname(), search = useSearchParams(), selected = search.get("id");
  const [feed, setFeed] = useState<ClearanceFeed | null>(null), [detail, setDetail] = useState<ClearanceDetail | null>(null), [context, setContext] = useState<ClearanceContext | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [modal, setModal] = useState<Modal | null>(null);
  const [contextQuery, setContextQuery] = useState(""), [contextPage, setContextPage] = useState(0);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null), [responseKey, setResponseKey] = useState("");
  const requestKey = search.toString() + ":" + revision, loading = requestKey !== responseKey;
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const navigate = (id?: string, page = 0) => { const p = new URLSearchParams(search.toString()); if (id) p.set("id", id); else { p.delete("id"); if (role === "STUDENT") p.set("archive", "1"); } if (page) p.set("page", String(page)); else p.delete("page"); router.push(pathname + (p.size ? "?" + p : "")); };
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams(search.toString()); params.set("view", selected ? "detail" : "list");
    params.delete("archive");
    read<ClearanceDetail | ClearanceFeed>(params, abort.signal).then(d => { if (selected) setDetail(d as ClearanceDetail); else { const feed = d as ClearanceFeed; setFeed(feed); setDetail(null); const active = role === "STUDENT" && !search.has("archive") ? feed.items.find(p => !clearanceTerminal(p.status)) : null; if (active) router.replace(pathname + "?id=" + active.id); } setResponseKey(requestKey); }).catch(e => { if (!abort.signal.aborted) { setError(e.message); setDetail(null); setFeed(null); setResponseKey(requestKey); } });
    return () => abort.abort();
  }, [search, selected, revision, requestKey, role, router, pathname]);
  useEffect(() => {
    if (!["ADMIN", "DEANERY_STAFF", "TECHNICAL_STAFF"].includes(role)) return;
    const abort = new AbortController();
    read<ClearanceContext>(new URLSearchParams({ view: "context", q: contextQuery, page: String(contextPage) }), abort.signal).then(setContext).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [role, contextQuery, contextPage, revision]);
  async function send(command: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError(""); setMessage(""); setPending(command);
    try {
      const r = await fetch("/api/clearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const d = await r.json();
      if (!r.ok) { if (r.status < 500) setPending(null); if (r.status === 409) refresh(); throw new Error(d.error); }
      setPending(null); setModal(null); setMessage("Изменения сохранены."); refresh();
      if (command.operation === "CREATE") navigate(d.id);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось отправить действие."); return false; } finally { setBusy(false); }
  }
  const run = (operation: string, extra: Record<string, unknown> = {}) => send({ operation, requestId: crypto.randomUUID(), ...(detail ? { id: detail.id, version: detail.version } : {}), ...extra });
  function modalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = formValues(event.currentTarget), kind = modal!.kind;
    const extra: Record<string, unknown> = { ...f, ...(modal?.step && kind !== "COMPLETE" ? { stepId: modal.step.id } : {}), ...(modal?.remarkId ? { remarkId: modal.remarkId } : {}) };
    if (kind === "REMARK") extra.amountMinor = f.amount ? Math.round(Number(f.amount) * 100) : null;
    delete extra.amount;
    if (["CANCEL", "INVALIDATE", "APPLICABILITY"].includes(kind)) extra.confirmed = f.confirmed === "on";
    if (kind === "APPLICABILITY") extra.required = f.required === "yes";
    void run(kind, extra);
  }
  const manager = role === "DEANERY_STAFF", student = role === "STUDENT";
  const active = detail && !clearanceTerminal(detail.status) && detail.status !== "DRAFT";
  const approved = detail?.steps.filter(s => !s.isFinal && s.status === "APPROVED").length ?? 0;
  const total = detail?.steps.filter(s => !s.isFinal && s.status !== "NOT_APPLICABLE").length ?? 0;
  return <section className="clearance-workspace" aria-label="Обходной лист">
    <div className="dashboard-title"><div><span className="eyebrow">{student ? "Кампус" : "Работа со студентами"}</span><h1>{role === "ADMIN" ? "Обходные листы" : "Обходной лист"}</h1></div>{selected && <button className="button button-outline" onClick={() => navigate()}>Все обходные листы</button>}</div>
    {error && <div className="clearance-error" role="alert">{error} <button className="clearance-link" disabled={busy} onClick={() => pending ? void send(pending) : refresh()}>{pending ? "Повторить отправку" : "Обновить"}</button></div>}
    {message && <p className="clearance-message" role="status">{message}</p>}
    {loading && <p role="status" className="muted">Загрузка обходного листа…</p>}
    {!selected && !loading && feed && <>
      {!student && <div className="clearance-counters"><p><strong>{Object.entries(feed.counters).filter(([s]) => !["DRAFT", "COMPLETED", "CANCELLED"].includes(s)).reduce((n, [, v]) => n + v, 0)}</strong> активных</p><p><strong>{feed.counters.ACTION_REQUIRED ?? 0}</strong> с замечаниями</p><p><strong>{feed.counters.READY_FOR_FINAL_REVIEW ?? 0}</strong> готовы к завершению</p></div>}
      {manager && context && <details className="clearance-panel"><summary>Создать обходной лист</summary><form className="clearance-search" onSubmit={e => { e.preventDefault(); setContextQuery(String(formValues(e.currentTarget).q)); setContextPage(0); }}><label>Поиск студента по ФИО<input name="q" maxLength={180} /></label><button className="button button-outline">Найти студента</button></form>
        <div className="clearance-pagination"><span>Найдено: {context.studentTotal}</span><button disabled={!contextPage} onClick={() => setContextPage(v => v - 1)}>Назад</button><button disabled={(contextPage + 1) * 20 >= context.studentTotal} onClick={() => setContextPage(v => v + 1)}>Далее</button></div>
        <form onSubmit={e => { e.preventDefault(); void run("CREATE", formValues(e.currentTarget)); }}><fieldset disabled={busy} className="clearance-form"><label>Студент<select name="studentId" required><option value="">Выберите студента</option>{context.students.map(s => <option key={s.userId} value={s.userId}>{s.user.name} · {s.group?.code}</option>)}</select></label><label>Основание и шаблон<select name="templateId" required><option value="">Выберите шаблон</option>{context.templates.map(t => <option key={t.id} value={t.id}>{clearanceReasons[t.reason]} · {t.name}</option>)}</select></label><label>Основание оформления<textarea name="basisNote" maxLength={2000} required placeholder="Решение деканата или другое подтверждённое основание" /></label><div className="clearance-fields"><label>Дата начала<input name="startsOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Планируемое завершение<input name="plannedOn" type="date" /></label><label>Номер приказа, если есть<input name="orderNumber" maxLength={100} /></label><label>Дата приказа<input name="orderDate" type="date" /></label></div><label>ID принятого заявления на отчисление, если есть<input name="serviceRequestId" maxLength={100} /></label><button className="button button-primary">Подготовить черновик</button></fieldset></form></details>}
      {!student && <form className="clearance-filters clearance-panel" onSubmit={e => { e.preventDefault(); const p = new URLSearchParams(); for (const [k, v] of Object.entries(formValues(e.currentTarget))) if (v) p.set(k, String(v)); router.push(pathname + "?" + p); }}>
        <label>Студент или номер<input name="q" defaultValue={search.get("q") ?? ""} maxLength={180} /></label><label>Группа<input name="group" defaultValue={search.get("group") ?? ""} maxLength={100} /></label><label>Статус<select name="status" defaultValue={search.get("status") ?? ""}><option value="">Все статусы</option>{Object.entries(clearanceStatuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>{role !== "TECHNICAL_STAFF" && <label>Основание<select name="reason" defaultValue={search.get("reason") ?? ""}><option value="">Все основания</option>{Object.entries(clearanceReasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}<label>Подразделение<select name="departmentId" defaultValue={search.get("departmentId") ?? ""}><option value="">Все доступные</option>{context?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><button className="button button-outline">Применить</button></form>}
      {!feed.items.length && <div className="clearance-panel clearance-empty"><h2>{student ? "Обходной лист не требуется" : "Обходные листы не найдены"}</h2><p className="muted">{student ? "Он оформляется при завершении или прекращении обучения. Если потребуется, деканат откроет процедуру." : "Измените фильтры или подготовьте новый обходной лист."}</p></div>}
      <div className="clearance-list">{feed.items.map(p => <Link className="clearance-panel clearance-list-item" key={p.id} href={pathname + "?id=" + p.id}><div><h2>{student && p.reason ? clearanceReasons[p.reason] : p.studentName}</h2><p className="muted">{p.groupName} · {date(p.openedAt ?? p.createdAt)}</p><small>{p.number}</small></div><div><Status value={p.status} /><p>Согласовано: {p.approved} из {p.totalSteps}</p>{p.replies > 0 && <p>Ответы для проверки: {p.replies}</p>}</div></Link>)}</div>
      {feed.total > 20 && <div className="clearance-pagination"><button disabled={!feed.page} onClick={() => navigate(undefined, feed.page - 1)}>Назад</button><span>{feed.page + 1} из {Math.ceil(feed.total / 20)}</span><button disabled={(feed.page + 1) * 20 >= feed.total} onClick={() => navigate(undefined, feed.page + 1)}>Далее</button></div>}
      {role === "ADMIN" && context && <ClearanceSettings context={context} busy={busy} error={error} run={(op, data) => send({ operation: op, requestId: crypto.randomUUID(), ...data })} onSearch={q => { setContextQuery(q); setContextPage(0); }} page={contextPage} onPage={setContextPage} />}
    </>}
    {detail && !loading && <>
      <section className="clearance-panel clearance-summary"><div className="clearance-between"><div><h2>{student ? (detail.status === "COMPLETED" ? "Обходной лист завершён" : detail.reason ? clearanceReasons[detail.reason] : "Обходной лист") : detail.studentName}</h2><p className="muted">{detail.groupName} · {detail.number}</p></div><Status value={detail.status} /></div>
        {detail.basisNote && <p>{detail.basisNote}</p>}{detail.reason && !student && <p>{clearanceReasons[detail.reason]}</p>}
        <div className="clearance-fields"><p>Открыт: <strong>{date(detail.openedAt)}</strong></p>{detail.plannedOn && <p>Планируемое завершение: {date(detail.plannedOn)}</p>}{detail.completedAt && <p>Завершён: <strong>{date(detail.completedAt)}</strong></p>}{detail.orderNumber && <p>Приказ: {detail.orderNumber} · {date(detail.orderDate)}</p>}</div>
        <label className="clearance-progress">Согласовано подразделений: {approved} из {total}<progress value={total ? approved : 1} max={total || 1} /></label>
        {student && detail.steps.some(s => s.status === "ACTION_REQUIRED") && <p className="clearance-attention">Требуется ваше действие: {detail.steps.filter(s => s.status === "ACTION_REQUIRED").map(s => s.name).join(", ")}</p>}
        {detail.status === "READY_FOR_FINAL_REVIEW" && <p>Все необходимые проверки согласованы. Ожидается итоговая проверка деканата.</p>}
        <div className="clearance-actions">{detail.hasDocument && <a className="button button-primary" href={"/api/clearance?view=pdf&id=" + detail.id}>Скачать итоговый PDF</a>}{detail.serviceRequestId && <Link className="clearance-link" href={`${student ? "/dashboard/services" : "/deanery/requests"}?requestId=${detail.serviceRequestId}`}>Связанное заявление</Link>}
          {manager && !clearanceTerminal(detail.status) && <>{detail.status === "DRAFT" ? <button className="button button-primary" disabled={busy || detail.steps.some(s => s.needsClarification)} onClick={() => void run("OPEN")}>Открыть обходной лист</button> : <button className="button button-outline" disabled={busy} onClick={() => void run("REMIND")}>Напомнить ответственным</button>}<button className="button button-outline" onClick={() => setModal({ kind: "ADD_STEP" })}>Добавить подразделение</button><button className="clearance-link" onClick={() => setModal({ kind: "CANCEL" })}>Отменить процесс</button></>}
          {role === "ADMIN" && detail.status === "COMPLETED" && <button className="clearance-link" onClick={() => setModal({ kind: "INVALIDATE" })}>Аннулировать документ</button>}
        </div>
      </section>
      <div className="clearance-steps">{detail.steps.map(step => <article className="clearance-panel clearance-step" key={step.id} data-step={step.id}><div className="clearance-between"><h2>{step.name}</h2><Status value={step.status} step /></div><p className="muted">{step.description}</p>{step.needsClarification && <p className="clearance-attention">Требуется уточнение применимости деканатом</p>}{step.applicabilityNote && <p className="muted">{step.applicabilityNote}</p>}<p className="clearance-contact">{step.contact}</p>{step.decidedByName && <p className="muted">{step.decidedByName} · {date(step.decidedAt)}</p>}
        {step.housing && <ul className="clearance-dormitory">
          <li>{step.housing.active ? "Проживание активно" : "Проживание завершено"}</li>
          <li>{step.housing.departed ? "Выезд подтверждён" : step.housing.inspected ? "Комната проверена" : "Сдача комнаты не подтверждена"}</li>
          <li>{step.housing.keysOutstanding ? "Остались ключи к возврату" : "Невозвращённых ключей нет"}</li>
          <li>{step.housing.propertyOutstanding ? "Осталось имущество к возврату" : "Невозвращённого имущества нет"}</li>
          <li>{step.housing.hasDebt ? "Остались начисления к оплате" : "Остатка к оплате нет"}</li>
        </ul>}
        {step.remarks.map(remark => <div key={remark.id} className={"clearance-remark" + (remark.resolvedAt ? " clearance-resolved" : "")}><div className="clearance-between"><h3>{remark.category}</h3><strong>{remark.resolvedAt ? "Замечание снято" : remark.responsePending ? "Ожидает повторной проверки" : "Требуется действие"}</strong></div><p>{remark.description}</p><p><strong>Что сделать: </strong>{remark.requiredAction}</p><p>{remark.contact}</p>{remark.dueOn && <p>Срок: {date(remark.dueOn)}</p>}{remark.amountMinor !== null && <p>Подтверждённая сумма: {(remark.amountMinor / 100).toLocaleString("ru-RU", { style: "currency", currency: "RUB" })}</p>}
          {!!remark.replies.length && <details><summary>Переписка ({remark.replies.length})</summary>{remark.replies.map(reply => <p key={reply.id}><strong>{reply.actorName}</strong> · {date(reply.createdAt)}<br />{reply.text}</p>)}</details>}
          {active && !remark.resolvedAt && student && !remark.responsePending && <button className="button button-outline" onClick={() => setModal({ kind: "REPLY", step, remarkId: remark.id })}>Сообщить об устранении</button>}
          {active && !remark.resolvedAt && step.canReview && remark.responsePending && <button className="button button-outline" onClick={() => setModal({ kind: "REJECT_REPLY", step, remarkId: remark.id })}>Вернуть на устранение</button>}
        </div>)}
        <div className="clearance-actions">{active && step.canReview && !step.needsClarification && !["NOT_APPLICABLE", "APPROVED"].includes(step.status) && <>{step.status === "PENDING" && <button className="button button-outline" disabled={busy} onClick={() => void run("START", { stepId: step.id })}>Начать проверку</button>}<button className="button button-primary" onClick={() => setModal({ kind: "APPROVE", step })}>Согласовать</button></>}{active && step.canReview && !step.needsClarification && step.status !== "NOT_APPLICABLE" && <button className="button button-outline" onClick={() => setModal({ kind: "REMARK", step })}>{step.status === "APPROVED" ? "Возобновить проверку с замечанием" : "Добавить замечание"}</button>}
          {manager && !clearanceTerminal(detail.status) && !step.isFinal && step.status !== "APPROVED" && <button className="clearance-link" onClick={() => setModal({ kind: "APPLICABILITY", step })}>Уточнить применимость</button>}
          {manager && step.isFinal && detail.status === "READY_FOR_FINAL_REVIEW" && <button className="button button-primary" disabled={busy} onClick={() => setModal({ kind: "COMPLETE", step })}>Завершить обходной лист</button>}
        </div>
      </article>)}</div>
      <details className="clearance-panel"><summary>История процедуры ({detail.historyTotal})</summary><ol className="clearance-history">{detail.history.map(h => <li key={h.id}><time>{date(h.createdAt)}</time><div><strong>{h.actorName}</strong><p>{h.text}</p></div></li>)}</ol>{detail.historyTotal > 30 && <div className="clearance-pagination"><button disabled={!detail.historyPage} onClick={() => navigate(detail.id, detail.historyPage - 1)}>Назад</button><span>Страница {detail.historyPage + 1}</span><button disabled={(detail.historyPage + 1) * 30 >= detail.historyTotal} onClick={() => navigate(detail.id, detail.historyPage + 1)}>Далее</button></div>}</details>
    </>}
    {modal && <ClearanceDialog title={({ CANCEL: "Отмена процесса", INVALIDATE: "Аннулирование документа", REMARK: "Добавить замечание", APPROVE: "Подтвердить согласование", REPLY: "Сообщить об устранении", REJECT_REPLY: "Повторное замечание", APPLICABILITY: "Применимость проверки", ADD_STEP: "Добавить подразделение", COMPLETE: "Итоговая проверка" } as Record<string, string>)[modal.kind]} close={() => { if (!busy) setModal(null); }}><form onSubmit={modalSubmit}><fieldset disabled={busy} className="clearance-form">
      {error && <p className="clearance-error" role="alert">{error}</p>}{modal.step && <p><strong>{modal.step.name}</strong></p>}
      {modal.kind === "COMPLETE" ? <p>Подтвердите итоговую проверку. После завершения решения будут сохранены в неизменяемом документе.</p> : modal.kind === "REMARK" ? <><label>Категория<input name="category" maxLength={100} required /></label><label>Подтверждённое замечание<textarea name="description" maxLength={2000} required /></label><label>Что должен сделать студент<textarea name="requiredAction" maxLength={2000} required /></label><label>Контакты<input name="contact" maxLength={500} defaultValue={modal.step?.contact} /></label><label>Срок устранения<input type="date" name="dueOn" /></label><label>Подтверждённая сумма, ₽ (необязательно)<input type="number" name="amount" min="0" max="21474836" step="0.01" /></label></> : <>
        {modal.kind === "APPLICABILITY" && <label>Проверка<select name="required"><option value="yes">Требуется</option><option value="no">Не требуется</option></select></label>}
        {modal.kind === "ADD_STEP" && <label>Подразделение<select name="departmentId" required><option value="">Выберите подразделение</option>{context?.departments.filter(d => d.active && !detail?.steps.some(s => s.departmentId === d.id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        <label>{modal.kind === "REPLY" ? "Что сделано" : modal.kind === "APPROVE" ? "Результат проверки" : "Обоснование"}<textarea name="text" maxLength={2000} required={modal.kind !== "APPROVE" || modal.step?.remarks.some(r => !r.resolvedAt)} /></label>
        {["CANCEL", "INVALIDATE", "APPLICABILITY"].includes(modal.kind) && <label className="clearance-checkbox"><input name="confirmed" type="checkbox" required />Подтверждаю обоснованность решения</label>}
      </>}
      <button className="button button-primary">{busy ? "Сохранение…" : "Подтвердить"}</button>
    </fieldset></form></ClearanceDialog>}
  </section>;
}
