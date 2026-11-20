"use client";

import { presentAcademicText } from "@/lib/presentation-copy";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { materialTitle, materialCategories, type MaterialsData, type MaterialItem, type MaterialFolderItem } from "@/lib/materials-shared";
import { Icon } from "./icon";

type Form = { title: string; description: string; category: string; folderId: string; groupIds: string[]; url: string };
const emptyForm: Form = { title: "", description: "", category: "LECTURES", folderId: "", groupIds: [], url: "" };
type Queued = { file: File; key: string; id?: string; command?: Record<string, unknown> };
async function api(url: string, body?: unknown): Promise<MaterialsData & { id: string }> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Ошибка запроса. Повторите попытку."); return data;
}
function date(value: string) { return new Date(value).toLocaleDateString("ru-RU"); }
function size(value: number) { return value < 1048576 ? `${Math.ceil(value / 1024)} КБ` : `${(value / 1048576).toFixed(1)} МБ`; }
export function MaterialsWorkspace({ role }: { role: "STUDENT" | "TEACHER" }) {
  const teacher = role === "TEACHER", path = teacher ? "/teacher/materials" : "/dashboard/materials";
  const router = useRouter(), params = useSearchParams();
  const termId = params.get("termId") ?? "", disciplineId = params.get("disciplineId") ?? "", focusId = params.get("materialId") ?? "";
  const [data, setData] = useState<MaterialsData | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""), [category, setCategory] = useState(""), [folderId, setFolderId] = useState(""), [page, setPage] = useState(0), [reload, setReload] = useState(0), [selectedTerm, setSelectedTerm] = useState("");
  const [form, setForm] = useState<Form>(emptyForm), [editing, setEditing] = useState<MaterialItem | null>(null), [composer, setComposer] = useState(false), [dirty, setDirty] = useState(false);
  const [queue, setQueue] = useState<Queued[]>([]), [progress, setProgress] = useState<{ name: string; percent: number; phase: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [batch, setBatch] = useState<string[]>([]);
  const [folderEditor, setFolderEditor] = useState(false), [editingFolder, setEditingFolder] = useState<MaterialFolderItem | null>(null), [folderName, setFolderName] = useState(""), [parentId, setParentId] = useState("");
  const [editorScope, setEditorScope] = useState(""), [folderScope, setFolderScope] = useState("");
  const commandKeys = useRef(new Map<string, string>()), flight = useRef(false);
  const queryKey = `${termId}:${disciplineId}:${focusId}:${category}:${folderId}:${q}:${page}`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const search = new URLSearchParams({ ...(termId && disciplineId ? { termId, disciplineId, ...(category ? { category } : {}), ...(folderId ? { folderId } : {}), ...(q ? { q } : {}), ...(focusId ? { materialId: focusId } : {}), page: String(page) } : {}) });
        const response = await fetch("/api/materials?" + search, { cache: "no-store", signal: controller.signal }); const result = await response.json();
        if (!response.ok) throw new Error(result.error); setData(result); setError(""); setLoading(false);
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message || "Нет соединения с сервером."); setLoading(false); } }
    }, q ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [termId, disciplineId, focusId, category, folderId, q, page, reload]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]");
      if (a && !a.hasAttribute("download") && !a.getAttribute("href")?.startsWith("/api/materials") && !confirm("Есть незавершённые изменения или загрузка. Покинуть страницу?")) { e.preventDefault(); e.stopPropagation(); }
    };
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    const traverse = (e: Event) => { if (e.cancelable && (e as Event & { navigationType?: string }).navigationType === "traverse" && !confirm("Есть незавершённые изменения или загрузка. Покинуть страницу?")) e.preventDefault(); };
    navigation?.addEventListener("navigate", traverse);
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); navigation?.removeEventListener("navigate", traverse); };
  }, [dirty, busy]);
  const course = data?.courses.find(c => c.termId === termId && c.disciplineId === disciplineId);
  const canEdit = teacher && course?.editable;
  function refresh() { setReload(v => v + 1); setSelected([]); }
  function navigate(term: string, discipline = "") {
    if ((dirty || busy) && !confirm("Есть незавершённые изменения или загрузка. Покинуть дисциплину?")) return;
    setDirty(false); setComposer(false); setQueue([]); setBatch([]); setEditing(null); setFolderEditor(false); setQ(""); setPage(0); setCategory(""); setFolderId(""); setLoading(true);
    router.push(path + (discipline ? "?" + new URLSearchParams({ termId: term, disciplineId: discipline }) : ""));
    setSelectedTerm(term);
  }
  function updateForm(change: Partial<Form>) { setForm(f => ({ ...f, ...change })); setDirty(true); }
  function openComposer(item?: MaterialItem) {
    if (dirty && !confirm("Отменить незавершённые изменения?")) return;
    if (!item) for (const key of commandKeys.current.keys()) if (key.includes('"operation":"CREATE_LINK"')) commandKeys.current.delete(key);
    setEditorScope(termId + ":" + disciplineId); setFolderEditor(false);
    setEditing(item ?? null); setQueue([]); setBatch([]); setDirty(false); setComposer(true);
    setForm(item ? { title: item.title, description: item.description, category: item.category, folderId: item.folderId ?? "", groupIds: item.targets.map(t => t.group.id), url: item.url ?? "" } : { ...emptyForm, category: category || "LECTURES", folderId, groupIds: course?.groups.map(g => g.id) ?? [] });
  }
  function openFolder(item?: MaterialFolderItem) {
    if (dirty && !confirm("Отменить незавершённые изменения?")) return;
    setComposer(false); setDirty(false); setFolderScope(termId + ":" + disciplineId); setFolderEditor(true); setEditingFolder(item ?? null); setFolderName(item?.name ?? ""); setParentId(item ? item.parentId ?? "" : folderId);
  }
  async function command(values: Record<string, unknown>) {
    const input = { disciplineId, termId, ...values }, key = JSON.stringify(input);
    if (!commandKeys.current.has(key)) commandKeys.current.set(key, crypto.randomUUID());
    return api("/api/materials", { ...input, requestId: commandKeys.current.get(key) });
  }
  async function act(values: Record<string, unknown>, success = "Изменения сохранены.") {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(""); setMessage("");
    try { await command(values); setMessage(success); refresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); flight.current = false; }
  }
  async function save() {
    if (flight.current) return;
    if (editorScope !== termId + ":" + disciplineId) { setError("Вернитесь к дисциплине, в которой открыт редактор."); return; }
    if (!form.groupIds.length) { setError("Выберите хотя бы одну группу."); return; }
    flight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (queue.length && !editing) {
        for (const entry of queue) {
          if (entry.id) continue;
          const uploadCommand = entry.command ?? { operation: "UPLOAD", requestId: entry.key, disciplineId, termId, ...form, title: materialTitle(form.title, entry.file.name), folderId: form.folderId || null };
          setQueue(old => old.map(f => f.key === entry.key ? { ...f, command: uploadCommand } : f));
          setProgress({ name: entry.file.name, percent: 0, phase: "Загрузка" });
          const result = await new Promise<{ id: string }>((accept, reject) => {
            const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/materials?upload=1"); xhr.timeout = 330000;
            xhr.setRequestHeader("x-file-name", encodeURIComponent(entry.file.name)); xhr.setRequestHeader("Content-Type", "application/octet-stream");
            const metadata = new TextEncoder().encode(JSON.stringify(uploadCommand)), prefix = new Uint8Array(4); new DataView(prefix.buffer).setUint32(0, metadata.length);
            xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress({ name: entry.file.name, percent: Math.round(e.loaded / e.total * 100), phase: e.loaded === e.total ? "Проверка и сохранение" : "Загрузка" }); };
            xhr.onerror = () => reject(new Error("Соединение прервано. Нажмите «Сохранить черновики», чтобы повторить оставшиеся файлы."));
            xhr.ontimeout = () => reject(new Error("Время загрузки истекло. Повторите оставшиеся файлы."));
            xhr.onload = () => { try { const result = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) accept(result); else reject(new Error(result.error ?? "Загрузка не удалась.")); } catch { reject(new Error("Ответ сервера не получен. Повторите загрузку.")); } }; xhr.send(new Blob([prefix, metadata, entry.file]));
          });
          setBatch(old => [...new Set([...old, result.id])]); setQueue(old => old.map(f => f.key === entry.key ? { ...f, id: result.id } : f));
        }
        setMessage("Все файлы сохранены как черновики. Теперь их можно опубликовать вместе.");
      } else {
        await command({ operation: editing ? "EDIT" : "CREATE_LINK", ...form, folderId: form.folderId || null, ...(editing ? { id: editing.id, version: editing.version } : {}) });
        setMessage(editing ? "Материал изменён." : "Ссылка сохранена как черновик."); setComposer(false); setEditing(null);
      }
      setDirty(false); refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); flight.current = false; setProgress(null); }
  }
  async function saveFolder() {
    if (flight.current) return;
    if (folderScope !== termId + ":" + disciplineId) { setError("Вернитесь к дисциплине, в которой открыта папка."); return; }
    flight.current = true; setBusy(true); setError("");
    try { await command({ operation: editingFolder ? "EDIT_FOLDER" : "CREATE_FOLDER", name: folderName, category: editingFolder?.category ?? (category || "LECTURES"), parentId: parentId || null, ...(editingFolder ? { id: editingFolder.id, version: editingFolder.version } : {}) }); setFolderEditor(false); setDirty(false); setMessage("Папка сохранена."); refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); flight.current = false; }
  }
  function folderLabel(id: string, visited = new Set<string>()): string {
    const f = data?.folders.find(f => f.id === id); if (!f || visited.has(id)) return "";
    visited.add(id); return (f.parentId ? folderLabel(f.parentId, visited) + " / " : "") + f.name;
  }
  const folders = (data?.folders.filter(f => !category || f.category === category) ?? []).sort((a,b) => folderLabel(a.id).localeCompare(folderLabel(b.id), "ru"));
  const terms = [...new Map(data?.courses.map(c => [c.termId, { id: c.termId, name: `${c.year} · ${presentAcademicText(c.term)}`, starts: c.startsOn, ends: c.endsOn }]) ?? []).values()];
  const defaultTerm = terms[0]?.id ?? "";
  return <div className="materials-workspace" data-query={queryKey}>
    <div className="dashboard-title"><div><h1>Учебные материалы</h1><p>{teacher ? "Ваши дисциплины, черновики и публикации для групп." : "Материалы ваших дисциплин за текущий и прошлые семестры."}</p></div></div>
    {error && <div className="services-error" role="alert">{error} <button className="text-link" onClick={refresh}>Обновить список</button></div>}
    {message && <p className="materials-message" role="status">{message}</p>}
    {loading && <p role="status">Загружаем материалы…</p>}
    {!loading && data && !course && <>
      <label className="materials-term">Учебный год и семестр<select value={selectedTerm || defaultTerm} onChange={e => setSelectedTerm(e.target.value)}>{terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {!data.courses.length && <section className="panel materials-empty"><Icon name="folder" size={32} /><h2>{teacher ? "Нет назначенных дисциплин" : "Учебные данные пока не определены"}</h2><p>{teacher ? "Для загрузки материалов требуется действующее назначение на дисциплину, семестр и группу." : "После определения группы и учебного плана здесь появятся ваши дисциплины."}</p></section>}
      <div className="materials-course-grid">{data.courses.filter(c => c.termId === (selectedTerm || defaultTerm)).map(c => <button key={c.termId + c.disciplineId} className="panel materials-course" onClick={() => navigate(c.termId, c.disciplineId)}><span className="icon-tile"><Icon name="folder" /></span><h2>{c.title}</h2><p>{c.teachers.join(", ") || "Преподаватель не назначен"}</p><span>{c.count} опубликованных материалов</span>{teacher && !c.editable && <small>Архив · только просмотр</small>}</button>)}</div>
    </>}
    {course && <>
      <div className="materials-toolbar materials-course-nav"><button className="text-link" onClick={() => navigate(course.termId)}>← Все дисциплины</button><span>{course.year} · {presentAcademicText(course.term)}</span><button className="text-link" disabled={busy} onClick={refresh}>Обновить</button></div>
      <div className="materials-heading"><div><h2>{course.title}</h2><p>{course.teachers.join(", ")}</p></div>{canEdit && <button className="button button-primary" disabled={busy} onClick={() => openComposer()}>Добавить материалы</button>}</div>
      {teacher && !canEdit && <p className="materials-message">Назначение отозвано. Собственные материалы доступны для просмотра; изменение запрещено.</p>}
      {composer && editorScope === termId + ":" + disciplineId && canEdit && <section className="panel materials-composer" aria-label="Редактор материала">
        <h3>{editing ? "Изменить материал" : "Новые материалы"}</h3>
        <fieldset disabled={busy || queue.some(f => Boolean(f.command))}>
          <label>Название{!editing && " (для файлов необязательно)"}<input aria-label="Название материала" maxLength={200} value={form.title} onChange={e => updateForm({ title: e.target.value })} /></label>
          <label>Описание<textarea aria-label="Описание" maxLength={4000} value={form.description} onChange={e => updateForm({ description: e.target.value })} /></label>
          <div className="materials-fields"><label>Категория<select aria-label="Категория материала" value={form.category} onChange={e => updateForm({ category: e.target.value, folderId: "" })}>{Object.entries(materialCategories).map(([key,name]) => <option key={key} value={key}>{name}</option>)}</select></label>
            <label>Папка<select aria-label="Папка материала" value={form.folderId} onChange={e => updateForm({ folderId: e.target.value })}><option value="">Прямо в категории</option>{data?.folders.filter(f => f.category === form.category).map(f => <option key={f.id} value={f.id}>{folderLabel(f.id)}</option>)}</select></label></div>
          <fieldset className="materials-groups"><legend>Доступно группам и подгруппам</legend>{course.groups.map(g => <label key={g.id}><input type="checkbox" checked={form.groupIds.includes(g.id)} onChange={e => updateForm({ groupIds: e.target.checked ? [...form.groupIds, g.id] : form.groupIds.filter(id => id !== g.id) })} />{g.code}</label>)}</fieldset>
          {!editing && <label>Выбрать файлы (до {size(data!.maxFileBytes)} каждый)<input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.zip" onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length > 100 || files.some(f => f.size > data!.maxFileBytes)) { setError(`Выберите до 100 файлов размером до ${size(data!.maxFileBytes)} каждый.`); return; } setQueue(files.map(file => ({ file, key: crypto.randomUUID() }))); setDirty(true); }} /></label>}
          {(!editing?.file && !queue.length) && <label>Внешняя ссылка<input aria-label="Внешняя ссылка" type="url" placeholder="https://…" maxLength={2048} value={form.url} onChange={e => updateForm({ url: e.target.value })} /></label>}
        </fieldset>
        {!!queue.length && <ul className="materials-queue">{queue.map(f => <li key={f.key}>{f.file.name} · {size(f.file.size)} {f.id && <strong>Сохранён</strong>}</li>)}</ul>}
        {progress && <label role="status">{progress.phase}: {progress.name} · {progress.percent}%<progress max={100} value={progress.percent} /></label>}
        <div className="materials-actions"><button className="button button-primary" disabled={busy || (queue.length > 0 && queue.every(f => f.id))} onClick={save}>{editing ? "Сохранить изменения" : "Сохранить черновики"}</button>{!!batch.length && <button className="button button-primary" disabled={busy || queue.some(f => !f.id)} onClick={async () => { if (await act({ operation: "PUBLISH", items: batch.map(id => ({ id, version: 1 })) }, "Материалы опубликованы одним пакетом.")) { setBatch([]); setQueue([]); setComposer(false); } }}>Опубликовать пакет ({batch.length})</button>}<button className="button button-outline" disabled={busy} onClick={() => { if (!dirty || confirm("Закрыть редактор? Незавершённые изменения будут потеряны.")) { setComposer(false); setDirty(false); } }}>Закрыть</button></div>
        <p className="muted">Черновики не видны студентам и не создают уведомлений.</p>
      </section>}
      <div className="materials-filters"><div className="materials-toolbar"><label className="materials-search"><span>Поиск по названию</span><input type="search" placeholder="Поиск по названию" maxLength={200} value={q} onChange={e => { setQ(e.target.value); setPage(0); }} /></label>{focusId && <button className="text-link" onClick={() => router.replace(path + "?" + new URLSearchParams({ termId, disciplineId }))}>Показать все материалы дисциплины</button>}</div>
      <nav className="materials-tabs" aria-label="Категории материалов"><button aria-pressed={!category} onClick={() => { setCategory(""); setFolderId(""); setPage(0); }}>Все категории</button>{Object.entries(materialCategories).map(([key,name]) => <button key={key} aria-pressed={category === key} onClick={() => { setCategory(key); setFolderId(""); setPage(0); }}>{name}</button>)}</nav></div>
      <div className="materials-layout"><aside className="panel materials-tree" aria-label="Дерево папок"><div className="materials-toolbar"><h3>Папки</h3>{canEdit && <button className="text-link" disabled={busy} onClick={() => { openFolder(); }}>+ Создать</button>}</div><button className={!folderId ? "active" : ""} onClick={() => { setFolderId(""); setPage(0); }}>Все материалы</button>{folders.map(f => <div key={f.id} className="materials-folder" style={{ marginLeft: Math.min((folderLabel(f.id).split(" / ").length - 1) * 12, 36) }}><button title={folderLabel(f.id)} className={folderId === f.id ? "active" : ""} onClick={() => { setFolderId(f.id); setPage(0); }}><Icon name="folder" size={16} />{f.name}</button>{canEdit && f.editable && <button aria-label={`Изменить папку ${f.name}`} onClick={() => { openFolder(f); }}>···</button>}</div>)}{!folders.length && <p className="muted">В этой категории пока нет папок.</p>}</aside>
      <div className="materials-list">
        {folderEditor && folderScope === termId + ":" + disciplineId && canEdit && <section className="panel materials-composer"><h3>{editingFolder ? "Изменить папку" : "Новая папка"}</h3><label>Название папки<input aria-label="Название папки" maxLength={200} value={folderName} onChange={e => { setFolderName(e.target.value); setDirty(true); }} /></label><label>Родительская папка<select aria-label="Родительская папка" value={parentId} onChange={e => { setParentId(e.target.value); setDirty(true); }}><option value="">Корень категории · {materialCategories[(editingFolder?.category ?? (category || "LECTURES")) as keyof typeof materialCategories]}</option>{data?.folders.filter(f => f.id !== editingFolder?.id && f.category === (editingFolder?.category ?? (category || "LECTURES"))).map(f => <option key={f.id} value={f.id}>{folderLabel(f.id)}</option>)}</select></label><div className="materials-actions"><button className="button button-primary" disabled={busy} onClick={saveFolder}>Сохранить папку</button><button className="button button-outline" disabled={busy} onClick={() => { if (!dirty || confirm("Отменить изменения папки?")) { setFolderEditor(false); setDirty(false); } }}>Отмена</button>{editingFolder && <button className="text-link" disabled={busy} onClick={() => { if (confirm("Удалить папку? Непустую папку удалить нельзя: сначала переместите её материалы и подпапки.")) void act({ operation: "DELETE_FOLDER", id: editingFolder.id, version: editingFolder.version, confirmed: true }, "Папка удалена.").then(ok => { if (ok) { setFolderEditor(false); setDirty(false); } }); }}>Удалить папку</button>}</div></section>}
        {teacher && !!selected.length && <div className="materials-toolbar"><span>Выбрано: {selected.length}</span><button className="button button-primary" disabled={busy} onClick={() => act({ operation: "PUBLISH", items: data!.items.filter(m => selected.includes(m.id)).map(m => ({ id: m.id, version: m.version })) }, "Выбранные материалы опубликованы.")}>Опубликовать выбранные</button></div>}
        {!data?.items.length && !loading && <section className="panel materials-empty"><Icon name="folder" size={30} /><h3>{q || category || folderId || focusId ? "Материалы не найдены" : teacher ? "Пока нет материалов" : "Преподаватель пока не опубликовал материалы"}</h3><p>{teacher ? "Создайте папку, добавьте файлы или внешнюю ссылку." : "Публикации появятся здесь после добавления преподавателем."}</p></section>}
        {data?.items.map(m => <article className={`panel material-card ${m.id === focusId ? "material-focused" : ""}`} key={m.id} id={`material-${m.id}`}>
          <div className="material-body">
            <div className="material-heading-line"><span className="material-kind">{materialCategories[m.category as keyof typeof materialCategories]} · {m.file ? m.file.name.split(".").pop()?.toUpperCase() : "Ссылка"}{m.file && ` · ${size(m.file.size)}`}</span>{teacher && <label className="material-select"><input type="checkbox" aria-label={`Выбрать ${m.title}`} checked={selected.includes(m.id)} disabled={!m.editable || busy} onChange={e => setSelected(old => e.target.checked ? [...old,m.id] : old.filter(id => id !== m.id))} /> {m.status === "PUBLISHED" ? "Опубликован" : "Черновик"}</label>}</div>
            <h3>{m.title}</h3>
            {m.description && <p className="material-description">{m.description}</p>}
            <details className="material-details"><summary aria-label={`Сведения о материале «${m.title}»`}><span>{m.author.name} · {date(m.publishedAt ?? m.createdAt)}</span><span className="material-details-label">Сведения <span aria-hidden="true">⌄</span></span></summary><div className="material-details-body"><p className="material-meta">Изменён {date(m.updatedAt)}</p>{m.file && <p className="material-filename">{m.file.name}</p>}{m.folderId && <p className="material-meta">Папка: {folderLabel(m.folderId)}</p>}{teacher && <p className="material-meta">Группы: {m.targets.map(t => t.group.code).join(", ")}{!m.editable && " · Только просмотр: назначение отозвано"}</p>}</div></details>
          </div>
          <div className="materials-actions">{m.file ? <a className="button button-outline" href={`/api/materials?file=${encodeURIComponent(m.id)}`} download>Скачать</a> : <a className="button button-outline" href={m.url!} target="_blank" rel="noopener noreferrer">Открыть ресурс ↗</a>}{m.editable && <><button className="text-link" aria-label="Изменить / переместить" disabled={busy} onClick={() => openComposer(m)}>Изменить</button><button className="text-link" disabled={busy} onClick={() => act(m.status === "PUBLISHED" ? { operation: "UNPUBLISH", id: m.id, version: m.version } : { operation: "PUBLISH", items: [{ id: m.id, version: m.version }] }, m.status === "PUBLISHED" ? "Публикация снята. Доступ студентов закрыт." : "Материал опубликован.")}>{m.status === "PUBLISHED" ? "Снять публикацию" : "Опубликовать"}</button><button className="text-link" disabled={busy} onClick={() => { if (confirm(`Удалить «${m.title}»? Материал станет недоступен студентам.`)) void act({ operation: "DELETE", id: m.id, version: m.version, confirmed: true }, "Материал удалён."); }}>Удалить</button></>}</div>
        </article>)}
        {!!data && data.total > 50 && <div className="materials-toolbar"><button className="button button-outline" disabled={!page} onClick={() => setPage(p => p - 1)}>Назад</button><span>Страница {page + 1} из {Math.ceil(data.total / 50)}</span><button className="button button-outline" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(p => p + 1)}>Далее</button></div>}
      </div></div>
    </>}
    <Link className="text-link materials-home" href={teacher ? "/teacher" : "/dashboard"}>← На главную кабинета</Link>
  </div>;
}
