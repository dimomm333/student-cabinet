import { randomUUID } from "node:crypto";
import { SectionLinks } from "./section-navigation";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { dormPageSize, dormTabs, getDormStaffContext, type DormTab } from "@/lib/dormitory-queries";
import { documentKinds, dormActions, dormPermissions } from "@/lib/dormitory-shared";
import { chargeBalance } from "@/lib/dormitory-money";
import { Action, Card, Check, dayLabel, bedLabel, DocumentLink, Field, moneyLabel, Pages, Pick, roomLabel, TextArea } from "./dormitory-ui";
import { pageIndex, searchText, type DormSearch } from "./dormitory-student";
import { RepairCard } from "./dormitory-repair-card";
import { AnnouncementForm } from "./announcement-form";
import "@/app/dormitory.css";

type Data = Awaited<ReturnType<typeof getDormStaffContext>>;
type Placement = NonNullable<Data["placements"]>[number];
const rows = <T,>(items: T[]) => items.slice(0, dormPageSize);
const availability: [string, string][] = [["open", "Доступно"], ["unavailable", "Временно недоступно"], ["archive", "Архив"]];
const placementLabels = { ACTIVE: "Проживает", RESERVED: "Резерв", ENDED: "Проживание завершено", CANCELLED: "Резерв отменён", EXPIRED: "Резерв истёк" } as const;
const tabPermissions = {
  fund: ["FUND", "HOUSING"], housing: ["HOUSING"], repairs: ["REPAIR", "TECHNICIAN"], finance: ["FINANCE"],
  documents: ["DOCUMENTS"], grants: ["GRANTS"], news: ["ANNOUNCEMENTS"],
} as const;

function Audit({ items }: { items: Data["audit"] }) {
  if (!items?.length) return null;
  return <Card title="Последние действия"><ul>{items.map(event => <li key={event.id}>
    {dayLabel(event.createdAt)} · {event.actor?.name ?? "Система"} · {dormActions[event.action as keyof typeof dormActions] ?? "Срок резерва истёк"}
  </li>)}</ul></Card>;
}

function Fund({ data }: { data: Data }) {
  const dorm = data.dorm!;
  return <>
    {data.permissions.has("FUND") && <Card title="Настройка жилого фонда">
      <details><summary>Контакты и адрес</summary><Action action="DORM_EDIT" fields={{ dormitoryId: dorm.id }}>
        <Field name="name" label="Название" initial={dorm.name} max={150} /><Field name="address" label="Адрес" initial={dorm.address} max={300} />
        <Field name="contacts" label="Контакты коменданта" initial={dorm.contacts ?? undefined} optional />
      </Action></details>
      <details><summary>Добавить комнату</summary><Action action="ROOM_CREATE" fields={{ dormitoryId: dorm.id }}>
        <Field name="building" label="Корпус" optional /><Field name="floor" label="Этаж" type="number" min={-5} max={150} />
        <Field name="block" label="Блок" optional /><Field name="number" label="Номер комнаты" max={40} />
        <Field name="type" label="Тип комнаты" max={100} /><Field name="capacity" label="Вместимость" type="number" min={1} max={30} />
        <Field name="notes" label="Примечание" optional /><Check name="unavailable" label="Временно недоступна" />
      </Action></details>
    </Card>}
    <Card title="Комнаты и места">{data.fund?.length ? rows(data.fund).map(room => <article className="dorm-row" key={room.id}>
      <h3>{roomLabel(room)} · {room.type}</h3>
      <p>{room.archivedAt ? "В архиве" : room.available ? "Доступна" : "Временно недоступна"} · Вместимость {room.capacity}</p>
      {room.notes && <p>{room.notes}</p>}
      <details><summary>Места и оборудование</summary>
        {data.permissions.has("FUND") && <Action action="ROOM_STATE" fields={{ id: room.id }}><Pick name="state" label="Состояние комнаты" items={availability} /></Action>}
        <ul>{room.beds.map(bed => <li key={bed.id}>Место {bed.number} · {bed.archivedAt ? "В архиве" : !bed.available || !room.available ? "Недоступно" : bed.placements[0]?.status === "ACTIVE" ? "Занято" : bed.placements.length ? "Резерв" : "Свободно"}
          {data.permissions.has("FUND") && <Action action="BED_STATE" fields={{ id: bed.id }}><Pick name="state" label={`Состояние места ${bed.number}`} items={availability} /></Action>}
        </li>)}</ul>
        <h3>Имущество комнаты</h3>
        {room.inventory.map(item => <details key={item.id}><summary>{item.label} · {item.condition}{item.archivedAt && " · В архиве"}</summary>
          <Action action="ASSET_EDIT" fields={{ id: item.id }}>
            <Field name="label" label="Наименование" initial={item.label} /><Field name="condition" label="Состояние" initial={item.condition} />
            <Check name="archive" label="В архив" />
          </Action></details>)}
        <Action action="ASSET" fields={{ id: room.id }}><Field name="label" label="Наименование" /><Field name="condition" label="Состояние" /></Action>
      </details>
    </article>) : <p>Комнаты не найдены.</p>}</Card>
  </>;
}

