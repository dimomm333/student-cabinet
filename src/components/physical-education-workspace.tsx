import Link from "next/link";
import { DateField, Categories, Choices, CreditStatus, EditForm, prettyDate, Section, TimeFields, TimetableLink, Weekly } from "./physical-education-fields";
import { dayNames } from "@/lib/schedule-calendar";
import { healthLabels } from "@/lib/physical-education-rules";
import type { PhysicalWorkspace } from "@/lib/physical-education-queries";
import { TransferQueue } from "./physical-education-transfer";

type Group = NonNullable<PhysicalWorkspace["selected"]>;
type Role = "ADMIN" | "DEANERY_STAFF" | "TEACHER";

function GroupSettings({ model, group }: { model: PhysicalWorkspace; group?: Group }) {
  return <>
    <div className="pe-grid">
      <label>Название<input required name="name" maxLength={128} defaultValue={group?.name} /></label>
      <Choices name="directionId" label="Спортивное направление" options={model.directions} value={group?.directionId} />
      <label>Вместимость<input name="capacity" type="number" min="1" max="500" defaultValue={group?.capacity ?? 30} required /></label>
      <DateField name="from" label="Начало записи" value={group?.from} />
      <DateField name="until" label="Конец записи включительно" value={group?.until} />
      <label className="pe-check"><input type="checkbox" name="open" value="yes" defaultChecked={group?.registrationOpen} /> Набор открыт</label>
    </div>
    <Categories values={group?.categories} />
  </>;
}

function WeeklyFields({ model, suffix }: { model: PhysicalWorkspace; suffix: string }) {
  return <fieldset className="pe-weekly-fields"><legend>Еженедельное занятие {suffix}</legend>
    <Choices name={"day" + suffix} label="День недели" options={dayNames.map((name, index) => ({ id: String(index + 1), name }))} />
    <TimeFields suffix={suffix} />
    <Choices name={"room" + suffix} label="Место проведения" options={model.rooms} />
  </fieldset>;
}

