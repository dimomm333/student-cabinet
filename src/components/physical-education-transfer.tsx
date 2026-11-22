import type { PhysicalStudent, PhysicalWorkspace } from "@/lib/physical-education-queries";
import { EditForm, Section } from "./physical-education-fields";

const statusLabels = { PENDING: "На рассмотрении", APPROVED: "Одобрена", REJECTED: "Отклонена", CANCELLED: "Отменена" };
const dateLabel = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });

export function TransferDetails({ row }: { row: PhysicalStudent["transfers"][number] }) {
  return <>
    <strong>{row.from} → {row.to}</strong>
    <span>{statusLabels[row.status]} · подана {dateLabel.format(new Date(row.createdAt))}</span>
    {row.comment && <p>{row.comment}</p>}
    {row.reason && <p>Причина решения · {row.reason}</p>}
  </>;
}

export function TransferQueue({ rows }: { rows: PhysicalWorkspace["transfers"] }) {
  return <Section id="transfer-requests" title="Заявки на перевод" open>
    {!rows.length ? <p>Заявок на рассмотрении нет.</p> : <div className="pe-stack">{rows.map(row => <article className="pe-item" key={row.id}>
      <h3>{row.name}</h3>
      <TransferDetails row={row} />
      <p>{row.seats ? "Свободных мест · " + row.seats : "Нет свободных мест"}</p>
      <EditForm operation="approve-transfer" label="Одобрить перевод" fields={{ transferId: row.id }} disabled={!row.seats} />
      <EditForm operation="reject-transfer" label="Отклонить заявку" fields={{ transferId: row.id }}>
        <label>Причина отказа<textarea name="reason" rows={2} required maxLength={500} /></label>
      </EditForm>
    </article>)}</div>}
  </Section>;
}
