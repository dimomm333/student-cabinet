"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import {
  portfolioByteLimit, portfolioCategories, portfolioFileLimit, portfolioFileTypes, portfolioStatuses,
  type PortfolioFile, type PortfolioItem,
} from "@/lib/portfolio";
import { DatePicker } from "./date-picker";

const endpoint = "/api/portfolio";
const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "UTC" });
const sizeFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const categories = Object.entries(portfolioCategories);

function Action({ children, onClick, disabled = false, primary = false }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean;
}) {
  return <button type="button" className={primary ? "button button-primary" : "button button-outline"}
    disabled={disabled} onClick={onClick}>{children}</button>;
}

function CategoryOptions() {
  return categories.map(([value, label]) => <option value={value} key={value}>{label}</option>);
}

function sizeLabel(size: number) {
  return size >= 1024 * 1024 ? sizeFormat.format(size / (1024 * 1024)) + " МиБ" : sizeFormat.format(Math.max(1, size / 1024)) + " КиБ";
}

function Attachments({ files, remove }: { files: PortfolioFile[]; remove?: (id: string) => void }) {
  if (!files.length) return <p className="services-muted">Нет вложений</p>;
  return <ul className="portfolio-files">{files.map(file => {
    const url = endpoint + "?file=" + encodeURIComponent(file.id);
    const image = file.mime.startsWith("image/");
    return <li key={file.id}>
      {image && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={"Открыть изображение " + file.name}>
        <Image src={url} unoptimized width={72} height={56} alt={file.name} />
      </a>}
      <div>
        <strong>{file.name}</strong>
        <small className="services-muted">{sizeLabel(file.size)}</small>
        <div className="portfolio-actions">
          {!image && <a href={url} target="_blank" rel="noopener noreferrer">Открыть PDF</a>}
          <a href={url + "&download=1"} aria-label={"Скачать " + file.name}>Скачать</a>
          {remove && <button type="button" onClick={() => remove(file.id)} aria-label={"Удалить файл " + file.name}>Удалить</button>}
        </div>
      </div>
    </li>;
  })}</ul>;
}