function Administration({ model, role, path, query }: { model: PhysicalWorkspace; role: Role; path: string; query: string }) {
  if (!model.departments.length) return <p className="panel pe-overview">Нет назначенных подразделений.</p>;
  const group = model.selected;
  return <>
    {role === "ADMIN" && <Section id="catalogs" title="Семестры и направления">
      <EditForm operation="create-term" label="Добавить семестр"><div className="pe-grid">
        <label>Название семестра<input name="name" required maxLength={128} /></label>
        <label>Код семестра<input name="code" required pattern="[a-z0-9\-]+" maxLength={64} /></label>
        <DateField name="from" label="Начало семестра" /><DateField name="until" label="Окончание семестра" />
      </div></EditForm>
      <EditForm operation="create-direction" label="Добавить направление"><label>Название направления<input name="name" required maxLength={80} /></label></EditForm>
    </Section>}
    <Section id="new-group" title="Создать спортивную группу">
      <EditForm operation="create-group" label="Создать группу"><GroupSettings model={model} />
        <div className="pe-grid"><label>Код группы<input name="code" required maxLength={48} /></label>
          <Choices name="departmentId" label="Подразделение" options={model.departments} /><Choices name="termId" label="Семестр" options={model.terms} />
          <Choices name="teacherId" label="Преподаватель" options={model.teachers} /></div>
        <div className="pe-grid"><WeeklyFields model={model} suffix="1" /><WeeklyFields model={model} suffix="2" /></div>
      </EditForm>
    </Section>
    {group && <Section id="group-settings" title="Настройки выбранной группы">
      <EditForm key={group.id} operation="update-group" label="Сохранить настройки" fields={{ groupId: group.id }}><GroupSettings model={model} group={group} /></EditForm>
      <EditForm operation="assign-teacher" label="Сменить преподавателя" fields={{ groupId: group.id }}>
        <Choices name="teacherId" label="Назначить преподавателя" options={model.teachers} value={group.teacherId} />
      </EditForm>
    </Section>}
    <Section id="students" title="Группы здоровья и переводы" open={!!query}>
      <form action={path + "#students"} className="pe-filter"><label>Поиск студента<input type="search" name="q" maxLength={80} placeholder="ФИО, номер или код группы" defaultValue={query} /></label>
        {group && <input type="hidden" name="group" value={group.id} />}<button className="pe-button">Найти</button></form>
      {query && !model.people.length && <p>Подходящие студенты не найдены.</p>}
      <div className="pe-cards">{model.people.map(row => {
        const latest = row.health[0];
        return <article className="pe-item" key={row.id}><h3>{row.name}</h3><p>{row.group ?? "Без учебной группы"} · {row.number}</p>
          <EditForm operation="assign-health" label="Назначить группу здоровья" fields={{ studentId: row.id }}>
            <Choices name="category" label="Группа здоровья" value={latest?.category} options={Object.entries(healthLabels).map(([id, name]) => ({ id, name }))} />
            <label>Особые условия зачёта<textarea name="conditions" rows={2} maxLength={500} defaultValue={latest?.creditConditions} /></label>
            <p className="pe-note">Укажите только учебные условия без диагнозов и медицинских документов.</p>
          </EditForm>
          {!!row.health.length && <details><summary>История назначений</summary><ul className="pe-clean">{row.health.map(item => <li key={item.id}>{prettyDate(item.assignedAt)} · {healthLabels[item.category]}{item.creditConditions && " · " + item.creditConditions}</li>)}</ul></details>}
          <EditForm operation="enroll" label="Зачислить или перевести" fields={{ studentId: row.id }}>
            <Choices name="groupId" label="Спортивная группа" options={model.groups.filter(item => item.departmentId === row.departmentId).map(item =>
              ({ id: item.id, name: item.name + " · " + item.code + " · " + item.term.name }))} />
          </EditForm>
        </article>;
      })}</div>
    </Section>
  </>;
}

function OccurrenceEditor({ model, role, path, query, group }: { model: PhysicalWorkspace; role: Role; path: string; query: string; group: Group }) {
  const chosen = model.chosen;
  return <Section id="schedule-journal" title={role === "TEACHER" ? "Групповой журнал посещаемости" : "Расписание семестра"} open>
    <form action={path + "#schedule-journal"} className="pe-filter"><input type="hidden" name="group" value={group.id} />
      {query && <input type="hidden" name="q" value={query} />}
      <Choices name="slot" label="Занятие" value={chosen?.source} options={model.slots.filter(row => row.change?.type !== "MOVED_FROM").map(row =>
        ({ id: row.source, name: `${prettyDate(row.date)} · ${row.start} · ${row.makeup ? "Отработка" : row.room}${row.change?.cancelled ? " · Отменено" : ""}` }))} />
      <button className="pe-button">Открыть занятие</button>
    </form>
    {chosen && <div key={chosen.source} className="pe-stack">
      <p>{prettyDate(chosen.date)} · {chosen.start}–{chosen.end} · {chosen.building} · {chosen.room}</p>
      {chosen.change?.cancelled ? <p>Занятие отменено.</p> : <>
        {role === "TEACHER" && chosen.ended && <EditForm operation="attendance" label="Сохранить отметки" fields={{ groupId: group.id, slot: chosen.source }}>
          <fieldset className="pe-journal"><legend>Выберите студентов</legend>
            <div className="pe-journal-head"><span>Студент</span><span>Текущая отметка</span></div>
            {model.journal.map(row => <div key={row.id} className="pe-journal-row">
              <label><input type="checkbox" name="students" value={row.id} /> {row.name}</label><span>{row.mark}</span>
              <input type="hidden" name={"version-" + row.id} value={row.version} />
            </div>)}{!model.journal.length && <p>На занятие никто не записан.</p>}
          </fieldset>
          <Choices name="mark" label="Отметка для выбранных студентов" value="PRESENT" options={[
            { id: "PRESENT", name: "Присутствовал" }, { id: "ABSENT", name: "Отсутствовал" }, { id: "EXCUSED", name: "Уважительная причина" },
          ]} />
        </EditForm>}
        {role === "TEACHER" && !chosen.ended && <p>Журнал откроется после окончания занятия.</p>}
        <details><summary>Отменить занятие</summary><EditForm operation="cancel-slot" label="Подтвердить отмену" fields={{ groupId: group.id, slot: chosen.source, version: chosen.version }} /></details>
        {!chosen.started && !chosen.makeup && <details><summary>Перенести занятие</summary>
          <EditForm operation="move-slot" label="Сохранить перенос" fields={{ groupId: group.id, slot: chosen.source, version: chosen.version }}>
            <div className="pe-grid"><DateField name="date" label="Новая дата" value={chosen.date} /><TimeFields start={chosen.start} end={chosen.end} />
              <Choices name="roomId" label="Новое место" options={model.rooms} /></div>
          </EditForm>
        </details>}
      </>}
    </div>}
    <details><summary>Все занятия семестра ({model.slots.length})</summary>
      <ul className="pe-list">{model.slots.map(row => <li key={row.key}><Link href={path + "?" + new URLSearchParams({ group: group.id, slot: row.source }) + "#schedule-journal"}>{prettyDate(row.date)} · {row.start}–{row.end} · {row.makeup ? "Отработка" : row.room}{row.change?.cancelled ? " · Отменено / перенесено" : ""}</Link></li>)}</ul>
    </details>
  </Section>;
}

