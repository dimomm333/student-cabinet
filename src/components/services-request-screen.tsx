"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { serviceFetch, serviceUpload, ServiceApiError, serviceUrl, serviceDate, serviceStatusLabels, optionLabel, type RequestDetail, type HistoryView, type ServiceDocumentView } from "@/lib/services-ui";
import { recoveryKey, readRecovery, writeRecovery, clearRecovery } from "@/lib/services-recovery";
import { prepareServiceImage } from "@/lib/services-image";

const profileLabels: Record<string, string> = { name: "ФИО", group: "Учебная группа", studentNumber: "Студенческий номер", program: "Образовательная программа", military: "Воинский учёт", registrationStatus: "Сведения об учёте", office: "Военкомат", documentType: "Вид документа", documentNumber: "Реквизиты документа", verifiedAt: "Дата подтверждения" };
export function ServiceProfileValues({ values }: { values: Record<string, unknown> }) {
  return <dl className="services-values">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{profileLabels[key] ?? key}</dt><dd>{value && typeof value === "object" ? <ServiceProfileValues values={value as Record<string, unknown>} /> : value == null || value === "" ? "Сведения не предоставлены" : key === "verifiedAt" ? serviceDate(String(value)) : String(value)}</dd></div>)}</dl>;
}
const strings = (fields: Record<string, string | number>) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]));
const historyLabel = (action: string) => serviceStatusLabels[action as keyof typeof serviceStatusLabels] ?? ({ CREATE: "Создан черновик", SAVE: "Сохранены поля", DELETE: "Удалён черновик", SUBMIT: "Заявление отправлено", COMMENT: "Сообщение", UPLOAD: "Добавлен документ", REMOVE_FILE: "Документ снят с заявления" }[action] ?? action);
type Result = { id: string; version: number; documentId?: string };

