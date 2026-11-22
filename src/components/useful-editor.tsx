"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveEntry } from "@/app/admin/useful/actions";
import { usefulAdminPath, usefulKinds, usefulStatuses } from "@/lib/useful-catalog";

export type UsefulDraft = {
  title: string; description: string; body: string; contacts: string; location: string;
  officialUrl: string; parentId: string; academicDepartmentId: string;
  kind: string; status: string; sortOrder: string;
};
type Option = { id: string; title: string };

export function UsefulEditor({ id, initial, parents, departments, hasChildren }: {
  id: string | null; initial: UsefulDraft; parents: Option[]; departments: Option[]; hasChildren: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, submit, pending] = useActionState(saveEntry.bind(null, id), "");
  const field = (name: keyof UsefulDraft) => ({
    name, value: draft[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = event.target.value;
      setDraft(previous => ({ ...previous, [name]: value }));
    },
  });

  return <form action={submit} className="panel services-panel useful-editor">
    {error && <p role="alert" className="services-error">{error}</p>}
    <fieldset disabled={pending} className="services-fields">
      <label className="services-field">Название <input required maxLength={160} {...field("title")} /></label>
      <label className="services-field">Краткое описание <textarea rows={2} maxLength={500} {...field("description")} /></label>
      <div className="useful-editor-grid">
        <label className="services-field">Тип записи <select {...field("kind")}>
          {Object.entries(usefulKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="services-field">Родительский раздел <select {...field("parentId")}>
          <option value="">Верхний уровень</option>
          {parents.map(parent => <option key={parent.id} value={parent.id}>{parent.title}</option>)}
        </select></label>
        <label className="services-field">Порядок <input type="number" min={-100000} max={100000} step={1} {...field("sortOrder")} /></label>
        <label className="services-field">Публикация <select {...field("status")}>
          {Object.entries(usefulStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      {draft.kind !== "EXTERNAL" && <>
        <label className="services-field">Содержание
          <textarea rows={10} required={draft.kind === "ARTICLE"} maxLength={12000} {...field("body")} />
          <small>Форматирование Markdown поддерживает ## Заголовок, 1. Шаг, - Пункт, **выделение** и [название](адрес). Пустая строка начинает новый абзац.</small>
        </label>
        <div className="useful-editor-grid">
          <label className="services-field">Публичные контакты <textarea rows={2} maxLength={1000} {...field("contacts")} /></label>
          <label className="services-field">Место или адрес <textarea rows={2} maxLength={500} {...field("location")} /></label>
        </div>
      </>}
      {draft.kind === "DIRECTORY" && <label className="services-field">Учебное подразделение
        <select {...field("academicDepartmentId")}>
          <option value="">Без связи</option>
          {departments.map(department => <option key={department.id} value={department.id}>{department.title}</option>)}
        </select>
        <small>Можно связать проверенное подразделение с карточкой. Студенты увидят актуальное название из учебных данных.</small>
      </label>}
      <label className="services-field">Официальный URL <input type="url" maxLength={2048} placeholder="https://" {...field("officialUrl")} /></label>
      {hasChildren && draft.status === "ARCHIVED" && initial.status !== "ARCHIVED" &&
        <label className="useful-confirm">
          <input name="confirmArchive" type="checkbox" value="yes" checked={confirmArchive} onChange={event => setConfirmArchive(event.target.checked)} required />
          Скрыть весь раздел и его вложенные записи для студентов. Записи сохранятся в каталоге администратора.
        </label>}
      <div className="useful-form-actions">
        <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button>
        <Link className="button button-outline" href={usefulAdminPath}>К списку материалов</Link>
      </div>
    </fieldset>
  </form>;
}
