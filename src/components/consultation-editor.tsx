"use client";

import { startTransition, useActionState, useState, type SubmitEvent } from "react";
import { saveConsultation, type ConsultationActionState } from "@/app/deanery/consultations/actions";
import { minuteLabel, scheduleDateBounds } from "@/lib/schedule-calendar";
import type { ConsultationEditorModel } from "@/lib/consultations-repository";
import { ConsultationCard, ConsultationEmpty, ConsultationHeading, ConsultationPeriods, isUpcomingConsultation, type ConsultationClock } from "./consultation-list";
import { Icon } from "./icon";

type EditorRow = ConsultationEditorModel["rows"][number];
const initialState = { success: false, message: "" };

function Feedback({ state }: { state: ConsultationActionState }) {
  if (!state.message) return null;
  return <p role={state.success ? "status" : "alert"} className={state.success ? "consultations-success" : "consultations-error"}>{state.message}</p>;
}

function ConsultationForm({ model, row }: { model: ConsultationEditorModel; row?: EditorRow }) {
  const { teachers, disciplines, buildings, groups } = model;
  const [fields, setFields] = useState({
    teacherId: row?.teacherId ?? "", disciplineId: row?.disciplineId ?? "", buildingId: row?.buildingId ?? "",
    roomId: row?.roomId ?? "", date: row?.date ?? "",
    start: row ? minuteLabel(row.startMinute) : "", end: row ? minuteLabel(row.endMinute) : "",
  });
  const [selected, setSelected] = useState(row?.groups.map(group => group.id) ?? []);
  const [state, submit, pending] = useActionState(saveConsultation, initialState);
  const rooms = buildings.find(building => building.id === fields.buildingId)?.rooms ?? [];
  const change = (field: keyof typeof fields, value: string) => setFields(current => ({ ...current, [field]: value }));
  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => submit(form));
  }
  return <form action={submit} onSubmit={handleSubmit} className="consultations-form" aria-label={row ? "Редактирование консультации" : "Новая консультация"}>
    <input type="hidden" name="operation" value={row ? "update" : "create"} />
    {row && <><input type="hidden" name="id" value={row.id} /><input type="hidden" name="version" value={row.version} /></>}
    <fieldset disabled={pending} className="consultations-form-section">
      <legend><Icon name="book" size={18} /> Преподаватель и дисциплина</legend>
      <div className="consultations-fields">
        <label className="consultations-field">Преподаватель
          <select name="teacherId" required value={fields.teacherId} onChange={event => change("teacherId", event.target.value)}>
            <option value="">Выберите преподавателя</option>
            {row && !teachers.some(teacher => teacher.userId === row.teacherId) && <option value={row.teacherId} disabled>{row.teacher}</option>}
            {teachers.map(teacher => <option key={teacher.userId} value={teacher.userId}>{teacher.user.name}</option>)}
          </select>
        </label>
        <label className="consultations-field">Дисциплина
          <select name="disciplineId" required value={fields.disciplineId} onChange={event => change("disciplineId", event.target.value)}>
            <option value="">Выберите дисциплину</option>
            {row && !disciplines.some(discipline => discipline.id === row.disciplineId) && <option value={row.disciplineId} disabled>{row.discipline}</option>}
            {disciplines.map(discipline => <option key={discipline.id} value={discipline.id}>{discipline.title}</option>)}
          </select>
        </label>
      </div>
    </fieldset>
    <fieldset disabled={pending} className="consultations-form-section">
      <legend><Icon name="clock" size={18} /> Дата и время</legend>
      <div className="grid grid-cols-2 gap-3 consultations-time-fields">
        <label className="col-span-2 consultations-field">Дата<input type="date" name="date" {...scheduleDateBounds} required value={fields.date} onChange={event => change("date", event.target.value)} /></label>
        <label className="consultations-field">Начало<input type="time" name="start" required value={fields.start} onChange={event => change("start", event.target.value)} /></label>
        <label className="consultations-field">Окончание<input type="time" name="end" required value={fields.end} onChange={event => change("end", event.target.value)} /></label>
      </div>
    </fieldset>
    <fieldset disabled={pending} className="consultations-form-section">
      <legend><Icon name="pin" size={18} /> Место проведения</legend>
      <div className="consultations-fields">
        <label className="consultations-field">Корпус
          <select name="buildingId" required value={fields.buildingId}
            onChange={event => setFields({ ...fields, buildingId: event.target.value, roomId: "" })}>
            <option value="">Выберите корпус</option>
            {buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}
          </select>
        </label>
        <label className="consultations-field">Аудитория
          <select name="roomId" required disabled={!fields.buildingId} value={fields.roomId} onChange={event => change("roomId", event.target.value)}>
            <option value="">Выберите аудиторию</option>
            {rooms.map(room => <option key={room.id} value={room.id}>{room.number}</option>)}
          </select>
        </label>
      </div>
    </fieldset>
    <fieldset disabled={pending} className="consultations-form-section">
      <legend><Icon name="cap" size={18} /> Учебные группы</legend>
      <div className="consultations-group-choices">
        {groups.map(group => <label key={group.id}>
          <input name="groupIds" type="checkbox" value={group.id} checked={selected.includes(group.id)}
            onChange={event => setSelected(event.target.checked ? [...selected, group.id] : selected.filter(id => id !== group.id))} />
          {group.code}
        </label>)}
      </div>
    </fieldset>
    <Feedback state={state} />
    <div className="consultations-form-footer">
      <button className="button button-primary" type="submit" disabled={pending || !selected.length}>
        <Icon name={row ? "check" : "plus"} size={18} />
        {pending ? "Сохраняем…" : row ? "Сохранить изменения" : "Добавить консультацию"}
      </button>
    </div>
  </form>;
}