function TeacherTools({ model, group, path }: { model: PhysicalWorkspace; group: Group; path: string }) {
  return <>
    <Section id="work" title="Нормативы и необязательный рубежный контроль">
      <details><summary>Добавить норматив или РК</summary>
        <EditForm operation="create-work" label="Добавить работу" fields={{ groupId: group.id }}>
          <div className="pe-grid"><Choices name="kind" label="Вид работы" value="STANDARD" options={[{ id: "STANDARD", name: "Норматив" }, { id: "INTERIM", name: "Необязательный РК" }]} />
            <label>Название<input name="name" required maxLength={128} /></label><label>Максимум баллов<input name="maximum" required type="number" min="1" max="20" /></label>
            <DateField name="date" label="Дата проведения (необязательно)" required={false} />
          </div>
          <label>Описание<textarea name="description" rows={2} maxLength={1000} /></label>
          <label>Способ фиксации результата<input name="measurement" maxLength={300} required /></label>
          <label>Критерии оценки<textarea name="criteria" rows={2} required maxLength={1000} /></label>
          <Categories values={group.categories} available={group.categories} />
        </EditForm>
      </details>
      {!model.works.length && <p>Нормативы и рубежный контроль пока не назначены.</p>}
      {model.works.map(work => <details className="pe-item" key={work.id}><summary>{work.name} · {work.maximum} баллов</summary>
        <p>{work.control ? "Необязательный рубежный контроль" : work.description}</p>
        <p>{work.measurement} · {work.criteria}</p>
        {model.roster.filter(student => student.health && work.categories.includes(student.health)).map(student => {
          const result = student.works.find(row => row.id === work.id);
          return <EditForm key={student.id} operation="score-work" label="Сохранить результат" fields={{ groupId: group.id, eventId: work.id, studentId: student.id, version: result?.version ?? 0 }}>
            <strong>{student.name}</strong><div className="pe-grid"><label>Результат<input name="result" required defaultValue={result?.result} maxLength={300} /></label>
              <label>Баллы<input name="score" inputMode="decimal" required defaultValue={result?.score} maxLength={6} /></label></div>
          </EditForm>;
        })}
      </details>)}
    </Section>
    <Section id="makeups" title="Отработки">
      <details><summary>Создать отработку</summary>
        <EditForm operation="create-makeup" label="Опубликовать отработку" fields={{ groupId: group.id }}>
          <div className="pe-grid"><DateField name="date" label="Дата отработки" /><DateField name="until" label="Запись и отмена до указанной даты включительно" />
            <TimeFields /><Choices name="roomId" label="Место проведения" options={model.rooms} />
            <label>Мест<input type="number" name="capacity" min="1" max="500" required defaultValue="10" /></label>
          </div><label>Комментарий<textarea name="comment" rows={2} maxLength={500} /></label>
        </EditForm>
      </details>
      {!model.makeups.length && <p>Отработок пока нет.</p>}
      <ul className="pe-list">{model.makeups.map(row => <li key={row.id}><Link href={path + "?" + new URLSearchParams({ group: group.id, slot: row.source }) + "#schedule-journal"}>{prettyDate(row.date)} · {row.start}–{row.end} · {row.place}</Link>
        <span>{row.cancelled ? "Отменена" : `${row.count} / ${row.capacity} записей`}</span>{row.comment && <span>{row.comment}</span>}</li>)}</ul>
    </Section>
  </>;
}

