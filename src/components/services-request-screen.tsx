"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { serviceFetch, ServiceApiError, serviceUrl, serviceDate, serviceStatusLabels, optionLabel, type RequestDetail, type HistoryView, type ServiceDocumentView } from "@/lib/services-ui";

const profileLabels: Record<string, string> = { name: "ФИО", group: "Учебная группа", studentNumber: "Студенческий номер", program: "Образовательная программа", military: "Воинский учёт", registrationStatus: "Сведения об учёте", office: "Военкомат", documentType: "Вид документа", documentNumber: "Реквизиты документа", verifiedAt: "Дата подтверждения" };
export function ServiceProfileValues({ values }: { values: Record<string, unknown> }) {
  return <dl className="services-values">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{profileLabels[key] ?? key}</dt><dd>{value && typeof value === "object" ? <ServiceProfileValues values={value as Record<string, unknown>} /> : value == null || value === "" ? "Сведения не предоставлены" : key === "verifiedAt" ? serviceDate(String(value)) : String(value)}</dd></div>)}</dl>;
}
const strings = (fields: Record<string, string | number>) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]));
const historyLabel = (action: string) => serviceStatusLabels[action as keyof typeof serviceStatusLabels] ?? ({ CREATE: "Создан черновик", SAVE: "Сохранены поля", DELETE: "Удалён черновик", SUBMIT: "Заявление отправлено", COMMENT: "Сообщение", UPLOAD: "Добавлен документ", REMOVE_FILE: "Документ снят с заявления" }[action] ?? action);
type Result = { id: string; version: number; documentId?: string };