function CancelConsultation({ row }: { row: EditorRow }) {
  const [state, submit, pending] = useActionState(saveConsultation, initialState);
  return <details className="consultations-edit">
    <summary className="consultations-cancel-trigger"><Icon name="close" size={16} />Отменить консультацию</summary>
    <form action={submit} className="consultations-confirm">
      <input type="hidden" name="operation" value="cancel" />
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="version" value={row.version} />
      <p>Студенты и преподаватель увидят отметку об отмене.</p>
      <Feedback state={state} />
      <button className="button button-outline" type="submit" disabled={pending}>{pending ? "Отменяем…" : "Подтвердить отмену"}</button>
    </form>
  </details>;
}

export function ConsultationEditor({ model, today, minute }: { model: ConsultationEditorModel } & ConsultationClock) {
  const { rows, hasAssignments, teachers, disciplines, groups, buildings } = model;
  const [period, setPeriod] = useState("all");
  const canSchedule = !!(teachers.length && disciplines.length && groups.length && buildings.length);
  const visible = period === "all" ? rows : rows.filter(row => isUpcomingConsultation(row, { today, minute }) === (period === "upcoming"));
  return <div className="consultations-workspace">
    <ConsultationHeading description="Расписание консультаций для групп назначенных подразделений." />
    {!hasAssignments ? <ConsultationEmpty title="Нет назначенных подразделений"
      description="Вам пока не назначены учебные подразделения." /> : <>
      {canSchedule ? <details className="panel consultations-create">
        <summary>
          <span className="icon-tile"><Icon name="plus" size={22} /></span>
          <span className="consultations-heading">Новая консультация</span>
          <span className="consultations-disclosure"><Icon name="chevron" size={16} /></span>
        </summary>
        <ConsultationForm model={model} />
      </details> : <p className="panel consultations-notice">Для создания консультации нужны учебные группы, преподаватели, дисциплины и аудитории.</p>}
      <ConsultationPeriods active={period} onSelect={setPeriod} all>
        {visible.length ? <ul className="consultations-list" aria-label="Консультации">{visible.map(row => <ConsultationCard row={row} key={row.id}>
          {!row.cancelled && <>
            {canSchedule && <details className="consultations-edit" key={row.version}>
              <summary>Редактировать <span className="consultations-disclosure"><Icon name="chevron" size={14} /></span></summary>
              <ConsultationForm model={model} row={row} />
            </details>}
            <CancelConsultation row={row} />
          </>}
        </ConsultationCard>)}</ul> : <ConsultationEmpty description={rows.length ? "Выберите другой период, чтобы посмотреть расписание." : undefined} />}
      </ConsultationPeriods>
    </>}
  </div>;
}