function HousingPlacement({ placement }: { placement: Placement }) {
  const { id, departure } = placement;
  const expired = placement.status === "RESERVED" && placement.reservedUntil <= new Date();
  return <article className="dorm-row">
    <h3>{placement.student.name} · {expired ? "Срок резерва истёк" : placementLabels[placement.status]}</h3>
    <p>{bedLabel(placement.bed)}{placement.startedAt && ` · с ${dayLabel(placement.startedAt)}`}{placement.endedAt && ` по ${dayLabel(placement.endedAt)}`}</p>
    {placement.status === "RESERVED" && <details><summary>Операции с резервом</summary>
      <p>Резерв до {placement.reservedUntil.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })}</p>
      {!expired && <Action action="CHECK_IN" fields={{ id }} label={placement.previousId ? "Подтвердить переселение" : undefined} />}
      <Action action="RESERVE_CANCEL" fields={{ id }}><Field name="reason" label="Причина отмены" /></Action>
    </details>}
    {placement.status === "ACTIVE" && <details><summary>Выезд и выданное имущество</summary>
      {!departure && <Action action="DEPART" fields={{ id }}><Field name="plannedOn" label="Дата выезда" type="date" fromToday /><Field name="reason" label="Основание" /></Action>}
      {departure && <>
        <p>{dayLabel(departure.plannedOn)} · {departure.reason}{departure.inspectedAt && " · Комната проверена"}</p>
        {departure.notes && <p>{departure.notes}</p>}
        <Action action="INSPECT" fields={{ id }}><TextArea name="notes" label="Состояние комнаты и замечания" optional max={500} /></Action>
      </>}
      <ul>{placement.loans.map(loan => <li key={loan.id}>{loan.isKey && "Ключ · "}{loan.label} · {loan.returnedAt ? `принято ${dayLabel(loan.returnedAt)} · ${loan.condition}` : `выдано ${dayLabel(loan.issuedAt)}`}
        {!loan.returnedAt && <Action action="RETURN" fields={{ id: loan.id }}><Field name="condition" label="Состояние при возврате" /></Action>}
      </li>)}</ul>
      {!departure?.inspectedAt && <Action action="LOAN" fields={{ id }}>
        <Field name="label" label="Наименование" /><Check name="isKey" label="Ключ" />
      </Action>}
      {departure?.inspectedAt && <Action action="CHECK_OUT" fields={{ id }}>
        <Check name="ackDebt" label="Проверены оставшиеся начисления" />
      </Action>}
    </details>}
    {placement.status === "ENDED" && departure?.completedAt && <p>Выезд подтверждён {dayLabel(departure.completedAt)}</p>}
  </article>;
}