export function ServiceRequestScreen({ id, path, student, ownerId }: { id: string; path: string; student: boolean; ownerId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<RequestDetail | null>(null), [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState(""), [conflict, setConflict] = useState(false), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [comment, setComment] = useState(""), [decision, setDecision] = useState(""), [decisionText, setDecisionText] = useState("");
  const [clarifyFields, setClarifyFields] = useState<string[]>([]), [clarifySlots, setClarifySlots] = useState<string[]>([]), [deleteConfirm, setDeleteConfirm] = useState(false);
  const [historyPage, setHistoryPage] = useState(0), [moreHistory, setMoreHistory] = useState(false), [reload, setReload] = useState(0);
  const pending = useRef(new Map<string, string>()), inFlight = useRef(false);
  const current = useRef<RequestDetail | null>(null), values = useRef<Record<string, string>>({});
  const saving = useRef<Promise<RequestDetail> | null>(null), stopped = useRef(false), blocked = useRef(false);
  const uncertain = useRef<{ command: Record<string, unknown>; snapshot: Record<string, string> } | null>(null);
  const [saveState, setSaveState] = useState("Сохранено");
  const [uploadState, setUploadState] = useState<{ name: string; size: number; percent: number; status: string; reason?: string } | null>(null);
  const recovery = recoveryKey(ownerId, id);
  function adopt(next: RequestDetail) { current.current = next; setDetail(next); }
  useEffect(() => {
    let active = true;
    stopped.current = false;
    serviceFetch<RequestDetail>(serviceUrl({ view: "request", id })).then(next => { if (active) {
      current.current = next; setDetail(next);
      const stored = readRecovery<{ version: number; inputs: Record<string, string>; uncertain?: typeof uncertain.current; upload?: boolean }>(recovery);
      const editable = student && next.eligibility !== "NOT_REQUIRED" && ["DRAFT", "CLARIFICATION_REQUIRED"].includes(next.status);
      values.current = editable && stored ? { ...strings(next.fields), ...stored.inputs } : strings(next.fields); setInputs(values.current);
      if (editable && stored) {
        uncertain.current = stored.uncertain ?? null;
        blocked.current = stored.version !== next.version && !uncertain.current;
        if (blocked.current) { setConflict(true); setError("Заявление изменено в другом окне или другим сотрудником. Проверьте восстановленный ввод перед сохранением."); }
        if (stored.upload) setNotice("Предыдущая загрузка не была подтверждена. Проверьте список документов и при необходимости выберите файл повторно.");
      } else clearRecovery(recovery);
      setMoreHistory(next.historyHasMore || next.documentsHasMore);
    } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, reload, recovery, student]);
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
    try { if (saving.current) await saving.current; await task(); } catch (e) { setError((e as Error).message); setConflict(e instanceof ServiceApiError && e.status === 409); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function send(values: Record<string, unknown>): Promise<Result> {
    const fingerprint = JSON.stringify(values);
    const key = String(values.requestId ?? pending.current.get(fingerprint) ?? crypto.randomUUID()); pending.current.set(fingerprint, key);
    try {
      const result = await serviceFetch<Result>("/api/services", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, requestId: key }) });
      pending.current.delete(fingerprint);
      if (current.current) adopt({ ...current.current, version: result.version });
      window.dispatchEvent(new Event("services-updated"));
      return result;
    } catch (e) { if (e instanceof ServiceApiError && e.status >= 400 && e.status < 500) pending.current.delete(fingerprint); throw e; }
  }
  async function fresh(preserve = false) {
    const next = await serviceFetch<RequestDetail>(serviceUrl({ view: "request", id }));
    if (detail?.profilePreview?.confirmationHash !== next.profilePreview?.confirmationHash) setConfirmed(false);
    adopt(next); blocked.current = false; if (["DRAFT", "CLARIFICATION_REQUIRED"].includes(next.status)) stopped.current = false;
    if (!preserve) { values.current = strings(next.fields); setInputs(values.current); }
    setHistoryPage(0); setMoreHistory(next.historyHasMore || next.documentsHasMore);
    return next;
  }
  function changedFields(current: RequestDetail) {
    return Object.fromEntries(current.config.fields.filter(field => (values.current[field.key] ?? "") !== String(current.fields[field.key] ?? "")).map(field => {
      const value = values.current[field.key] ?? "";
      return [field.key, value !== "" && ["integer", "money"].includes(field.type) ? Number(value) : field.type === "text" ? value.trim() : value];
    }));
  }
  function remember() {
    if (current.current && !stopped.current) writeRecovery(recovery, { version: current.current.version, inputs: values.current, uncertain: uncertain.current, upload: uploadState && uploadState.status !== "Загружен" });
  }
  function change(key: string, value: string) {
    values.current = { ...values.current, [key]: value }; setInputs(values.current); remember(); setSaveState("Сохранение…");
  }
  async function save(): Promise<RequestDetail> {
    if (saving.current) { await saving.current; return save(); }
    if (blocked.current) throw new ServiceApiError("Сначала обновите версию и проверьте свой ввод.", 409);
    const work = async () => {
      if (!current.current) throw new Error("Заявление ещё загружается.");
      let wrote = false;
      while (!stopped.current && student && ["DRAFT", "CLARIFICATION_REQUIRED"].includes(current.current.status)) {
        const base: RequestDetail = current.current;
        const fields = changedFields(base);
        if (!uncertain.current && !Object.keys(fields).length) break;
        const attempt = uncertain.current ?? { command: { operation: "SAVE", id, version: base.version, fields, requestId: crypto.randomUUID() }, snapshot: { ...values.current } };
        uncertain.current = attempt; remember(); setSaveState("Сохранение…");
        try {
          const result = await send(attempt.command);
          wrote = true;
          const savedFields = { ...base.fields, ...attempt.snapshot };
          adopt({ ...base, fields: savedFields, version: result.version }); uncertain.current = null;
        } catch (error) {
          if (error instanceof ServiceApiError && error.status === 401) { stopped.current = true; clearRecovery(); }
          if (error instanceof ServiceApiError && error.status >= 400 && error.status < 500) { uncertain.current = null; blocked.current = [401, 403, 404, 409].includes(error.status); }
          remember(); setSaveState("Не удалось сохранить"); throw error;
        }
      }
      if (!stopped.current) { clearRecovery(recovery); setSaveState("Сохранено"); if (wrote) { setError(""); setConflict(false); } }
      return current.current;
    };
    saving.current = work();
    try { return await saving.current; } finally { saving.current = null; }
  }
  const autoFlush = useEffectEvent(async () => {
    if (!current.current || stopped.current || blocked.current || inFlight.current) return;
    try { await save(); } catch (e) { setError((e as Error).message); setConflict(e instanceof ServiceApiError && e.status === 409); throw e; }
  });
  useEffect(() => {
    if (!student || !detail || !["DRAFT", "CLARIFICATION_REQUIRED"].includes(detail.status)) return;
    let cancelled = false, attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => { void autoFlush().catch(error => { if (!cancelled && !blocked.current && (error.status === 0 || error.status >= 500) && ++attempts <= 3) timer = setTimeout(attempt, attempts * 5000); }); };
    timer = setTimeout(attempt, 650);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [inputs, detail, student]);
  useEffect(() => {
    const flush = () => { void autoFlush().catch(() => {}); };
    const logout = (event: Event) => { (event as CustomEvent<Promise<unknown>[]>).detail.push(autoFlush()); };
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a");
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || !current.current || !Object.keys(changedFields(current.current)).length) return;
      event.preventDefault(); event.stopPropagation();
      void autoFlush().catch(() => {}).finally(() => router.push(url.pathname + url.search + url.hash));
    };
    document.addEventListener("click", navigate, true); document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush); window.addEventListener("online", flush); window.addEventListener("popstate", flush);
    window.addEventListener("services-before-logout", logout);
    return () => { document.removeEventListener("click", navigate, true); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", flush); window.removeEventListener("online", flush); window.removeEventListener("popstate", flush); window.removeEventListener("services-before-logout", logout); flush(); };
    // Latest inputs are read through refs; listeners stay installed across edits.
  }, [router]);
  async function submit() {
    if (!detail) return;
    await run(async () => {
      const approvedHash = detail.profilePreview?.confirmationHash;
      await save();
      const next = await fresh(true);
      if (!approvedHash || next.profilePreview?.confirmationHash !== approvedHash) { setConfirmed(false); throw new Error("Данные профиля обновились. Проверьте их и подтвердите ещё раз."); }
      await send({ operation: "SUBMIT", id, version: next.version, confirmed: true, confirmationHash: approvedHash });
      stopped.current = true; clearRecovery(recovery); setConfirmed(false); await fresh(); setNotice("Заявление отправлено.");
    });
  }
  async function upload(file: File, slot: string, kind: string) {
    if (!detail) return;
    await run(async () => {
      if (!["image/png", "image/jpeg", "application/pdf"].includes(file.type) || !/\.(png|jpe?g|pdf)$/i.test(file.name)) { setUploadState({ name: file.name, size: file.size, percent: 0, status: "Ошибка" }); throw new Error("Допустимы PNG, JPEG и PDF."); }
      if (file.type !== "application/pdf") {
        setUploadState({ name: file.name, size: file.size, percent: 0, status: "Подготовка изображения…" });
        try { file = await prepareServiceImage(file); }
        catch (error) { setUploadState({ name: file.name, size: file.size, percent: 0, status: "Ошибка", reason: (error as Error).message }); throw error; }
      }
      if (!file.size || file.size > (file.type === "application/pdf" ? 20 : 8) * 1024 * 1024) {
        const reason = !file.size ? "Файл пустой. Выберите другой файл." : `${file.type === "application/pdf" ? "PDF" : file.type === "image/png" ? "PNG" : "JPG/JPEG"} слишком большой. Допустимый размер — ${file.type === "application/pdf" ? 20 : 8} МиБ. Выберите другой файл.`;
        setUploadState({ name: file.name, size: file.size, percent: 0, status: "Ошибка", reason }); throw new Error(reason);
      }
      const base = student ? await save() : current.current!;
      // Selecting the same file again creates a new File.lastModified value in
      // some browsers. Identify the bytes so a lost response reuses its receipt.
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), value => value.toString(16).padStart(2, "0")).join("");
      const fingerprint = JSON.stringify(["UPLOAD", id, base.version, slot, kind, file.name, file.size, hash]);
      const key = pending.current.get(fingerprint) ?? crypto.randomUUID(); pending.current.set(fingerprint, key);
      try {
        setUploadState({ name: file.name, size: file.size, percent: 0, status: "Загружается" });
        writeRecovery(recovery, { version: base.version, inputs: values.current, upload: true });
        const result = await serviceUpload<Result>(serviceUrl({ upload: "1", id, version: String(base.version), requestId: key, slot, kind }), file, percent => setUploadState({ name: file.name, size: file.size, percent, status: percent === 100 ? "Обрабатывается" : "Загружается" }));
        pending.current.delete(fingerprint); adopt({ ...current.current!, version: result.version });
        setUploadState(null); clearRecovery(recovery);
      } catch (e) { setUploadState(old => ({ name: file.name, size: file.size, percent: old?.percent ?? 0, status: "Ошибка", reason: (e as Error).message })); if (e instanceof ServiceApiError && e.status >= 400 && e.status < 500) pending.current.delete(fingerprint); throw e; }
      // A committed upload must never become a retryable upload error because
      // its following read failed. Retry only the safe read, not the write.
      let readFailure = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await fresh(true); setNotice("Документ загружен."); return; }
        catch (error) {
          readFailure = (error as Error).message;
          if (error instanceof ServiceApiError && [401, 403, 404].includes(error.status)) throw error;
        }
      }
      setNotice("Документ сохранён. Список приложений пока недоступен; нажмите «Обновить данные». Повторно загружать файл не нужно. " + readFailure);
    });
  }
  function fileLink(doc: ServiceDocumentView) { return <a href={serviceUrl({ view: "file", id: doc.id })} download>{doc.name} <span className="services-muted">{Math.ceil(doc.size / 1024)} КБ · Скачать</span></a>; }
  if (!detail) return <section className="panel services-panel"><Link href={path} className="button button-primary services-back">← К каталогу услуг</Link>{error ? <div role="alert" className="services-error">{error}<button onClick={() => setReload(n => n + 1)}>Повторить</button></div> : <p role="status">Загружаем заявление…</p>}</section>;
  const config = detail.config, editable = student && detail.eligibility !== "NOT_REQUIRED" && ["DRAFT", "CLARIFICATION_REQUIRED"].includes(detail.status);
  const fieldEditable = (key: string) => editable && (detail.status === "DRAFT" || Boolean(detail.clarification?.fields.includes(key)));
  const slotEditable = (key: string) => editable && (detail.status === "DRAFT" || Boolean(detail.clarification?.slots.includes(key)));
  const terminal = ["COMPLETED", "REJECTED"].includes(detail.status);
  const transitionOptions = detail.status === "SUBMITTED" ? ["IN_REVIEW"] : detail.status === "IN_REVIEW" ? ["IN_PROGRESS", "CLARIFICATION_REQUIRED", "REJECTED"] : detail.status === "IN_PROGRESS" ? ["CLARIFICATION_REQUIRED", "COMPLETED", "REJECTED"] : [];
  const clarify = detail.latestClarification;
  return <div className="services-detail" aria-busy={busy}>
    <div className="services-toolbar"><Link href={path} className="button button-primary services-back">← К каталогу услуг</Link><Link href={path + (student ? "?tab=requests" : "")} className="text-link">← {student ? "Мои заявления" : "Очередь заявлений"}</Link><button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await fresh(true); setNotice("Версия обновлена. Ваш ввод сохранён на экране."); })}>Обновить данные</button></div>
    <section className="panel services-panel services-request-heading"><span className={"services-status status-" + detail.status}>{serviceStatusLabels[detail.status]}</span><h2>{config.title}</h2><p className="services-number">Заявление № {detail.id}</p><p className="services-muted">Создано: {serviceDate(detail.createdAt)} · Подано: {serviceDate(detail.submittedAt)} · Обновлено: {serviceDate(detail.updatedAt)}</p></section>
    {error && <div className="services-error" role="alert">{error}{conflict && <><p>Заявление изменено в другом окне или другим сотрудником. Обновите её, проверьте свои изменения и повторите действие.</p><button disabled={busy} onClick={() => void run(async () => { await fresh(true); setNotice("Актуальная версия загружена; введённые поля сохранены на экране."); })}>Обновить версию, сохранив мой ввод</button></>}</div>}
    {notice && <p className="services-success" role="status">{notice}</p>}{busy && <p className="services-progress" role="status">Выполняем операцию…</p>}
    {detail.eligibility === "NOT_REQUIRED" && <p className="services-notice">Воинский учёт для вас не требуется</p>}{detail.eligibility === "UNKNOWN" && <p className="services-notice">Статус воинского учёта пока не подтверждён. Заявление рассмотрит уполномоченный сотрудник после проверки документов.</p>}{detail.status === "CLARIFICATION_REQUIRED" && <section className="services-notice"><h3>Требуется уточнение</h3><p className="services-text">{clarify?.text}</p><p>Поля: {detail.clarification?.fields.map(key => config.fields.find(f => f.key === key)?.label).join(", ") || "изменения не запрошены"}.</p><p>Документы: {detail.clarification?.slots.map(key => config.documents.find(d => d.key === key)?.label).join(", ") || "изменения не запрошены"}.</p></section>}
    <div className="services-detail-grid"><div>
      <section className="panel services-panel"><h3>{editable ? "Поля заявления" : "Поданные сведения"}</h3><p className="services-muted">{config.description}</p>
        <fieldset disabled={busy} onBlur={() => { if (!inFlight.current) void save().catch(e => { setError(e.message); setConflict(e instanceof ServiceApiError && e.status === 409); }); }} className="services-fields">{config.fields.map(field => <label className={"services-field" + (fieldEditable(field.key) ? "" : " services-readonly")} key={field.key}>{field.label}{field.required && <span aria-label="обязательное поле"> *</span>}
          {fieldEditable(field.key) ? field.type === "choice" ? <select value={inputs[field.key] ?? ""} onChange={e => change(field.key, e.target.value)}><option value="">Выберите вариант</option>{field.options?.map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}</select> : field.type === "text" && config.code === "pass-reissue" && field.key === "reason" ? <><input list="pass-reissue-reasons" value={inputs[field.key] ?? ""} maxLength={field.max ?? 2000} onChange={e => change(field.key, e.target.value)} /><datalist id="pass-reissue-reasons"><option value="Утрата пропуска" /><option value="Повреждение пропуска" /><option value="Изменение персональных данных" /><option value="Обновление фотографии" /></datalist></> : field.type === "text" ? <textarea rows={field.key === "message" || field.key === "circumstances" ? 4 : 2} maxLength={field.max ?? 2000} value={inputs[field.key] ?? ""} onChange={e => change(field.key, e.target.value)} /> : <input type={field.type === "date" ? "date" : "number"} step={field.type === "money" ? "0.01" : "1"} min={field.type === "integer" ? 1 : field.type === "money" ? 0 : undefined} max={field.max} value={inputs[field.key] ?? ""} onChange={e => change(field.key, e.target.value)} /> : <span className="services-field-value services-text">{optionLabel(String(detail.fields[field.key] ?? "Не заполнено"))}</span>}
          {fieldEditable(field.key) && <small>{field.required ? "Обязательно при отправке" : "Необязательно"}{field.max && field.type === "text" ? ` · до ${field.max} символов` : ""}</small>}
        </label>)}</fieldset>
        {editable && <p role="status" className="services-autosave">{saveState} · Автоматически в личном кабинете</p>}{editable && <button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await save(); setNotice("Черновик сохранён в личном кабинете."); })}>Сохранить изменения</button>}
      </section>
      <section className="panel services-panel"><h3>Документы</h3>{uploadState && <div className="services-upload-progress" role="status"><strong>{uploadState.name}</strong><span>{(uploadState.size / 1048576).toFixed(2)} МиБ · {uploadState.status}{uploadState.status === "Подготовка изображения…" ? "" : ` · ${uploadState.percent}%`}</span><progress max="100" value={uploadState.status === "Подготовка изображения…" ? undefined : uploadState.percent} aria-label="Прогресс загрузки" />{uploadState.status === "Ошибка" && <><p className="services-text">{uploadState.reason}</p><small>Проверьте причину и список документов перед повторным выбором файла.</small></>}</div>}<p className="services-muted">Поддерживаемые форматы: JPG, JPEG, PNG, PDF</p>
        {!detail.permissions.readFiles ? <p>Доступ к документам не предоставлен.</p> : <>
          {config.documents.filter(slot => !slot.when || (editable ? inputs[slot.when.field] : detail.fields[slot.when.field]) === slot.when.value).map(slot => <div className="services-document-slot" key={slot.key}><h4>{slot.label}{slot.required ? " *" : " (необязательно)"}</h4>{detail.documents.filter(d => d.kind === "STUDENT" && d.slot === slot.key && !d.removedAt).map(doc => <div className="services-file" key={doc.id}>{fileLink(doc)}{slotEditable(slot.key) && <button disabled={busy} onClick={() => void run(async () => { await send({ operation: "REMOVE_FILE", id, version: current.current!.version, documentId: doc.id }); await fresh(true); setNotice("Приложение снято с заявления. Можно загрузить замену."); })}>Удалить / заменить</button>}</div>)}{slotEditable(slot.key) && <label className="services-upload">Добавить файл<input aria-label={`Загрузить: ${slot.label}`} type="file" accept="image/png,image/jpeg,application/pdf" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file, slot.key, "STUDENT"); e.target.value = ""; }} /></label>}</div>)}
          {!config.documents.length && <p>Эта услуга не требует приложений студента.</p>}
          {detail.documents.filter(d => d.kind === "RESULT" && !d.removedAt).map(doc => <div className="services-file" key={doc.id}><span>Итоговый документ · {fileLink(doc)}</span>{!student && detail.status === "IN_PROGRESS" && <button disabled={busy} onClick={() => void run(async () => { await send({ operation: "REMOVE_FILE", id, version: current.current!.version, documentId: doc.id }); await fresh(true); })}>Удалить / заменить</button>}</div>)}
          {!student && detail.status === "IN_PROGRESS" && <label className="services-upload">Добавить итоговый документ<input aria-label="Добавить итоговый документ" type="file" accept="image/png,image/jpeg,application/pdf" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file, "result", "RESULT"); e.target.value = ""; }} /></label>}
          {detail.documents.some(d => d.removedAt) && <details><summary>Снятые приложения · сохранены в истории</summary>{detail.documents.filter(d => d.removedAt).map(doc => <div className="services-file" key={doc.id}>{fileLink(doc)}</div>)}</details>}
        </>}
      </section>
      {!student && transitionOptions.length > 0 && <section className="panel services-panel"><h3>Решение по заявлению</h3><fieldset disabled={busy} className="services-fields"><label className="services-field">Действие<select aria-label="Действие" value={decision} onChange={e => setDecision(e.target.value)}><option value="">Выберите действие</option>{transitionOptions.map(value => <option key={value} value={value}>{value === "IN_REVIEW" ? "Принять в рассмотрение" : serviceStatusLabels[value as keyof typeof serviceStatusLabels]}</option>)}</select></label>{decision === "CLARIFICATION_REQUIRED" && <><fieldset className="services-checklist"><legend>Какие поля исправить</legend>{config.fields.map(field => <label key={field.key}><input type="checkbox" checked={clarifyFields.includes(field.key)} onChange={e => setClarifyFields(e.target.checked ? [...clarifyFields, field.key] : clarifyFields.filter(k => k !== field.key))} />{field.label}</label>)}</fieldset><fieldset className="services-checklist"><legend>Какие документы исправить</legend>{config.documents.map(slot => <label key={slot.key}><input type="checkbox" checked={clarifySlots.includes(slot.key)} onChange={e => setClarifySlots(e.target.checked ? [...clarifySlots, slot.key] : clarifySlots.filter(k => k !== slot.key))} />{slot.label}</label>)}</fieldset></>}{decision && <label className="services-field">{decision === "REJECTED" ? "Причина отказа *" : decision === "COMPLETED" ? "Результат исполнения *" : decision === "CLARIFICATION_REQUIRED" ? "Что необходимо уточнить *" : "Комментарий"}<textarea maxLength={4000} value={decisionText} onChange={e => setDecisionText(e.target.value)} /></label>}</fieldset><button className="button button-primary" disabled={busy || !decision || (["REJECTED", "COMPLETED", "CLARIFICATION_REQUIRED"].includes(decision) && !decisionText.trim()) || (decision === "CLARIFICATION_REQUIRED" && !clarifyFields.length && !clarifySlots.length)} onClick={() => void run(async () => { await send({ operation: "TRANSITION", id, version: current.current!.version, status: decision, text: decisionText, ...(decision === "CLARIFICATION_REQUIRED" ? { clarificationFields: clarifyFields, clarificationSlots: clarifySlots } : {}) }); setDecision(""); setDecisionText(""); setClarifyFields([]); setClarifySlots([]); await fresh(true); setNotice("Решение сохранено. Студент получит уведомление."); })}>Применить решение</button></section>}
      {terminal && <section className={"panel services-panel services-result" + (detail.status === "REJECTED" ? " services-result-rejected" : "")}><h3>{detail.status === "REJECTED" ? "Причина отказа" : "Результат исполнения"}</h3><p className="services-text">{detail.resultText}</p><p>{serviceDate(detail.completedAt)}</p></section>}
      {detail.status !== "DRAFT" && <section className="panel services-panel"><h3>Переписка</h3><div className="services-messages">{detail.history.filter(h => h.text).map(h => <article key={h.id}><strong>{h.actorName}</strong><time>{serviceDate(h.createdAt)}</time><p className="services-text">{h.text}</p></article>)}</div>{!terminal && <><label className="services-field">Сообщение<textarea maxLength={4000} value={comment} disabled={busy} onChange={e => setComment(e.target.value)} /></label><button className="button button-secondary" disabled={busy || !comment.trim()} onClick={() => void run(async () => { await send({ operation: "COMMENT", id, version: current.current!.version, text: comment }); setComment(""); await fresh(true); setNotice("Сообщение отправлено."); })}>Отправить сообщение</button></>}{terminal && <p className="services-muted">Переписка завершена вместе с заявлением.</p>}</section>}
    </div><aside>
      {(detail.profilePreview || detail.profileSnapshot) && <section className="panel services-panel"><h3>{editable ? "Проверьте официальные данные" : "Данные при подаче"}</h3><ServiceProfileValues values={editable && detail.profilePreview ? detail.profilePreview.values : detail.profileSnapshot ?? {}} />{student && <><p className="services-muted">Паспортные данные не подставляются автоматически.</p><Link className="text-link" href={path + "?service=personal-change"}>Есть ошибка? Изменить персональные данные →</Link></>}</section>}
      {editable && <section className="panel services-panel"><h3>{detail.status === "DRAFT" ? "Отправка заявления" : "Повторная отправка"}</h3><label className="services-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Подтверждаю актуальность показанных официальных данных</label><p className="services-muted">Заполните обязательные поля и приложите документы. После подачи редактирование возможно только по запросу уточнения.</p><button className="button button-primary" disabled={busy || !confirmed} onClick={() => void submit()}>{detail.status === "DRAFT" ? "Отправить заявление" : "Отправить уточнение"}</button>
        {detail.status === "DRAFT" && <div className="services-delete">{!deleteConfirm ? <button disabled={busy} onClick={() => setDeleteConfirm(true)}>Удалить черновик</button> : <><p>Удалить этот черновик?</p><button disabled={busy} onClick={() => void run(async () => { stopped.current = true; try { await send({ operation: "DELETE", id, version: current.current!.version }); clearRecovery(recovery); } catch (e) { stopped.current = false; throw e; } router.push(path + "?tab=drafts"); })}>Да, удалить</button><button disabled={busy} onClick={() => setDeleteConfirm(false)}>Отмена</button></>}</div>}
      </section>}
      <section className="panel services-panel"><h3>История действий</h3><ol className="services-history">{detail.history.map(h => <HistoryEntry key={h.id} entry={h} detail={detail} />)}</ol>{moreHistory && <button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { const next = await serviceFetch<RequestDetail>(serviceUrl({ view: "request", id, page: String(historyPage + 1) })); const unique = <T extends { id: string }>(a: T[], b: T[]) => [...new Map([...a, ...b].map(item => [item.id, item])).values()]; setDetail(old => old ? { ...old, history: unique(old.history, next.history), documents: unique(old.documents, next.documents) } : old); setHistoryPage(n => n + 1); setMoreHistory(next.historyHasMore || next.documentsHasMore); })}>Показать ещё историю</button>}</section>
    </aside></div>
  </div>;
}