export function PhysicalWorkspaceView({ model, role, path, query, groupQuery }: { model: PhysicalWorkspace; role: Role; path: string; query: string; groupQuery: string }) {
  const group = model.selected;
  const listed = model.groups.filter(row => (row.name + " " + row.code + " " + row.direction).toLocaleLowerCase("ru-RU").includes(groupQuery.toLocaleLowerCase("ru-RU")) || row.id === group?.id);
  return <div className="pe-page">
    <header className="pe-header"><h1>Физкультура</h1></header>
    <section className="panel pe-overview" aria-label="Спортивные группы">
      {role !== "TEACHER" && <form action={path} className="pe-filter"><label>Поиск группы<input type="search" name="groupQuery" maxLength={80} defaultValue={groupQuery} /></label><button className="pe-button">Найти группы</button></form>}
      {listed.length ? <form action={path} className="pe-filter"><Choices name="group" label="Спортивная группа" value={group?.id}
        options={listed.map(row => ({ id: row.id, name: row.name + " · " + row.code + " · " + row.term.name }))} />
        {groupQuery && <input type="hidden" name="groupQuery" value={groupQuery} />}<button className="pe-button">Открыть группу</button></form> : <p>Спортивных групп нет.</p>}
      {group && <><h2>{group.name} · {group.code}</h2>
        <p>{group.direction} · {group.teacher} · {group.rosterCount} / {group.capacity} мест · {group.open ? "Набор открыт" : "Набор закрыт"}</p>
        <p>{group.term.name} · {prettyDate(group.term.start)} – {prettyDate(group.term.end)}</p><Weekly group={group} />
        {role === "TEACHER" && <TimetableLink role="teacher" term={group.term.code} />}
      </>}
    </section>
    {role === "DEANERY_STAFF" && <TransferQueue rows={model.transfers} />}
    {role !== "TEACHER" && <Administration model={model} role={role} path={path} query={query} />}
    {group && <>
      <Section id="roster" title="Список студентов и готовность к зачёту" open={role !== "TEACHER"}>
        {!model.roster.length ? <p>Студентов в группе пока нет.</p> : <ul className="pe-list">{model.roster.map(row => <li key={row.id}>
          <strong>{row.name}</strong>{row.health && <span>{healthLabels[row.health]}</span>}
          <span>{row.visits ?? 0} / 25 посещений · {row.score ?? 0} / 100 баллов</span><span><CreditStatus {...row} /></span>
        </li>)}</ul>}
        {role === "TEACHER" && <Link className="pe-link" href={`/teacher/session?planId=${group.planId}`}>Утверждение зачёта в БРС</Link>}
      </Section>
      <OccurrenceEditor model={model} role={role} path={path} query={query} group={group} />
      {role === "TEACHER" && <TeacherTools model={model} group={group} path={path} />}
    </>}
  </div>;
}