function Housing({ data, bedPager }: { data: Data; bedPager: React.ReactNode }) {
  const beds = rows(data.beds ?? []).map(bed => [bed.id, bedLabel(bed)] as [string, string]);
  return <>
    <Card title="Очередь согласованных заявлений">
      {data.approved?.length ? <ul>{rows(data.approved).map(request => {
        const fields = JSON.parse(request.fieldsJson) as { preference?: string; reason?: string };
        return <li key={request.id}>{request.owner.name} · {request.serviceCode === "dorm-transfer" ? "Переселение" : "Заселение"}
          {fields.reason && <p>Основание: {fields.reason}</p>}
          {fields.preference && <p>Пожелания: {fields.preference}</p>}
        </li>;
      })}</ul> : <p>Согласованных заявлений в очереди нет.</p>}
      {bedPager}
      {data.approved?.length && beds.length ? <Action action="RESERVE">
        <Pick name="requestId" label="Заявление" items={rows(data.approved).map(r => [r.id, `${r.owner.name} · ${r.serviceCode === "dorm-transfer" ? "переселение" : "заселение"}`])} />
        <Pick name="bedId" label="Свободное место" items={beds} />
        <Field name="hours" label="Срок резерва, часов" type="number" min={1} max={720} initial={72} />
        <Field name="endsOn" label="Проживание до" type="date" fromToday optional />
      </Action> : !beds.length ? <p>Свободных мест на этой странице нет.</p> : null}
    </Card>
    <Card title="Резервы и проживающие">
      {data.placements?.length ? rows(data.placements).map(placement => <HousingPlacement key={placement.id} placement={placement} />) : <p>Записей размещения по этому фильтру нет.</p>}
    </Card>
    <Card title="Сверка прежних данных">
      <p>Введите имя студента в поиск. Сверьте прежнюю запись с фактическим размещением и укажите основание проверки.</p>
      {data.legacy?.length ? <ul>{rows(data.legacy).map(student => <li key={student.id}>{student.name} · {student.studentProfile?.dormitory}, {student.studentProfile?.dormitoryRoom}
        {beds.length > 0 && <Action action="LEGACY_MATCH" fields={{ studentId: student.id }}>
          <Pick name="bedId" label="Проверенное место" items={beds} /><Field name="basis" label="Документ или основание проверки" />
          <Field name="endsOn" label="Проживание до" type="date" fromToday optional />
        </Action>}
      </li>)}</ul> : null}
    </Card>
  </>;
}

function Finance({ data }: { data: Data }) {
  const dorm = data.dorm!;
  return <>
    <Card title="Настройки оплаты"><Action action="DORM_EDIT" fields={{ dormitoryId: dorm.id }}>
      <Field name="paymentUrl" label="HTTPS-ссылка на страницу оплаты" type="url" initial={dorm.paymentUrl ?? undefined} optional />
    </Action></Card>
    <Card title="Новое начисление">
      {data.recordPlacements?.length ? <Action action="CHARGE">
        <Pick name="id" label="Запись проживания" items={rows(data.recordPlacements).map(p => [p.id, `${p.student.name} · ${bedLabel(p.bed)} · ${dayLabel(p.startedAt)}`])} />
        <Field name="basis" label="Основание" max={300} /><Field name="amountRub" label="Сумма, ₽" inputMode="decimal" max={12} />
        <Field name="from" label="Начало периода" type="date" /><Field name="to" label="Конец периода" type="date" />
        <Field name="dueOn" label="Оплатить до" type="date" />
      </Action> : <p>Нет подтверждённых размещений по фильтру.</p>}
    </Card>
    <Card title="Начисления и оплаты">
      {data.charges?.length ? rows(data.charges).map(charge => <article className="dorm-row" key={charge.id}>
        <h3>{charge.student.name} · {charge.basis}</h3>
        <p>{moneyLabel(charge.amountRub)} · Остаток {moneyLabel(chargeBalance(charge))} · Оплатить до {dayLabel(charge.dueOn)}</p>
        {charge.entries.length > 0 && <ul>{charge.entries.map(entry => <li key={entry.id}>{dayLabel(entry.recordedAt)} · {entry.kind === "PAYMENT" ? "Оплата" : "Корректировка"} · {moneyLabel(entry.amountRub)} · {entry.reference}</li>)}</ul>}
        <details><summary>Подтвердить оплату или внести корректировку</summary><Action action="LEDGER" fields={{ id: charge.id }}>
          <Pick name="kind" label="Вид операции" items={[["PAYMENT", "Оплата"], ["ADJUSTMENT", "Корректировка"]]} />
          <Field name="amountRub" label="Сумма, ₽" inputMode="decimal" max={12} />
          <Field name="reference" label="Подтверждающий документ или основание" />
        </Action></details>
      </article>) : <p>Начисления не найдены.</p>}
    </Card>
  </>;
}

