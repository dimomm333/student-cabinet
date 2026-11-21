import type { DormRepairStatus } from "@/generated/prisma/client";
import { Action, Check, Field, Pick, TextArea, dayLabel, fileHref, roomLabel } from "./dormitory-ui";
import { openRepairStatuses, repairCategories, repairStatuses } from "@/lib/dormitory-shared";

const transitionLabels: Partial<Record<DormRepairStatus, string>> = {
  ACCEPTED: "Принять заявку", REJECTED: "Отклонить заявку", CANCELLED: "Отменить заявку", REWORK: "Вернуть на доработку",
  IN_PROGRESS: "Начать работу", VERIFY: "Передать жильцам на проверку", CLOSED: "Подтвердить выполнение",
};

type Repair = {
  id: string; version: number; authorId: string; assigneeId: string | null; mergedIntoId: string | null; status: DormRepairStatus;
  title: string; category: keyof typeof repairCategories; description: string; urgent: boolean; dueOn: Date | null;
  room: Parameters<typeof roomLabel>[0] & { id: string }; assignee: { name: string } | null;
  events: { id: string; status: DormRepairStatus; message: string | null; createdAt: Date; staffOnly: boolean }[];
  files: { id: string; name: string }[];
};
export function RepairCard({ repair, mode, userId, technicians = [], mergeTargets = [] }: {
  repair: Repair; mode: "student" | "manager" | "technician"; userId: string; technicians?: { id: string; name: string }[];
  mergeTargets?: Repair[];
}) {
  const { status } = repair;
  const open = openRepairStatuses.some(item => item === status);
  const fields = { id: repair.id, version: repair.version };
  const canAssign = mode === "manager" && ["ACCEPTED", "ASSIGNED", "IN_PROGRESS", "REWORK"].includes(status) && technicians.length > 0;
  let transitions: DormRepairStatus[] = [];
  if (mode === "student") {
    if (status === "VERIFY") transitions = ["CLOSED", "REWORK"];
    if (status === "NEW" && repair.authorId === userId) transitions = ["CANCELLED"];
  } else if (mode === "manager") {
    if (status === "NEW") transitions = ["ACCEPTED", "REJECTED", "CANCELLED"];
    if (status === "ACCEPTED") transitions = ["REJECTED", "CANCELLED"];
    if (["ASSIGNED", "IN_PROGRESS", "REWORK"].includes(status)) transitions = ["CANCELLED"];
    if (["VERIFY", "CLOSED"].includes(status)) transitions = ["REWORK"];
  }
  if (mode !== "student" && repair.assigneeId === userId) {
    if (["ASSIGNED", "REWORK"].includes(status)) transitions.push("IN_PROGRESS");
    if (status === "IN_PROGRESS") transitions.push("VERIFY");
  }
  const candidates = mergeTargets.filter(r => r.id !== repair.id && r.room.id === repair.room.id && openRepairStatuses.some(item => item === r.status));
  return <article className="dorm-row" id={`repair-${repair.id}`}>
    <h3>{repair.title} · {repairStatuses[status]}</h3>
    <p className="dorm-subtle">{roomLabel(repair.room)} · {repairCategories[repair.category]}{repair.urgent && " · Срочная"}</p>
    <p className="dorm-long">{repair.description}</p>
    {(repair.assignee || repair.dueOn) && <p>{repair.assignee?.name}{repair.dueOn && ` · Срок выполнения ${dayLabel(repair.dueOn)}`}</p>}
    {repair.mergedIntoId && <a className="text-link" href={`#repair-${repair.mergedIntoId}`}>Перейти к основной заявке</a>}
    {repair.files.length > 0 && <ul>{repair.files.map(file => <li key={file.id}><a className="text-link" href={fileHref(file.id)}>{file.name}</a></li>)}</ul>}
    <details><summary>История и действия</summary>
      <ul>{repair.events.map(event => <li key={event.id} className="dorm-long">{dayLabel(event.createdAt)} · {repairStatuses[event.status]}{event.staffOnly && " · Служебная запись"}{event.message && ` · ${event.message}`}</li>)}</ul>
      {transitions.map(next => <Action key={next} action="REPAIR_TRANSITION" fields={{ ...fields, status: next }}
        label={transitionLabels[next] ?? repairStatuses[next]}>
        {["CANCELLED", "REJECTED", "REWORK"].includes(next) && <Field label="Причина" name="message" />}
      </Action>)}
      {canAssign && <Action action="REPAIR_TRANSITION" fields={{ ...fields, status: "ASSIGNED" }} label="Назначить исполнителя">
        <Pick label="Исполнитель" name="assigneeId" items={technicians.map(t => [t.id, t.name])} />
        <Field label="Срок выполнения" name="dueOn" type="date" optional />
      </Action>}
      {open && <Action action="REPAIR_COMMENT" fields={fields}><TextArea label="Комментарий" name="message" />
        {mode === "manager" && <Check label="Служебная заметка" name="staffOnly" />}
      </Action>}
      {mode === "manager" && open && candidates.length > 0 && <Action action="REPAIR_MERGE" fields={fields}>
        <Pick label="Основная заявка" name="targetId" items={candidates.map(r => [r.id, r.title])} />
        <Field label="Причина объединения" name="message" />
      </Action>}
      {open && <Action action="REPAIR_FILE" fields={fields}><label>Фото неисправности<input name="file" type="file" accept="image/png,image/jpeg" required /></label></Action>}
    </details>
  </article>;
}
