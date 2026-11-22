import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { fail, type BrsActor } from "./brs-repository.ts";
import { groupFor, physicalActor, type PhysicalDB } from "./physical-education-access.ts";
import { PhysicalInput, type PhysicalCommand } from "./physical-education-input.ts";
import { assignHealth, createDirection, createGroup, createTerm, enroll, updateGroup } from "./physical-education-management.ts";
import { assignTeacher, attendance, bookMakeup, changeSlot, createMakeup, createWork, scoreWork } from "./physical-education-journal.ts";
import { closeOutdatedTransfers, resolveTransfer, submitTransfer } from "./physical-education-transfers.ts";

export async function lockPhysicalEducation(tx: PhysicalDB) {
  // Same lock order as BRS and the timetable editor. The first write serializes
  // capacity, weekly limits and occurrence changes across processes.
  await tx.scheduleWriteState.upsert({ where: { id: "schedule" }, create: { id: "schedule" }, update: { revision: { increment: 0 } } });
  await tx.brsWriteState.upsert({ where: { id: "brs" }, create: { id: "brs" }, update: { revision: { increment: 0 } } });
}

export async function applyPhysicalCommand(tx: PhysicalDB, actor: BrsActor, command: PhysicalCommand, now: Date) {
  const { operation, requestId, fields } = command;
  if (!/^[a-z0-9-]{8,80}$/i.test(requestId)) fail("Некорректный ключ операции.");
  if (actor.role === "STUDENT" && !["enroll", "book", "withdraw", "submit-transfer", "cancel-transfer"].includes(operation)) fail("Действие недоступно студенту.", 403);
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const input = new PhysicalInput(fields);
  const groupId = input.value("groupId", 128, false);
  const group = groupId ? await groupFor(tx, actor, groupId) : null;
  const retry = await tx.brsAudit.findUnique({ where: { actorId_requestId: { actorId: actor.id, requestId } } });
  if (retry) {
    if (retry.commandHash !== hash) fail("Ключ уже использован для другой операции.", 409);
    return retry.objectId;
  }
  let objectId: string;
  if (operation === "assign-health") objectId = await assignHealth(tx, actor, input, now);
  else if (operation === "create-term") objectId = await createTerm(tx, actor, input);
  else if (operation === "create-direction") objectId = await createDirection(tx, actor, input);
  else if (operation === "create-group") objectId = await createGroup(tx, actor, input);
  else if (["cancel-transfer", "approve-transfer", "reject-transfer"].includes(operation)) objectId = await resolveTransfer(tx, actor, input, operation, now);
  else {
    if (!group) fail("Выберите спортивную группу.");
    switch (operation) {
      case "update-group": objectId = await updateGroup(tx, actor, group, input); break;
      case "assign-teacher": objectId = await assignTeacher(tx, actor, group, input, now, requestId); break;
      case "enroll":
        objectId = await enroll(tx, actor, group, input, now);
        if (actor.role !== "STUDENT") await closeOutdatedTransfers(tx, objectId, group.id, actor, now);
        break;
      case "submit-transfer": objectId = await submitTransfer(tx, actor, group, input, now); break;
      case "create-makeup": objectId = await createMakeup(tx, actor, group, input, now, requestId); break;
      case "book": case "withdraw": objectId = await bookMakeup(tx, actor, group, input, now, operation === "withdraw"); break;
      case "attendance": objectId = await attendance(tx, actor, group, input, now, requestId); break;
      case "create-work": objectId = await createWork(tx, actor, group, input); break;
      case "score-work": objectId = await scoreWork(tx, actor, group, input, now, requestId); break;
      case "cancel-slot": case "move-slot": objectId = await changeSlot(tx, actor, group, input, now, requestId, operation === "cancel-slot"); break;
      default: return fail("Действие не поддерживается.");
    }
  }
  if (group && operation !== "submit-transfer") await tx.brsPlan.update({ where: { id: group.planId }, data: { revision: { increment: 1 } } });
  await tx.brsAudit.create({ data: { actorId: actor.id, action: "PE_" + operation.toUpperCase().replaceAll("-", "_"), objectId,
    planId: group?.planId, requestId, commandHash: hash, reason: "" } });
  return objectId;
}

export async function executePhysicalCommand(db: PrismaClient, actor: BrsActor, command: PhysicalCommand) {
  try {
    return await db.$transaction(async tx => {
      await lockPhysicalEducation(tx);
      await physicalActor(tx, actor, true);
      return applyPhysicalCommand(tx, actor, command, new Date());
    }, { timeout: 30000, maxWait: 10000 });
  } catch (error) {
    if (error instanceof Error && "code" in error && ["P2034", "P1008", "P2028"].includes(String(error.code))) {
      fail("Данные одновременно изменяются. Обновите страницу и повторите действие.", 409);
    }
    throw error;
  }
}