function LocalPreview({ file }: { file: File }) {
  const attach = useCallback((image: HTMLImageElement | null) => {
    if (!image) return;
    const url = URL.createObjectURL(file);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element -- The file exists only in this browser.
  return <img ref={attach} width={72} height={56} alt={"Предпросмотр " + file.name} />;
}

function EntryForm({ item, busy, message, cancel, save }: {
  item?: PortfolioItem; busy: boolean; message: React.ReactNode; cancel: () => void; save: (form: FormData) => Promise<void>;
}) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [added, setAdded] = useState<File[]>([]);
  const [error, setError] = useState("");
  const kept = item?.attachments.filter(file => !removed.includes(file.id)) ?? [];

  function add(files: File[]) {
    setError("");
    const combined = [...added, ...files];
    if (files.some(file => !portfolioFileTypes.includes(file.type) || file.size === 0
      || file.size > (file.type === "application/pdf" ? 20 : 8) * 1024 * 1024)) {
      setError("Выберите PDF до 20 МиБ или JPEG, PNG, WebP до 8 МиБ.");
    } else if (kept.length + combined.length > portfolioFileLimit
      || [...kept, ...combined].reduce((sum, file) => sum + file.size, 0) > portfolioByteLimit) {
      setError("На достижение допускается до 8 файлов общим размером до 32 МиБ.");
    } else {
      setAdded(combined);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (item) {
      form.set("id", item.id);
      form.set("version", String(item.version));
    }
    removed.forEach(id => form.append("remove", id));
    added.forEach(file => form.append("files", file));
    void save(form);
  }

  return <form onSubmit={submit}>
    <fieldset className="services-fields" disabled={busy}>
      <label className="services-field">Название <span aria-hidden="true">*</span>
        <input name="title" maxLength={160} required defaultValue={item?.title} />
      </label>
      <div className="portfolio-fields">
        <label className="services-field">Категория <span aria-hidden="true">*</span>
          <select name="category" required defaultValue={item?.category ?? ""}>
            <option value="" disabled>Выберите категорию</option><CategoryOptions />
          </select>
        </label>
        <DatePicker label="Дата достижения" name="achievedOn" defaultValue={item?.achievedOn} disabled={busy} />
      </div>
      <label className="services-field">Описание
        <textarea name="description" maxLength={4000} rows={3} defaultValue={item?.description ?? ""} />
      </label>
      <label className="services-field">Результат
        <input name="result" maxLength={500} defaultValue={item?.result ?? ""} />
      </label>
      <label className="services-field">Ссылка
        <input name="link" type="url" maxLength={2048} placeholder="https://" defaultValue={item?.link ?? ""} />
      </label>
      <label className="services-confirm"><input name="award" type="checkbox" defaultChecked={item?.award} /> Достижение отмечено наградой</label>
      <div className="services-document-slot">
        <h3>Вложения</h3>
        {item && <Attachments files={kept} remove={id => setRemoved([...removed, id])} />}
        {removed.length > 0 && <p className="services-muted">Будет удалено при сохранении: {removed.length}.{" "}
          <button type="button" onClick={() => setRemoved([])}>Восстановить вложения</button>
        </p>}
        {added.length > 0 && <ul className="portfolio-files">
          {added.map((file, index) => <li key={index}>
            {file.type.startsWith("image/") && <LocalPreview file={file} />}
            <div><strong>{file.name}</strong><small className="services-muted">{sizeLabel(file.size)}</small></div>
            <button type="button" aria-label={"Убрать " + file.name} onClick={() => setAdded(added.filter((_, i) => i !== index))}>Убрать</button>
          </li>)}
        </ul>}
        <label className="services-upload">Прикрепить файлы
          <input type="file" accept={portfolioFileTypes.join(",")} multiple aria-describedby="portfolio-file-limits" onChange={event => {
            add(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }} />
        </label>
        <p className="services-muted" id="portfolio-file-limits">PDF до 20 МиБ, JPEG, PNG и WebP до 8 МиБ. До 8 файлов и 32 МиБ на достижение.</p>
        {error && <p className="services-error" role="alert">{error}</p>}
      </div>
      {message}
      <div className="portfolio-actions">
        <button type="submit" className="button button-primary">{busy ? "Сохраняем…" : "Сохранить"}</button>
        <Action onClick={cancel} disabled={busy}>Отмена</Action>
      </div>
    </fieldset>
  </form>;
}

function Summary({ item, student }: { item: PortfolioItem; student: boolean }) {
  return <>
    <div className="portfolio-meta">
      <span>{portfolioCategories[item.category]}</span>
      {item.achievedOn && <time dateTime={item.achievedOn}>{dateFormat.format(new Date(item.achievedOn))}</time>}
      {item.award && <span>Награда</span>}
    </div>
    {!student && <p className="services-muted">{item.owner}{item.group && " · " + item.group}</p>}
    {item.status !== "SELF_ADDED" && <span className={"services-status status-" + (item.status === "CONFIRMED" ? "COMPLETED" : item.status)}>{portfolioStatuses[item.status]}</span>}
  </>;
}

function ReviewForm({ busy, review }: { busy: boolean; review: (verdict: string, reason?: string) => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false);
  return rejecting ? <form onSubmit={event => {
    event.preventDefault();
    void review("REJECTED", String(new FormData(event.currentTarget).get("reason")));
  }}>
    <label className="services-field">Причина отклонения
      <textarea name="reason" required maxLength={500} rows={3} disabled={busy} />
    </label>
    <div className="portfolio-actions">
      <button type="submit" className="button button-primary" disabled={busy}>Отклонить достижение</button>
      <Action onClick={() => setRejecting(false)} disabled={busy}>Отмена</Action>
    </div>
  </form> : <div className="portfolio-actions">
    <Action primary onClick={() => void review("CONFIRMED")} disabled={busy}>Подтвердить</Action>
    <Action onClick={() => setRejecting(true)} disabled={busy}>Отклонить</Action>
  </div>;
}

function DeleteConfirmation({ title, busy, error, cancel, confirm }: {
  title: string; busy: boolean; error?: string; cancel: () => void; confirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="panel services-panel portfolio-dialog" aria-labelledby="portfolio-delete-title"
    onCancel={event => { event.preventDefault(); if (!busy) cancel(); }}>
    <h2 id="portfolio-delete-title">Удалить достижение?</h2>
    <p>«{title}» и все его вложения будут удалены.</p>
    {error && <p className="services-error" role="alert">{error}</p>}
    <div className="portfolio-actions">
      <Action onClick={cancel} disabled={busy}>Отмена</Action>
      <Action onClick={confirm} disabled={busy} primary>{busy ? "Удаляем…" : "Удалить достижение"}</Action>
    </div>
  </dialog>;
}

type Screen = { mode: "add" } | { mode: "view" | "edit"; id: string };

export function PortfolioWorkspace({ student, initialItems }: { student: boolean; initialItems: PortfolioItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [category, setCategory] = useState("");
  const [year, setYear] = useState("");
  const [deleting, setDeleting] = useState<PortfolioItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const item = screen && "id" in screen ? items.find(row => row.id === screen.id) : undefined;
  const years = [...new Set(items.map(row => row.achievedOn.slice(0, 4)).filter(Boolean))].sort().reverse();
  const visible = items.filter(row => (!category || row.category === category) && (!year || row.achievedOn.startsWith(year)));

  function open(next: Screen | null) {
    setScreen(next);
    setFeedback(undefined);
    requestAnimationFrame(() => heading.current?.focus());
  }

  async function mutate(body: FormData | Record<string, unknown>, success: string, onSuccess: (result: PortfolioItem | null) => void) {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const isForm = body instanceof FormData;
      const response = await fetch(endpoint, {
        method: "POST", headers: isForm ? undefined : { "Content-Type": "application/json" },
        body: isForm ? body : JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) {
        setFeedback({ error: true, text: result?.error ?? "Не удалось сохранить изменения." });
        return;
      }
      onSuccess(result.item);
      setFeedback({ error: false, text: success });
    } catch {
      setFeedback({ error: true, text: "Не удалось связаться с сервером. Повторите попытку." });
    } finally { setBusy(false); }
  }

  function update(result: PortfolioItem) {
    setItems(current => [result, ...current.filter(row => row.id !== result.id)].sort((a, b) => b.achievedOn.localeCompare(a.achievedOn)));
    if (year && ![result, ...items.filter(row => row.id !== result.id)].some(row => row.achievedOn.startsWith(year))) setYear("");
  }

  const message = feedback && <p className={feedback.error ? "services-error" : "services-success"}
    role={feedback.error ? "alert" : "status"}>{feedback.text}</p>;

  return <div className="services-workspace portfolio">
    <header className="portfolio-heading">
      <div>
        <h1 ref={heading} tabIndex={-1}>{student ? "Портфолио" : "Проверка достижений"}</h1>
        <p>{student ? "Проекты, достижения и документы" : "Достижения студентов, отправленные на проверку"}</p>
      </div>
      {student && !screen && <Action primary onClick={() => open({ mode: "add" })}>Добавить достижение</Action>}
      {screen && <Action onClick={() => open(null)} disabled={busy}>{student ? "К портфолио" : "К очереди"}</Action>}
    </header>
    {!deleting && !screen && message}
    {!screen && student && <>
      <dl className="portfolio-stats panel">
        <div><dt>Всего достижений</dt><dd>{items.length}</dd></div>
        <div><dt>Проекты</dt><dd>{items.filter(row => row.category === "PROJECT").length}</dd></div>
        <div><dt>Награды</dt><dd>{items.filter(row => row.award).length}</dd></div>
      </dl>
      {!!items.length && <div className="services-filters" aria-label="Фильтры портфолио">
        <label>Категория<select value={category} onChange={event => setCategory(event.target.value)}>
          <option value="">Все категории</option><CategoryOptions />
        </select></label>
        <label>Год<select value={year} onChange={event => setYear(event.target.value)}>
          <option value="">Все годы</option>{years.map(value => <option key={value}>{value}</option>)}
        </select></label>
      </div>}
    </>}
    {!screen && (!visible.length ? <section className="panel services-panel">
      <h2>{items.length ? "По этим фильтрам ничего не найдено" : student ? "Добавьте первое достижение" : "Нет достижений на проверке"}</h2>
      {student && !items.length && <p className="services-muted">Расскажите о проекте, участии в конкурсе или другом достижении.</p>}
    </section> : <div className="portfolio-grid">{visible.map(row => <article key={row.id} className="panel portfolio-card">
      <h2>{row.title}</h2>
      <Summary item={row} student={student} />
      {row.description && <p className="services-text portfolio-excerpt">{row.description}</p>}
      {row.result && <p className="services-text portfolio-excerpt"><strong>Результат:</strong> {row.result}</p>}
      <p className="services-muted">{row.attachments.length ? "Вложений: " + row.attachments.length : "Нет вложений"}</p>
      <div className="portfolio-actions">
        <Action onClick={() => open({ mode: "view", id: row.id })}>Просмотреть</Action>
        {student && <Action onClick={() => open({ mode: "edit", id: row.id })}>Редактировать</Action>}
        {student && <Action onClick={() => { setFeedback(undefined); setDeleting(row); }}>Удалить</Action>}
      </div>
    </article>)}</div>)}
    {screen && screen.mode !== "view" && <section className="panel services-panel portfolio-detail">
      <h2>{item ? "Редактирование достижения" : "Новое достижение"}</h2>
      {item && (item.status === "PENDING" || item.status === "CONFIRMED") && <p className="services-muted">
        При изменении сведений или вложений достижение можно отправить на проверку заново.
      </p>}
      <EntryForm key={item?.id ?? "new"} item={item} busy={busy} message={message} cancel={() => open(item ? { id: item.id, mode: "view" } : null)}
        save={form => mutate(form, "Достижение сохранено.", result => {
          if (!result) return;
          update(result);
          if (!item) { setCategory(""); setYear(""); }
          open(null);
        })} />
    </section>}
    {screen?.mode === "view" && item && <section className="panel services-panel portfolio-detail">
      <h2>{item.title}</h2>
      <Summary item={item} student={student} />
      {student && item.status === "SELF_ADDED" && <p className="services-muted">{portfolioStatuses.SELF_ADDED}</p>}
      {item.rejection && <p className="services-notice services-text">Причина отклонения: {item.rejection}</p>}
      {item.description && <p className="services-text">{item.description}</p>}
      {item.result && <p className="services-text"><strong>Результат:</strong> {item.result}</p>}
      {item.link && <p><a className="portfolio-link" href={item.link} target="_blank" rel="noopener noreferrer">Перейти по ссылке</a></p>}
      <div className="services-document-slot"><h3>Вложения</h3><Attachments files={item.attachments} /></div>
      {message}
      {student ? <div className="portfolio-actions">
        <Action onClick={() => open({ mode: "edit", id: item.id })} disabled={busy}>Редактировать</Action>
        {(item.status === "SELF_ADDED" || item.status === "REJECTED") && <Action primary disabled={busy}
          onClick={() => void mutate({ operation: "submit", id: item.id, version: item.version }, "Достижение отправлено на проверку.", result => {
            if (result) update(result);
          })}>Отправить на проверку</Action>}
      </div> : <ReviewForm key={item.id} busy={busy} review={(verdict, reason) =>
        mutate({ operation: "review", id: item.id, version: item.version, verdict, reason }, "Решение сохранено.", () => {
          setItems(current => current.filter(row => row.id !== item.id));
          open(null);
        })} />}
    </section>}
    {deleting && <DeleteConfirmation title={deleting.title} busy={busy} error={feedback?.error ? feedback.text : undefined}
      cancel={() => { setDeleting(null); setFeedback(undefined); }}
      confirm={() => void mutate({ operation: "delete", id: deleting.id, version: deleting.version }, "Достижение удалено.", () => {
        const remaining = items.filter(row => row.id !== deleting.id);
        setItems(remaining);
        if (year && !remaining.some(row => row.achievedOn.startsWith(year))) setYear("");
        setDeleting(null);
      })} />}
  </div>;
}