export function ServiceRequestScreen({ id, path, student }: { id: string; path: string; student: boolean }) {
  const router = useRouter();
  const [detail, setDetail] = useState<RequestDetail | null>(null), [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState(""), [conflict, setConflict] = useState(false), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [comment, setComment] = useState(""), [decision, setDecision] = useState(""), [decisionText, setDecisionText] = useState("");
  const [clarifyFields, setClarifyFields] = useState<string[]>([]), [clarifySlots, setClarifySlots] = useState<string[]>([]), [deleteConfirm, setDeleteConfirm] = useState(false);
  const [historyPage, setHistoryPage] = useState(0), [moreHistory, setMoreHistory] = useState(false), [reload, setReload] = useState(0);
  const pending = useRef(new Map<string, string>()), inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    serviceFetch<RequestDetail>(serviceUrl({ view: "request", id })).then(next => { if (active) { setDetail(next); setInputs(strings(next.fields)); setMoreHistory(next.history.length === 50 || next.documents.length === 50); setError(""); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, reload]);
  // Warn before a browser reload/tab close without persisting sensitive fields
  // in localStorage. Drafts themselves live in the protected server database.
  const dirty = detail && detail.config.fields.some(f => (inputs[f.key] ?? "") !== String(detail.fields[f.key] ?? ""));
  useEffect(() => {
    if (!dirty && !comment && !decisionText) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, comment, decisionText]);
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setConflict(false); setNotice("");
    try { await task(); } catch (e) { setError((e as Error).message); setConflict(e instanceof ServiceApiError && e.status === 409); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function send(values: Record<string, unknown>): Promise<Result> {
    const fingerprint = JSON.stringify(values);
    const key = pending.current.get(fingerprint) ?? crypto.randomUUID(); pending.current.set(fingerprint, key);
    try {
      const result = await serviceFetch<Result>("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, requestId: key }) });
      pending.current.delete(fingerprint);
      setDetail(old => old ? { ...old, version: result.version } : old);
      window.dispatchEvent(new Event("services-updated"));
      return result;
    } catch (e) { if (e instanceof ServiceApiError && e.status >= 400 && e.status < 500) pending.current.delete(fingerprint); throw e; }
  }
  async function fresh(preserve = false) {
    const next = await serviceFetch<RequestDetail>(serviceUrl({ view: "request", id }));
    if (detail?.profilePreview?.confirmationHash !== next.profilePreview?.confirmationHash) setConfirmed(false);
    setDetail(next); if (!preserve) setInputs(strings(next.fields));
    setHistoryPage(0); setMoreHistory(next.history.length === 50 || next.documents.length === 50);
    return next;
  }
  function changedFields(current: RequestDetail) {
    return Object.fromEntries(current.config.fields.filter(field => (inputs[field.key] ?? "") !== String(current.fields[field.key] ?? "")).map(field => {
      const value = inputs[field.key] ?? "";
      return [field.key, value !== "" && ["integer", "money"].includes(field.type) ? Number(value) : value];
    }));
  }
  async function save(current: RequestDetail) {
    const fields = changedFields(current);
    if (!Object.keys(fields).length) return current;
    const result = await send({ operation: "SAVE", id, version: current.version, fields });
    // Record the successful save even if the following GET fails.
    const merged = { ...current.fields, ...fields } as Record<string, string | number>;
    setDetail(old => old ? { ...old, fields: merged, version: result.version } : old);
    return fresh(true);
  }
  async function upload(file: File, slot: string, kind: string) {
    if (!detail) return;
    await run(async () => {
      if (!["image/png", "image/jpeg"].includes(file.type) || !/\.(png|jpe?g)$/i.test(file.name)) throw new Error("Можно загрузить только PNG или JPEG. PDF пока не поддерживается.");
      if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("Файл должен быть не больше 8 МиБ и не быть пустым.");
      const fingerprint = JSON.stringify(["UPLOAD", id, detail.version, slot, kind, file.name, file.size, file.lastModified]);
      const key = pending.current.get(fingerprint) ?? crypto.randomUUID(); pending.current.set(fingerprint, key);
      try {
        const result = await serviceFetch<Result>(serviceUrl({ upload: "1", id, version: String(detail.version), requestId: key, slot, kind }), { method: "POST", headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) }, body: file });
        pending.current.delete(fingerprint); setDetail(old => old ? { ...old, version: result.version } : old);
        await fresh(true); setNotice("Документ загружен.");
      } catch (e) { if (e instanceof ServiceApiError && e.status >= 400 && e.status < 500) pending.current.delete(fingerprint); throw e; }
    });
  }
  function fileLink(doc: ServiceDocumentView) { return <a href={serviceUrl({ view: "file", id: doc.id })} download>{doc.name} <span className="services-muted">{Math.ceil(doc.size / 1024)} КБ · Скачать</span></a>; }
  if (!detail) return <section className="panel services-panel"><Link href={path} className="text-link">← К услугам</Link>{error ? <div role="alert" className="services-error">{error}<button onClick={() => setReload(n => n + 1)}>Повторить</button></div> : <p role="status">Загружаем заявление…</p>}</section>;
  const config = detail.config, editable = student && ["DRAFT", "CLARIFICATION_REQUIRED"].includes(detail.status);
  const fieldEditable = (key: string) => editable && (detail.status === "DRAFT" || Boolean(detail.clarification?.fields.includes(key)));
  const slotEditable = (key: string) => editable && (detail.status === "DRAFT" || Boolean(detail.clarification?.slots.includes(key)));
  const terminal = ["COMPLETED", "REJECTED"].includes(detail.status);
  const transitionOptions = detail.status === "SUBMITTED" ? ["IN_REVIEW"] : detail.status === "IN_REVIEW" ? ["IN_PROGRESS", "CLARIFICATION_REQUIRED", "REJECTED"] : detail.status === "IN_PROGRESS" ? ["CLARIFICATION_REQUIRED", "COMPLETED", "REJECTED"] : [];
  const clarify = detail.latestClarification;
  return <div className="services-detail" aria-busy={busy}>
    <div className="services-toolbar"><Link href={path + (student ? "?tab=requests" : "")} className="text-link">← {student ? "Мои заявления" : "Очередь заявлений"}</Link><button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await fresh(true); setNotice("Версия обновлена. Ваш ввод сохранён на экране."); })}>Обновить данные</button></div>
    <section className="panel services-panel services-request-heading"><span className={"services-status status-" + detail.status}>{serviceStatusLabels[detail.status]}</span><h2>{config.title}</h2><p className="services-number">Заявление № {detail.id}</p><p className="services-muted">Создано: {serviceDate(detail.createdAt)} · Подано: {serviceDate(detail.submittedAt)} · Обновлено: {serviceDate(detail.updatedAt)}</p></section>
    {error && <div className="services-error" role="alert">{error}{conflict && <><p>Серверная версия изменилась. Обновите её, проверьте свои изменения и повторите действие.</p><button disabled={busy} onClick={() => void run(async () => { await fresh(true); setNotice("Актуальная версия загружена; введённые поля сохранены на экране."); })}>Обновить версию, сохранив мой ввод</button></>}</div>}
    {notice && <p className="services-success" role="status">{notice}</p>}{busy && <p className="services-progress" role="status">Выполняем операцию…</p>}
    {detail.status === "CLARIFICATION_REQUIRED" && <section className="services-notice"><h3>Требуется уточнение</h3><p className="services-text">{clarify?.text}</p><p>Поля: {detail.clarification?.fields.map(key => config.fields.find(f => f.key === key)?.label).join(", ") || "изменения не запрошены"}.</p><p>Документы: {detail.clarification?.slots.map(key => config.documents.find(d => d.key === key)?.label).join(", ") || "изменения не запрошены"}.</p></section>}
    <div className="services-detail-grid"><div>
      <section className="panel services-panel"><h3>{editable ? "Поля заявления" : "Поданные сведения"}</h3><p className="services-muted">{config.description}</p>
        <fieldset disabled={busy} className="services-fields">{config.fields.map(field => <label className={"services-field" + (fieldEditable(field.key) ? "" : " services-readonly")} key={field.key}>{field.label}{field.required && <span aria-label="обязательное поле"> *</span>}
          {fieldEditable(field.key) ? field.type === "choice" ? <select value={inputs[field.key] ?? ""} onChange={e => setInputs({ ...inputs, [field.key]: e.target.value })}><option value="">Выберите вариант</option>{field.options?.map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}</select> : field.type === "text" && config.code === "pass-reissue" && field.key === "reason" ? <><input list="pass-reissue-reasons" value={inputs[field.key] ?? ""} maxLength={field.max ?? 2000} onChange={e => setInputs({ ...inputs, [field.key]: e.target.value })} /><datalist id="pass-reissue-reasons"><option value="Утрата пропуска" /><option value="Повреждение пропуска" /><option value="Изменение персональных данных" /><option value="Обновление фотографии" /></datalist></> : field.type === "text" ? <textarea rows={field.key === "message" || field.key === "circumstances" ? 4 : 2} maxLength={field.max ?? 2000} value={inputs[field.key] ?? ""} onChange={e => setInputs({ ...inputs, [field.key]: e.target.value })} /> : <input type={field.type === "date" ? "date" : "number"} step={field.type === "money" ? "0.01" : "1"} min={field.type === "integer" ? 1 : field.type === "money" ? 0 : undefined} max={field.max} value={inputs[field.key] ?? ""} onChange={e => setInputs({ ...inputs, [field.key]: e.target.value })} /> : <span className="services-field-value services-text">{optionLabel(String(detail.fields[field.key] ?? "Не заполнено"))}</span>}
          {fieldEditable(field.key) && <small>{field.required ? "Обязательно при отправке" : "Необязательно"}{field.max && field.type === "text" ? ` · до ${field.max} символов` : ""}</small>}
        </label>)}</fieldset>
        {editable && <button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await save(detail); setNotice("Черновик сохранён в личном кабинете."); })}>Сохранить изменения</button>}
      </section>
      <section className="panel services-panel"><h3>Документы</h3><p className="services-muted">PNG или JPEG, до 8 МиБ на файл. PDF пока не поддерживается.</p>
        {!detail.permissions.readFiles ? <p>Доступ к документам не предоставлен.</p> : <>
          {config.documents.filter(slot => !slot.when || (editable ? inputs[slot.when.field] : detail.fields[slot.when.field]) === slot.when.value).map(slot => <div className="services-document-slot" key={slot.key}><h4>{slot.label}{slot.required ? " *" : " (необязательно)"}</h4>{detail.documents.filter(d => d.kind === "STUDENT" && d.slot === slot.key && !d.removedAt).map(doc => <div className="services-file" key={doc.id}>{fileLink(doc)}{slotEditable(slot.key) && <button disabled={busy} onClick={() => void run(async () => { await send({ operation: "REMOVE_FILE", id, version: detail.version, documentId: doc.id }); await fresh(true); setNotice("Приложение снято с заявления. Можно загрузить замену."); })}>Удалить / заменить</button>}</div>)}{slotEditable(slot.key) && <label className="services-upload">Добавить файл<input aria-label={`Загрузить: ${slot.label}`} type="file" accept="image/png,image/jpeg" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file, slot.key, "STUDENT"); e.target.value = ""; }} /></label>}</div>)}
          {!config.documents.length && <p>Эта услуга не требует приложений студента.</p>}
          {detail.documents.filter(d => d.kind === "RESULT" && !d.removedAt).map(doc => <div className="services-file" key={doc.id}><span>Итоговый документ · {fileLink(doc)}</span>{!student && detail.status === "IN_PROGRESS" && <button disabled={busy} onClick={() => void run(async () => { await send({ operation: "REMOVE_FILE", id, version: detail.version, documentId: doc.id }); await fresh(true); })}>Удалить / заменить</button>}</div>)}
          {!student && detail.status === "IN_PROGRESS" && <label className="services-upload">Добавить итоговый документ<input aria-label="Добавить итоговый документ" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file, "result", "RESULT"); e.target.value = ""; }} /></label>}
          {detail.documents.some(d => d.removedAt) && <details><summary>Снятые приложения · сохранены в истории</summary>{detail.documents.filter(d => d.removedAt).map(doc => <div className="services-file" key={doc.id}>{fileLink(doc)}</div>)}</details>}
        </>}
      </section>
      {!student && transitionOptions.length > 0 && <section className="panel services-panel"><h3>Решение по заявлению</h3><fieldset disabled={busy} className="services-fields"><label className="services-field">Действие<select aria-label="Действие" value={decision} onChange={e => setDecision(e.target.value)}><option value="">Выберите действие</option>{transitionOptions.map(value => <option key={value} value={value}>{value === "IN_REVIEW" ? "Принять в рассмотрение" : serviceStatusLabels[value as keyof typeof serviceStatusLabels]}</option>)}</select></label>{decision === "CLARIFICATION_REQUIRED" && <><fieldset className="services-checklist"><legend>Какие поля исправить</legend>{config.fields.map(field => <label key={field.key}><input type="checkbox" checked={clarifyFields.includes(field.key)} onChange={e => setClarifyFields(e.target.checked ? [...clarifyFields, field.key] : clarifyFields.filter(k => k !== field.key))} />{field.label}</label>)}</fieldset><fieldset className="services-checklist"><legend>Какие документы исправить</legend>{config.documents.map(slot => <label key={slot.key}><input type="checkbox" checked={clarifySlots.includes(slot.key)} onChange={e => setClarifySlots(e.target.checked ? [...clarifySlots, slot.key] : clarifySlots.filter(k => k !== slot.key))} />{slot.label}</label>)}</fieldset></>}{decision && <label className="services-field">{decision === "REJECTED" ? "Причина отказа *" : decision === "COMPLETED" ? "Результат исполнения *" : decision === "CLARIFICATION_REQUIRED" ? "Что необходимо уточнить *" : "Комментарий"}<textarea maxLength={4000} value={decisionText} onChange={e => setDecisionText(e.target.value)} /></label>}</fieldset><button className="button button-primary" disabled={busy || !decision || (["REJECTED", "COMPLETED", "CLARIFICATION_REQUIRED"].includes(decision) && !decisionText.trim()) || (decision === "CLARIFICATION_REQUIRED" && !clarifyFields.length && !clarifySlots.length)} onClick={() => void run(async () => { await send({ operation: "TRANSITION", id, version: detail.version, status: decision, text: decisionText, ...(decision === "CLARIFICATION_REQUIRED" ? { clarificationFields: clarifyFields, clarificationSlots: clarifySlots } : {}) }); setDecision(""); setDecisionText(""); setClarifyFields([]); setClarifySlots([]); await fresh(true); setNotice("Решение сохранено. Студент получит уведомление."); })}>Применить решение</button></section>}
      {terminal && <section className={"panel services-panel services-result" + (detail.status === "REJECTED" ? " services-result-rejected" : "")}><h3>{detail.status === "REJECTED" ? "Причина отказа" : "Результат исполнения"}</h3><p className="services-text">{detail.resultText}</p><p>{serviceDate(detail.completedAt)}</p></section>}
      {detail.status !== "DRAFT" && <section className="panel services-panel"><h3>Переписка</h3><div className="services-messages">{detail.history.filter(h => h.text).map(h => <article key={h.id}><strong>{h.actorName}</strong><time>{serviceDate(h.createdAt)}</time><p className="services-text">{h.text}</p></article>)}</div>{!terminal && <><label className="services-field">Сообщение<textarea maxLength={4000} value={comment} disabled={busy} onChange={e => setComment(e.target.value)} /></label><button className="button button-secondary" disabled={busy || !comment.trim()} onClick={() => void run(async () => { await send({ operation: "COMMENT", id, version: detail.version, text: comment }); setComment(""); await fresh(true); setNotice("Сообщение отправлено."); })}>Отправить сообщение</button></>}{terminal && <p className="services-muted">Переписка завершена вместе с заявлением.</p>}</section>}
    </div><aside>
      {(detail.profilePreview || detail.profileSnapshot) && <section className="panel services-panel"><h3>{editable ? "Проверьте официальные данные" : "Данные при подаче"}</h3><ServiceProfileValues values={editable && detail.profilePreview ? detail.profilePreview.values : detail.profileSnapshot ?? {}} />{student && <><p className="services-muted">Паспортные данные в профиле не хранятся и автоматически не подставляются.</p><Link className="text-link" href={path + "?service=personal-change"}>Есть ошибка? Изменить персональные данные →</Link></>}</section>}
      {editable && <section className="panel services-panel"><h3>{detail.status === "DRAFT" ? "Отправка заявления" : "Повторная отправка"}</h3><label className="services-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Подтверждаю актуальность показанных официальных данных</label><p className="services-muted">Все обязательные поля и приложения проверит сервер. После подачи редактирование возможно только по запросу уточнения.</p><button className="button button-primary" disabled={busy || !confirmed} onClick={() => void run(async () => { const approvedHash = detail.profilePreview?.confirmationHash; const current = await save(detail); if (!approvedHash || current.profilePreview?.confirmationHash !== approvedHash) { setConfirmed(false); throw new Error("Данные профиля обновились. Проверьте их и подтвердите ещё раз."); } await send({ operation: "SUBMIT", id, version: current.version, confirmed: true, confirmationHash: approvedHash }); setConfirmed(false); await fresh(); setNotice("Заявление отправлено."); })}>{detail.status === "DRAFT" ? "Отправить заявление" : "Отправить уточнение"}</button>
        {detail.status === "DRAFT" && <div className="services-delete">{!deleteConfirm ? <button disabled={busy} onClick={() => setDeleteConfirm(true)}>Удалить черновик</button> : <><p>Удалить этот черновик?</p><button disabled={busy} onClick={() => void run(async () => { await send({ operation: "DELETE", id, version: detail.version }); router.push(path + "?tab=drafts"); })}>Да, удалить</button><button disabled={busy} onClick={() => setDeleteConfirm(false)}>Отмена</button></>}</div>}
      </section>}
      <section className="panel services-panel"><h3>История действий</h3><ol className="services-history">{detail.history.map(h => <HistoryEntry key={h.id} entry={h} detail={detail} />)}</ol>{moreHistory && <button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { const next = await serviceFetch<RequestDetail>(serviceUrl({ view: "request", id, page: String(historyPage + 1) })); const unique = <T extends { id: string }>(a: T[], b: T[]) => [...new Map([...a, ...b].map(item => [item.id, item])).values()]; setDetail(old => old ? { ...old, history: unique(old.history, next.history), documents: unique(old.documents, next.documents) } : old); setHistoryPage(n => n + 1); setMoreHistory(next.history.length === 50 || next.documents.length === 50); })}>Показать ещё историю</button>}</section>
    </aside></div>
  </div>;
}