function HistoryEntry({ entry, detail }: { entry: HistoryView; detail: RequestDetail }) {
  let snapshot: { fields?: Record<string, string | number>; profile?: Record<string, unknown>; documents?: string[]; documentId?: string } | null = null;
  try { snapshot = entry.snapshotJson ? JSON.parse(entry.snapshotJson) : null; } catch { /* A missing legacy snapshot cannot hide the action itself. */ }
  return <li><strong>{historyLabel(entry.action)}</strong><span>{entry.actorName}</span><time>{serviceDate(entry.createdAt)}</time>{entry.text && <p className="services-text">{entry.text}</p>}{snapshot && <details><summary>Сведения этой версии</summary>{snapshot.fields && <dl className="services-values">{Object.entries(snapshot.fields).map(([key, value]) => <div key={key}><dt>{detail.config.fields.find(f => f.key === key)?.label ?? key}</dt><dd className="services-text">{optionLabel(String(value))}</dd></div>)}</dl>}{snapshot.profile && <ServiceProfileValues values={snapshot.profile} />}{detail.permissions.readFiles && [...(snapshot.documents ?? []), ...(snapshot.documentId ? [snapshot.documentId] : [])].map(id => <p key={id}><a href={serviceUrl({ view: "file", id })} download>Документ этой версии · {id.slice(-8)}</a></p>)}</details>}</li>;
}