function Documents({ data }: { data: Data }) {
  return <Card title="Документы общежития">
    <details><summary>Загрузить документ</summary><Action action="DOCUMENT" fields={{ dormitoryId: data.dorm!.id }}>
      <Pick name="kind" label="Вид" items={Object.entries(documentKinds)} />
      <Pick name="placementId" label="Получатель" optional="Жильцы общежития" items={rows(data.recordPlacements ?? []).map(p => [p.id, `${p.student.name} · ${bedLabel(p.bed)} · ${dayLabel(p.startedAt)}`])} />
      <Field name="title" label="Название" max={200} />
      <label>Файл<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>
    </Action></details>
    {data.documents?.length ? rows(data.documents).map(doc => <article className="dorm-row" key={doc.id}>
      <DocumentLink doc={doc} /><p>{doc.owner?.name ?? "Жильцы общежития"}{doc.archivedAt && " · В архиве"}</p>
      {!doc.archivedAt && <Action action="DOCUMENT_ARCHIVE" fields={{ id: doc.id }} />}
    </article>) : <p>Документы не найдены.</p>}
  </Card>;
}

function Grants({ data }: { data: Data }) {
  return <Card title="Полномочия сотрудников">
    <Action action="GRANT" fields={{ dormitoryId: data.dorm!.id }}>
      <Field name="userId" label="Email или ID сотрудника" max={254} />
      <Pick name="permission" label="Полномочие" items={Object.entries(dormPermissions)} />
      <Pick name="state" label="Действие" items={[["enable", "Назначить"], ["revoke", "Отозвать"]]} />
    </Action>
    <ul>{rows(data.grants ?? []).map(g => <li className="dorm-row" key={`${g.userId}:${g.permission}`}>{g.user.name} · {g.user.email} · {dormPermissions[g.permission]} · {g.active ? "Действует" : "Отозвано"}</li>)}</ul>
  </Card>;
}

