import "server-only";
import type { Prisma } from "../generated/prisma/client.ts";
import { fail, type BrsActor } from "./brs-repository.ts";
import { deaneryStudentWhere } from "./deanery-repository.ts";
import { emitNotification } from "./notifications-repository.ts";
import { groupFor, groupScopeFor, type PhysicalDB, type PhysicalGroup } from "./physical-education-access.ts";
import { enroll } from "./physical-education-management.ts";
import { PhysicalInput } from "./physical-education-input.ts";

const transferInclude = {
  enrollment: { select: { groupId: true, studentId: true, student: { select: { user: { select: { name: true } } } } } },
  fromGroup: { select: { name: true, plan: { select: { group: { select: { code: true } } } } } },
  toGroup: { select: { name: true, capacity: true, _count: { select: { enrollments: true } }, plan: { select: { group: { select: { code: true } } } } } },
} satisfies Prisma.PeTransferInclude;

function deaneryScope(actor: BrsActor): Prisma.PeTransferWhereInput {
  return { enrollment: { student: deaneryStudentWhere(actor) }, fromGroup: groupScopeFor(actor), toGroup: groupScopeFor(actor) };
}

export async function readTransfers(tx: PhysicalDB, actor: BrsActor, termId?: string) {
  const student = actor.role === "STUDENT";
  if ((!student && actor.role !== "DEANERY_STAFF") || (student && !termId)) return [];
  const rows = await tx.peTransfer.findMany({
    where: student ? { enrollment: { studentId: actor.id, termId } } : { ...deaneryScope(actor), status: "PENDING" },
    include: transferInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(row => ({ id: row.id, name: row.enrollment.student.user.name,
    from: row.fromGroup.name + " · " + row.fromGroup.plan.group.code,
    to: row.toGroup.name + " · " + row.toGroup.plan.group.code,
    seats: Math.max(0, row.toGroup.capacity - row.toGroup._count.enrollments),
    status: row.status, comment: row.comment, reason: row.reason, createdAt: row.createdAt.toISOString(), decidedAt: row.decidedAt?.toISOString(),
  }));
}

export async function submitTransfer(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput, now: Date) {
  if (actor.role !== "STUDENT") fail("Заявку подаёт студент.", 403);
  const enrollmentId = await enroll(tx, actor, group, input, now, "request");
  const current = await tx.peEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
  if (await tx.peTransfer.count({ where: { enrollmentId, active: true } })) fail("У вас уже есть заявка на рассмотрении.", 409);
  return (await tx.peTransfer.create({ data: { enrollmentId, fromGroupId: current.groupId, toGroupId: group.id,
    comment: input.value("comment", 500, false), createdAt: now } })).id;
}

async function notifyDecision(tx: PhysicalDB, id: string, studentId: string, termId: string, status: "APPROVED" | "REJECTED" | "CANCELLED", reason: string) {
  const title = { APPROVED: "Перевод по физкультуре одобрен", REJECTED: "Перевод по физкультуре отклонён", CANCELLED: "Заявка на перевод закрыта" }[status];
  await emitNotification(tx, { sourceKey: "physical-transfer:" + id, sourceId: id, source: "SYSTEM", type: "PE_TRANSFER_" + status,
    category: "STUDY", title, body: reason || "В разделе «Физкультура» доступен результат рассмотрения.", mandatory: true,
    recipients: [{ id: studentId, role: "STUDENT", href: "/dashboard/sports?term=" + encodeURIComponent(termId) + "#choose" }] });
}

export async function resolveTransfer(tx: PhysicalDB, actor: BrsActor, input: PhysicalInput, operation: string, now: Date) {
  const cancel = operation === "cancel-transfer";
  if (actor.role !== (cancel ? "STUDENT" : "DEANERY_STAFF")) fail("Действие недоступно вашей роли.", 403);
  const id = input.value("transferId");
  const row = await tx.peTransfer.findFirst({ where: { id,
    ...(cancel ? { enrollment: { studentId: actor.id } } : deaneryScope(actor)),
  }, include: { enrollment: true } });
  if (!row) fail("Заявка недоступна.", 404);
  if (!row.active || row.status !== "PENDING") fail("Заявка уже закрыта.", 409);
  if (row.fromGroupId !== row.enrollment.groupId) fail("Исходная спортивная группа изменилась.", 409);
  const status = cancel ? "CANCELLED" : operation === "approve-transfer" ? "APPROVED" : "REJECTED";
  const reason = status === "REJECTED" ? input.value("reason", 500) : "";
  if (status === "APPROVED") {
    const group = await groupFor(tx, actor, row.toGroupId);
    if (group.plan.termId !== row.enrollment.termId) fail("Группа относится к другому семестру.", 409);
    await enroll(tx, actor, group, new PhysicalInput({ studentId: [row.enrollment.studentId] }), now);
    await tx.brsPlan.update({ where: { id: group.planId }, data: { revision: { increment: 1 } } });
  }
  await tx.peTransfer.update({ where: { id }, data: { active: null, status, reason, decidedAt: now, decidedById: actor.id } });
  if (!cancel) await notifyDecision(tx, id, row.enrollment.studentId, row.enrollment.termId, status, reason);
  return id;
}

export async function closeOutdatedTransfers(tx: PhysicalDB, enrollmentId: string, groupId: string, actor: BrsActor, now: Date) {
  const row = await tx.peTransfer.findFirst({ where: { enrollmentId, active: true, fromGroupId: { not: groupId } }, include: { enrollment: true } });
  if (!row) return;
  const reason = "Деканат или администратор изменил спортивную группу отдельным решением.";
  await tx.peTransfer.update({ where: { id: row.id }, data: { status: "CANCELLED", active: null, reason, decidedAt: now, decidedById: actor.id } });
  await notifyDecision(tx, row.id, row.enrollment.studentId, row.enrollment.termId, "CANCELLED", reason);
}
