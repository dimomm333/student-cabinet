import Link from "next/link";
import type { PhysicalStudent } from "@/lib/physical-education-queries";
import { healthLabels } from "@/lib/physical-education-rules";
import { points } from "@/lib/brs-rules";
import { CreditStatus, EditForm, prettyDate, TimetableLink, Weekly } from "./physical-education-fields";

import { PhysicalGroupList, PhysicalTabs } from "./physical-education-tabs";
import { TransferDetails } from "./physical-education-transfer";

const History = ({ lessons }: { lessons: PhysicalStudent["schedule"] }) =>
  <ul className="pe-list">{lessons.map(row => <li key={row.key}><strong>{prettyDate(row.date)} · {row.start}–{row.end}</strong>
    <span>{row.makeup ? "Отработка" : "Основное занятие"} · {row.building} · {row.room}</span>
    <span>{row.change?.type === "MOVED_FROM" ? "Перенесено на " + prettyDate(row.change.targetDate ?? "") : row.change?.cancelled ? "Отменено" : row.ended ? row.mark : row.change ? "Расписание изменено" : "По расписанию"}</span>
  </li>)}</ul>;

export function PhysicalStudentView({ model }: { model: PhysicalStudent }) {
  const { health, current, totals, next } = model;
  const compatible = current && health && current.categories.includes(health.category);
  const pending = model.transfers.some(row => row.status === "PENDING");
  const standards = model.works.filter(row => !row.control), controls = model.works.filter(row => row.control);
  const workList = (rows: typeof model.works) => <ul className="pe-list">{rows.map(row => <li key={row.id}>
    <strong>{row.name} · {row.score || "—"} / {row.maximum} баллов</strong>
    {row.date && <span>{prettyDate(row.date)}</span>}{row.description && <span>{row.description}</span>}
    <span>{row.measurement}</span><span>{row.criteria}</span>{row.result && <span>Результат · {row.result}</span>}
  </li>)}</ul>;

  return <div className="pe-page">
    <header className="pe-header"><h1>Физкультура</h1>
      {model.terms.length > 1 && <form action="/dashboard/sports" className="pe-filter"><label>Семестр<select name="term" defaultValue={model.term}>{model.terms.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><button className="pe-button">Показать</button></form>}
      {model.terms.length === 1 && <p>{model.terms[0].name}</p>}
    </header>
    <section aria-label="Сводка по физкультуре" className="panel pe-overview" id="summary">
      <dl className="pe-summary">
        <div><dt>Группа здоровья</dt><dd>{health ? healthLabels[health.category] : "Ещё не назначена"}</dd></div>
        <div><dt>Спортивная группа</dt><dd>{current ? current.name + " · " + current.code : "Выбор группы"}</dd></div>
        <div><dt>Преподаватель</dt><dd>{current?.teacher ?? "—"}</dd></div>
        <div><dt>Следующее занятие</dt><dd>{next ? prettyDate(next.date) + " · " + next.start : "—"}</dd></div>
        <div><dt>Подтверждённые посещения</dt><dd>{totals?.counts.visits ?? 0} / 25</dd></div>
        <div><dt>Баллы БРС</dt><dd>{totals?.score ?? 0} / 100</dd></div>
        <div><dt>Зачёт</dt><dd><CreditStatus {...totals} visits={totals?.counts.visits} /></dd></div>
      </dl>
      {health?.conditions && <p className="pe-note"><strong>Особые условия зачёта.</strong> {health.conditions}</p>}
      {current && !compatible && <p className="pe-note">Текущая группа требует пересмотра после изменения категории здоровья. Для перевода обратитесь в деканат.</p>}
      {health && <details><summary>История назначений</summary><ul className="pe-clean">{model.healthHistory.map(row => <li key={row.id}>{prettyDate(row.date)} · {healthLabels[row.category]}</li>)}</ul></details>}
    </section>
    <PhysicalTabs initial={current ? "my-group" : "choose"} panels={{
    "my-group": <section id="my-group" className="panel pe-section-body pe-tab-panel">
      {current ? <><h3>{current.name} · {current.code}</h3><p>{current.direction} · {current.teacher}</p><Weekly group={current} />
        <p>Семестр {prettyDate(current.term.start)} – {prettyDate(current.term.end)} · {current.term.timeZone}</p>
        <TimetableLink role="student" term={current.term.code} />
        <details id="semester-schedule"><summary>Расписание на весь семестр</summary><History lessons={model.schedule} /></details></>
        : <p>Выберите спортивную группу после назначения категории здоровья.</p>}
    </section>,
    "choose": <section id="choose" className="panel pe-section-body pe-tab-panel">
      {!health && <p>Для записи деканат или администратор должен назначить группу здоровья.</p>}
      {current && <p>До решения деканата сохраняются ваша группа и её расписание.</p>}
      {!!model.transfers.length && <ul className="pe-list">{model.transfers.map(row => <li key={row.id}>
        <TransferDetails row={row} />
        {row.status === "PENDING" && <EditForm operation="cancel-transfer" label="Отменить заявку" fields={{ transferId: row.id }} />}
      </li>)}</ul>}
      {!model.groups.length && <p>Подходящих групп в этом семестре пока нет.</p>}
      {!!model.groups.length && <PhysicalGroupList>{model.groups.map(group => {
        const seats = group.capacity - group.rosterCount, selected = current?.id === group.id;
        return <article className="pe-item" key={group.id}><h3>{group.name} · {group.code}</h3><p>{group.direction} · {group.teacher}</p>
          <Weekly group={group} /><p>Категории здоровья · {group.categories.map(category => healthLabels[category]).join(", ")}</p>
          <p>Запись {prettyDate(group.from)} – {prettyDate(group.until)}</p>
          <p>{seats > 0 ? `Свободно ${seats} из ${group.capacity}` : "Нет свободных мест"} · {group.open ? "Набор открыт" : "Набор закрыт"}</p>
          {selected ? <strong>Вы зачислены</strong> : <EditForm operation={current ? "submit-transfer" : "enroll"}
            label={current ? "Подать заявку на перевод" : "Записаться"} fields={{ groupId: group.id }}
            disabled={!health || seats <= 0 || (current ? pending || !group.transferAvailable : !group.open)}>
            {current && !pending && seats > 0 && group.transferAvailable && <label>Причина перевода (необязательно)<textarea name="comment" maxLength={500} rows={2} /></label>}
          </EditForm>}
        </article>;
      })}</PhysicalGroupList>}
    </section>,
    "attendance": <section id="attendance" className="panel pe-section-body pe-tab-panel">
      <div className="pe-anchors"><span>Посещаемость {points(totals?.counts.attendance ?? 0)}/70</span><span>Нормативы {points(totals?.counts.standards ?? 0)}/20</span><span>РК {points(totals?.counts.control ?? 0)}/10</span></div>
      <p>Подтверждённое занятие даёт 2 балла. Для зачёта нужно не менее 25 посещений и 60 баллов.</p>
      <History lessons={[...model.schedule].reverse().filter(row => row.ended || row.change?.cancelled)} />
      {!model.schedule.some(row => row.ended || row.change?.cancelled) && <p>История занятий пока пуста.</p>}
      {current && <div className="pe-anchors"><Link href={`/dashboard/grades?planId=${current.planId}`}>Успеваемость</Link><Link href={`/dashboard/session?planId=${current.planId}`}>Сессия</Link></div>}
    </section>,
    "standards": <section id="standards" className="panel pe-section-body pe-tab-panel">
      {standards.length ? workList(standards) : <p>Для вашей группы здоровья нормативы пока не назначены.</p>}
    </section>,
    "control": <section id="control" className="panel pe-section-body pe-tab-panel">
      <p>Рубежный контроль необязателен. Зачёт возможен без него.</p>
      {controls.length ? workList(controls) : <p>РК пока не назначен.</p>}
    </section>,
    "makeups": <section id="makeups" className="panel pe-section-body pe-tab-panel">
      <p>До двух отработок за неделю. Посещение подтверждает преподаватель после занятия.</p>
      {!model.makeups.length && <p>Отработок пока нет.</p>}
      <div className="pe-cards">{model.makeups.map(row => <article className="pe-item" key={row.id}>
        <h3>{prettyDate(row.date)} · {row.start}–{row.end}</h3><p>{row.place}</p>{row.comment && <p>{row.comment}</p>}
        <p>{row.cancelled ? "Занятие отменено" : row.attendance === "PRESENT" ? "Посещение подтверждено" : row.attendance === "ABSENT" ? "Не посещено" : row.booked ? "Вы записаны" : row.withdrawn ? "Запись отменена" : row.opened ? `Свободно ${row.capacity - row.count} из ${row.capacity}` : "Запись закрыта"}</p>
        {row.opened && (row.booked || current?.id === row.groupId && compatible) && <EditForm operation={row.booked ? "withdraw" : "book"}
          label={row.booked ? "Отменить запись" : "Записаться на отработку"} disabled={!row.booked && row.count >= row.capacity} fields={{ groupId: row.groupId, makeupId: row.id }} />}
      </article>)}</div>
    </section>,
    "activities": <section id="activities" className="panel pe-section-body pe-tab-panel">
      <Link className="pe-link" href="/dashboard/useful/sports-sections">Спортивные секции и клубы в разделе «Полезное»</Link>
    </section>,
    }} />
  </div>;
}
