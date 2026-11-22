import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { dormPageSize, getOwnDormitory } from "@/lib/dormitory-queries";
import { configFor } from "@/lib/services-catalog";
import { serviceStatusLabels } from "@/lib/services-ui";
import { paymentLink, repairCategories } from "@/lib/dormitory-shared";
import { chargeBalance } from "@/lib/dormitory-money";
import { Action, Check, dayLabel, bedLabel, DocumentLink, Field, moneyLabel, Pages, Pick, TextArea } from "./dormitory-ui";
import { Icon, type IconName } from "./icon";
import { RepairCard } from "./dormitory-repair-card";
import "@/app/dormitory.css";

function StudentSection({ id, icon, title, children }: {
  id: string; icon: IconName; title: string; children: ReactNode;
}) {
  return <section id={id} aria-labelledby={id + "-title"} className="panel dorm-student-section">
    <h2 id={id + "-title"}><Icon name={icon} size={18} />{title}</h2>
    <div className="dorm-student-section-body">{children}</div>
  </section>;
}

function workPhone(contact: string) {
  if (!/^\+?[\d(][\d ().-]*\d$/.test(contact)) return null;
  const digits = contact.replace(/\D/g, "");
  if (contact.startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? "+" + digits : null;
  return /^(?:7|8)\d{10}$/.test(digits) ? "+7" + digits.slice(1) : null;
}
const href = "/dashboard/dormitory";
const rows = <T,>(items: T[]) => items.slice(0, dormPageSize);
export type DormSearch = Promise<Record<string, string | string[] | undefined>>;
export const searchText = (value: string | string[] | undefined, length = 100) => typeof value === "string" ? value.trim().slice(0, length) : "";
export const pageIndex = (value: string | string[] | undefined) => /^\d{1,4}$/.test(searchText(value, 10)) ? Number(value) : 0;

export async function DormitoryStudent({ searchParams }: { searchParams: DormSearch }) {
  const user = await requireRole("STUDENT");
  const params = await searchParams;
  const pages = { history: pageIndex(params.history), repairs: pageIndex(params.repairs), repairHistory: pageIndex(params.repairHistory), payments: pageIndex(params.payments), documents: pageIndex(params.documents) };
  const pageHref = (section: keyof typeof pages) => {
    const filters = new URLSearchParams(Object.entries(pages).filter(([key, value]) => key !== section && value > 0).map(([key, value]) => [key, String(value)]));
    return filters.size ? href + "?" + filters : href;
  };
  const data = await getOwnDormitory(prisma, user, pages);
  const { resident, reservations, next } = data;
  const dorm = resident?.bed.room.floor.building.dormitory;
  const contractId = resident?.documents[0]?.id;
  const selectedContract = contractId && !rows(data.documents).some(doc => doc.id === contractId)
    ? await prisma.dormDocument.findFirst({
      where: { id: contractId, ownerId: user.id, archivedAt: null }, include: { file: { select: { id: true } } },
    }) : null;
  const pending = data.decisions.find(decision => !decision.dormPlacements.length && decision.status === "COMPLETED");
  const submitted = data.decisions.find(item => !["DRAFT", "COMPLETED", "REJECTED"].includes(item.status));
  const payUrl = next && paymentLink(next.placement.bed.room.floor.building.dormitory.paymentUrl ?? "");
  const displayedDocs = [...(selectedContract ? [selectedContract] : []), ...rows(data.documents)];
  const contact = dorm?.contacts?.trim() ?? "";
  const phone = workPhone(contact);
  const pastPlacements = rows(data.history).filter(item => item.id !== resident?.id);
  return <div className="dormitory dorm-student">
    <header className="dashboard-title"><h1>Общежитие</h1></header>
    <section className="panel dorm-overview" aria-labelledby="dorm-overview-title">
      <div className="dorm-overview-heading">
        <span className="icon-tile"><Icon name="home" size={21} /></span>
        <div><h2 id="dorm-overview-title">{dorm?.name ?? (reservations ? "Ожидает заселения" : pending ? "Ожидает распределения места" : submitted ? "Заявление на заселение" : "Проживание")}</h2>
          {resident && dorm && <p>{dorm.address} · {bedLabel(resident.bed)}</p>}
        </div>
      </div>
      {resident && dorm ? <>
        <dl className="dorm-metrics">
          <div><dt>Статус</dt><dd>Проживает с {dayLabel(resident.startedAt)}</dd></div>
          <div><dt>Срок проживания</dt><dd>{resident.endsOn ? `До ${dayLabel(resident.endsOn)}` : "Не указан"}</dd></div>
          <div><dt>Ближайший платёж</dt><dd>{next ? <><a className="text-link" href="#payments">{moneyLabel(next.balance)}</a><small>{data.overdue.some(row => row.id === next.id) ? "Просрочен · оплатить до" : "Оплатить до"} {dayLabel(next.dueOn)}</small></> : data.hasCharges ? "К оплате ничего нет" : "Начислений пока нет"}</dd></div>
          {data.activeRepairs > 0 && <div><dt>Активные заявки на ремонт</dt><dd><a className="text-link" href="#repairs">{data.activeRepairs}</a></dd></div>}
          <div><dt>Рабочий телефон коменданта</dt><dd>{phone ? <a className="text-link" href={`tel:${phone}`}>{contact}</a> : <span className="dorm-subtle">Не указан</span>}</dd></div>
        </dl>
      </> : reservations ? <p>{bedLabel(reservations.bed, true)}. Резерв действует до {reservations.reservedUntil.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })}.</p>
        : pending ? <p>Заявление одобрено. Сотрудник подбирает место.</p>
          : submitted ? <Link className="text-link" href={`/dashboard/services?requestId=${submitted.id}`}>{serviceStatusLabels[submitted.status]}</Link>
          : <p>Для получения места подайте заявление через <Link className="text-link" href="/dashboard/services?service=dorm-move-in">Услуги</Link>.</p>}
    </section>
    <div className="dorm-student-grid">
      <div className="dorm-student-column">
        <StudentSection id="repairs" icon="clipboard" title="Заявки на ремонт">
          {resident ? <>
            <p>{data.activeRepairs ? `Открытые заявки комнаты: ${data.activeRepairs}. Проверьте список перед подачей.` : "Открытых заявок комнаты нет."}</p>
            {rows(data.repairs).map(repair => <RepairCard key={repair.id} repair={repair} mode="student" userId={user.id} />)}
            <Pages href={pageHref("repairs")} param="repairs" page={pages.repairs} more={data.repairs.length > dormPageSize} anchor="#repairs" />
            <details className="dorm-disclosure"><summary>Сообщить о неисправности</summary><Action action="REPAIR_CREATE">
              <Pick label="Категория" name="category" items={Object.entries(repairCategories)} />
              <Field label="Заголовок" name="title" max={140} />
              <TextArea label="Описание" name="description" max={3000} />
              <Check label="Срочно (электрика и сантехника)" name="urgent" />
            </Action></details>
            {(data.completedRepairs.length > 0 || pages.repairHistory > 0) && <details open={pages.repairHistory > 0} id="repair-history"><summary>Завершённые заявки комнаты</summary>
              {rows(data.completedRepairs).map(repair => <RepairCard key={repair.id} repair={repair} mode="student" userId={user.id} />)}
              <Pages href={pageHref("repairHistory")} param="repairHistory" page={pages.repairHistory} more={data.completedRepairs.length > dormPageSize} anchor="#repair-history" />
            </details>}
          </> : <p>Заявки комнаты доступны во время подтверждённого проживания.</p>}
          {data.formerRepairs.length > 0 && <details><summary>Мои обращения из прежних комнат</summary><ul>
            {data.formerRepairs.map(r => <li key={r.id}>{dayLabel(r.createdAt)} · {r.title} · заявка зарегистрирована</li>)}
          </ul></details>}
        </StudentSection>
        <StudentSection id="payments" icon="calendar" title="Оплата проживания">
          {next ? <>{!resident && <p><strong>{moneyLabel(next.balance)} · Оплатить до {dayLabel(next.dueOn)}</strong></p>}
            {payUrl ? <a className="button button-primary w-fit" href={payUrl} target="_blank" rel="noopener noreferrer">Оплатить</a> : <p>Онлайн-оплата пока недоступна.</p>}</>
            : <p>{data.hasCharges ? "К оплате ничего нет." : "Начислений пока нет."}</p>}
          {data.overdue.length > 0 && <p>Просрочено {moneyLabel(data.overdue.reduce((sum, row) => sum + row.balance, BigInt(0)))}. Начислений с просрочкой: {data.overdue.length}.</p>}
          {rows(data.payments).map(charge => {
            const balance = chargeBalance(charge);
            return <article className="dorm-row" key={charge.id}><h3>{charge.basis} · {moneyLabel(charge.amountRub)}</h3>
              <p>{dayLabel(charge.periodFrom)} – {dayLabel(charge.periodTo)} · Оплатить до {dayLabel(charge.dueOn)}</p>
              <p>{balance > BigInt(0) ? `Остаток ${moneyLabel(balance)}` : balance < BigInt(0) ? `Переплата ${moneyLabel(-balance)}` : "Оплачено"}</p>
              {charge.entries.length > 0 && <ul>{charge.entries.map(entry => <li key={entry.id}>{dayLabel(entry.recordedAt)} · {entry.kind === "PAYMENT" ? "Подтверждённая оплата" : "Корректировка"} · {moneyLabel(entry.amountRub)}</li>)}</ul>}
            </article>;
          })}
          <Pages href={pageHref("payments")} param="payments" page={pages.payments} more={data.payments.length > dormPageSize} anchor="#payments" />
        </StudentSection>
      </div>
      <div className="dorm-student-column">
        <StudentSection id="living" icon="pin" title="Моё проживание">
          {pastPlacements.length ? <ul className="dorm-student-list">{pastPlacements.map(item => <li key={item.id}>
            <strong>{bedLabel(item.bed, true)}</strong>
            <small>С {dayLabel(item.startedAt)}{item.endedAt && ` по ${dayLabel(item.endedAt)}`}</small>
          </li>)}</ul> : <p className="dorm-subtle">{resident ? "Предыдущих размещений нет." : "Истории подтверждённого проживания пока нет."}</p>}
          {contractId && <a className="text-link" href={`#document-${contractId}`}>Посмотреть договор</a>}
          <Pages href={pageHref("history")} param="history" page={pages.history} more={data.history.length > dormPageSize} anchor="#living" />
        </StudentSection>
        <StudentSection id="placement" icon="arrow" title="Заселение и переселение">
          <Link className="text-link" href={`/dashboard/services?service=${resident ? "dorm-transfer" : "dorm-move-in"}`}>{resident ? "Подать заявление на переселение" : "Подать заявление на заселение"}</Link>
          {resident && reservations && <p>Назначено {bedLabel(reservations.bed, true)}. Ожидается подтверждение сотрудника.</p>}
          {data.decisions.length > 0 && <ul className="dorm-student-list">{data.decisions.map(item => <li key={item.id}><Link className="text-link" href={`/dashboard/services?requestId=${item.id}`}>{configFor(item.serviceCode).title}</Link><small>{item.status === "COMPLETED" && !item.dormPlacements.length ? "Одобрено" : serviceStatusLabels[item.status]}</small></li>)}</ul>}
        </StudentSection>
        <StudentSection id="documents" icon="folder" title="Документы и правила">
          {contact && !phone && <p className="dorm-subtle">{contact}</p>}
          {displayedDocs.length ? <ul>{displayedDocs.map(doc => <li id={`document-${doc.id}`} key={doc.id}><DocumentLink doc={doc} /></li>)}</ul> : <p>Доступных документов пока нет.</p>}
          <Pages href={pageHref("documents")} param="documents" page={pages.documents} more={data.documents.length > dormPageSize} anchor="#documents" />
        </StudentSection>
        <StudentSection id="departure" icon="logout" title="Выселение">
          {data.lastDeparture && <p>{data.lastDeparture.completedAt ? `Выезд подтверждён ${dayLabel(data.lastDeparture.completedAt)}` : `Выезд запланирован на ${dayLabel(data.lastDeparture.plannedOn)} · ${data.lastDeparture.inspectedAt ? "Комната проверена" : "Комната ожидает проверки"}`}</p>}
          {data.lastDeparture?.notes && <p className="dorm-long">{data.lastDeparture.notes}</p>}
          {resident && !resident.departure && <Action action="DEPART" fields={{ id: resident.id }}>
            <Field label="Предполагаемая дата выезда" name="plannedOn" type="date" fromToday />
            <Field label="Причина" name="reason" />
          </Action>}
          {!resident && !data.lastDeparture && <p>Процедур выезда пока нет.</p>}
          {resident?.loans.length ? <ul>{resident.loans.map(loan => <li key={loan.id}>{loan.label} · {loan.returnedAt ? `возвращено ${dayLabel(loan.returnedAt)}` : `выдано ${dayLabel(loan.issuedAt)}`}{loan.condition && ` · ${loan.condition}`}</li>)}</ul> : null}
          {data.clearance && <Link className="text-link" href={`/dashboard/clearance?id=${data.clearance.id}`}>Открыть обходной лист</Link>}
        </StudentSection>
      </div>
    </div>
  </div>;
}