function HistoryEntry({ entry, detail }: { entry: HistoryView; detail: RequestDetail }) {
  let snapshot: { fields?: Record<string, string | number>; profile?: Record<string, unknown>; documents?: string[]; documentId?: string } | null = null;
  try { snapshot = entry.snapshotJson ? JSON.parse(entry.snapshotJson) : null; } catch { /* A missing legacy snapshot cannot hide the action itself. */ }
  return <li><strong>{historyLabel(entry.action)}</strong><span>{entry.actorName}</span><time>{serviceDate(entry.createdAt)}</time>{entry.text && <p className="services-text">{entry.text}</p>}{snapshot && <details><summary>Сведения этой версии</summary>{snapshot.fields && <dl className="services-values">{Object.entries(snapshot.fields).map(([key, value]) => <div key={key}><dt>{detail.config.fields.find(f => f.key === key)?.label ?? key}</dt><dd className="services-text">{optionLabel(String(value))}</dd></div>)}</dl>}{snapshot.profile && <ServiceProfileValues values={snapshot.profile} />}{detail.permissions.readFiles && [...(snapshot.documents ?? []), ...(snapshot.documentId ? [snapshot.documentId] : [])].map(id => <p key={id}><a href={serviceUrl({ view: "file", id })} download>Документ этой версии · {id.slice(-8)}</a></p>)}</details>}</li>;
}