export async function DormitoryStaff({ role, searchParams }: { role: "ADMIN" | "TECHNICAL_STAFF"; searchParams: DormSearch }) {
  const user = await requireRole(role), params = await searchParams;
  const path = role === "ADMIN" ? "/admin/dormitory" : "/staff/dormitory";
  const requestedTab = searchText(params.tab), dormitoryId = searchText(params.dorm, 128);
  const tab: DormTab = Object.hasOwn(dormTabs, requestedTab) ? requestedTab as DormTab : "fund";
  const q = searchText(params.q), page = pageIndex(params.page), bedPage = pageIndex(params.bedPage), status = searchText(params.status);
  let selected = tab;
  let data = await getDormStaffContext(prisma, user, dormitoryId, selected, q, page, status, bedPage);
  if (dormitoryId && !data.dorm) notFound();
  const visibleTabs = (Object.keys(dormTabs) as DormTab[]).filter(key => tabPermissions[key].some(permission => data.permissions.has(permission)));
  if (!requestedTab && visibleTabs[0] && !visibleTabs.includes(selected)) {
    selected = visibleTabs[0];
    data = await getDormStaffContext(prisma, user, dormitoryId, selected, q, page, status, bedPage);
  }
  const filters = new URLSearchParams({ dorm: data.dorm?.id ?? "", tab: selected, ...(q && { q }), ...(status && { status }) });
  const base = path + "?" + filters;
  const hasMore = [data.fund, data.approved, data.placements, data.legacy, data.repairs, data.charges, data.recordPlacements, data.documents, data.grants].some(items => (items?.length ?? 0) > dormPageSize);
  return <div className="dormitory">
    <div className="dashboard-title"><h1>Общежития</h1></div>
    {role === "ADMIN" && <details className="panel dorm-card"><summary>Создать общежитие</summary><Action action="DORM_CREATE">
      <Field name="name" label="Название" max={150} /><Field name="address" label="Адрес" max={300} /><Field name="contacts" label="Контакты коменданта" optional />
    </Action></details>}
    {!data.dorm ? <Card title="Назначения"><p>У вас пока нет назначений в общежитиях.</p></Card> : <>
      <Card title={data.dorm.name}>
        <form action={path} className="dorm-form">
          <label>Общежитие<select name="dorm" defaultValue={data.dorm.id}>{data.dorms.map(dorm => <option key={dorm.id} value={dorm.id}>{dorm.name}</option>)}</select></label>
          <button className="button button-outline">Открыть</button>
        </form>
        <SectionLinks label="Разделы управления" active={selected} items={visibleTabs.map(name => ({
          id: name, label: dormTabs[name], href: path + "?" + new URLSearchParams({ dorm: data.dorm!.id, tab: name }),
        }))} />
      </Card>
      {!visibleTabs.includes(selected) ? <Card title="Доступ"><p>Нет назначения для выбранного раздела.</p></Card> : <>
        {selected !== "news" && <form className="dorm-form panel dorm-card" action={path}>
          <input type="hidden" name="dorm" value={data.dorm.id} /><input type="hidden" name="tab" value={selected} />
          <Field label="Поиск" name="q" initial={q} optional />
          {selected === "fund" && <label>Места<select name="status" defaultValue={status}><option value="">Все комнаты</option><option value="free">Есть свободные</option><option value="occupied">Есть проживающие</option><option value="reserved">Есть резервы</option><option value="unavailable">Есть недоступные</option></select></label>}
          {selected === "housing" && <label>Статус размещения<select name="status" defaultValue={status}><option value="">Активные и резервы</option><option value="active">Проживающие</option><option value="reserved">Резервы</option><option value="history">История</option></select></label>}
          {selected === "repairs" && <label>Статус заявки<select name="status" defaultValue={status}><option value="">Открытые</option><option value="closed">Завершённые</option></select></label>}
          <button className="button button-outline">Найти</button>
        </form>}
        {selected === "fund" && <Fund data={data} />}
        {selected === "housing" && <Housing data={data} bedPager={<Pages href={base + (page ? "&page=" + page : "")} param="bedPage" page={bedPage} more={(data.beds?.length ?? 0) > dormPageSize} />} />}
        {selected === "repairs" && <Card title="Заявки на ремонт">
          {data.repairs?.length ? rows(data.repairs).map(repair => <RepairCard key={repair.id} repair={repair} mode={data.permissions.has("REPAIR") ? "manager" : "technician"}
            userId={user.id} technicians={data.technicians} mergeTargets={data.repairs} />) : <p>Заявок по этому фильтру нет.</p>}
        </Card>}
        {selected === "finance" && <Finance data={data} />}
        {selected === "documents" && <Documents data={data} />}
        {selected === "grants" && <Grants data={data} />}
        {selected === "news" && <AnnouncementForm requestId={randomUUID()} departments={[]} dormitories={data.targets} localOnly />}
        {(selected === "fund" || selected === "housing") && <Audit items={data.audit} />}
        <Pages href={base + (bedPage ? "&bedPage=" + bedPage : "")} page={page} more={hasMore} />
      </>}
    </>}
  </div>;
}
