import type { DormRepairStatus, Prisma } from "../generated/prisma/client.ts";
import { currentPlacement, dormGrantScope, dormRepairScope, dormLocation, roomDormitory } from "./dormitory-access.ts";
import { choice, date, dormNotice, flag, int, requireGrant, value, type DormContext } from "./dormitory-context.ts";
import { DormError, openRepairStatuses, repairCategories, repairStatuses } from "./dormitory-shared.ts";

const managerTransitions: Partial<Record<DormRepairStatus, DormRepairStatus[]>> = {
  NEW: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["ASSIGNED", "REJECTED", "CANCELLED"], ASSIGNED: ["ASSIGNED", "CANCELLED"],
  IN_PROGRESS: ["ASSIGNED", "CANCELLED"], REWORK: ["ASSIGNED", "CANCELLED"],
  VERIFY: ["REWORK"], CLOSED: ["REWORK"],
};

async function alertRoom(c: DormContext, roomId: string, repairId: string, title: string, assigneeId?: string | null) {
  const residents = await c.db.dormPlacement.findMany({
    where: { status: "ACTIVE", bed: { roomId }, student: { role: "STUDENT" } }, select: { studentId: true },
  });
  const assignee = assigneeId ? await c.db.user.findUnique({ where: { id: assigneeId }, select: { id: true, role: true } }) : null;
  await dormNotice(c, repairId, title, residents.map(placement => placement.studentId), repairId, assignee ? [assignee] : []);
}

export async function changeDormRepair(c: DormContext) {
  const { db, user, input } = c;
  if (input.action === "REPAIR_CREATE") {
    if (user.role !== "STUDENT") throw new DormError("Подать заявку может проживающий студент.", 403);
    const placement = await db.dormPlacement.findFirst({ where: currentPlacement(user.id), select: { bed: { select: { roomId: true } } } });
    if (!placement) throw new DormError("Требуется действующее проживание.", 403);
    const roomId = placement.bed.roomId;
    const category = choice(c, "category", Object.keys(repairCategories) as (keyof typeof repairCategories)[]);
    const title = value(c, "title", 140), description = value(c, "description", 3000);
    // An exact match suppresses repeat submissions. Different descriptions
    // can represent distinct faults even if their titles are identical.
    const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase("ru").replace(/\s+/g, " ");
    const signature = JSON.stringify([category, normalize(title), normalize(description)]);
    if (await db.dormRepair.count({ where: { roomId, signature, status: { in: [...openRepairStatuses] } } })) {
      throw new DormError("Такая неисправность уже есть среди открытых заявок комнаты.", 409);
    }
    const urgent = flag(c, "urgent");
    if (urgent && category !== "ELECTRICITY" && category !== "PLUMBING") throw new DormError("Срочность доступна для заявок по электрике и сантехнике.");
    const repair = await db.dormRepair.create({ data: { authorId: user.id, roomId, category, title, description, signature, urgent } });
    const audit = await c.audit(repair.id);
    await db.dormRepairEvent.create({ data: { repairId: repair.id, auditId: audit.id, status: "NEW" } });
    return repair.id;
  }

  const id = value(c, "id", 128);
  const repair = await db.dormRepair.findFirst({
    where: { id, ...dormRepairScope(user) }, include: { room: dormLocation },
  });
  if (!repair) throw new DormError("Заявка недоступна.", 404);
  if (repair.version !== int(c, "version", 0, 2147483646)) throw new DormError("Заявка изменилась. Обновите страницу.", 409);
  const dormitoryId = roomDormitory(repair.room);
  const manager = await db.dormitory.count({ where: { id: dormitoryId, ...dormGrantScope(user, ["REPAIR"]) } }) > 0;
  const technician = repair.assigneeId === user.id && await db.dormitory.count({ where: {
    id: dormitoryId, ...dormGrantScope(user, ["TECHNICIAN"]),
  } }) > 0;
  const student = user.role === "STUDENT";
  let patch: Prisma.DormRepairUncheckedUpdateInput = { version: { increment: 1 } };
  let status = repair.status, message: string | null = null, staffOnly = false;
  let notify = false, notifyAssignee: string | null = null;

  switch (input.action) {
    case "REPAIR_TRANSITION": {
      status = choice(c, "status", Object.keys(repairStatuses) as DormRepairStatus[]);
      const managerAllowed = manager && (managerTransitions[repair.status]?.includes(status) ?? false);
      const techAllowed = technician && (["ASSIGNED", "REWORK"].includes(repair.status) && status === "IN_PROGRESS" || repair.status === "IN_PROGRESS" && status === "VERIFY");
      const studentAllowed = student && (
        repair.status === "VERIFY" && ["CLOSED", "REWORK"].includes(status) ||
        repair.status === "NEW" && status === "CANCELLED" && repair.authorId === user.id
      );
      if (!managerAllowed && !techAllowed && !studentAllowed) throw new DormError("Переход статуса недоступен.", 403);
      message = value(c, "message", 2000, ["REWORK", "REJECTED", "CANCELLED"].includes(status)) || null;
      patch.status = status;
      if (status === "ASSIGNED") {
        const assigneeId = value(c, "assigneeId", 128);
        if (!await db.dormGrant.count({ where: { dormitoryId, userId: assigneeId, user: { role: { in: ["ADMIN", "TECHNICAL_STAFF"] } }, active: true, permission: "TECHNICIAN" } })) {
          throw new DormError("У исполнителя нет назначения в этом общежитии.");
        }
        patch.assigneeId = assigneeId;
        patch.dueOn = date(c, "dueOn", false);
        notifyAssignee = assigneeId;
      }
      if (status === "REWORK") notifyAssignee = repair.assigneeId;
      notify = true;
      break;
    }
    case "REPAIR_COMMENT":
      if (!openRepairStatuses.some(s => s === repair.status)) throw new DormError("Переписка завершена.", 409);
      staffOnly = manager && flag(c, "staffOnly");
      message = value(c, "message", 2000);
      break;
    case "REPAIR_MERGE": {
      await requireGrant(c, dormitoryId, "REPAIR");
      const target = await db.dormRepair.findFirst({ where: {
        id: value(c, "targetId", 128), roomId: repair.roomId, status: { in: [...openRepairStatuses] },
      } });
      if (!target || target.id === id || !openRepairStatuses.some(s => s === repair.status)) throw new DormError("Выберите другую открытую заявку той же комнаты.", 409);
      status = "MERGED";
      message = value(c, "message", 2000);
      patch = { ...patch, status, mergedIntoId: target.id };
      notify = true;
      break;
    }
    case "REPAIR_FILE": {
      if (!openRepairStatuses.some(s => s === repair.status)) throw new DormError("Заявка уже завершена.", 409);
      const file = input.file;
      if (!file || !["image/jpeg", "image/png"].includes(file.mime)) throw new DormError("Приложите фото JPEG или PNG.");
      if (await db.dormFile.count({ where: { repairId: id } }) >= 10) throw new DormError("Допустимо не более 10 фотографий.", 409);
      await db.dormFile.create({ data: { ...file, repairId: id } });
      message = "Добавлена фотография";
      break;
    }
    default: throw new DormError("Неизвестная операция.");
  }
  const update = await db.dormRepair.updateMany({ where: { id, version: repair.version }, data: patch });
  if (update.count !== 1) throw new DormError("Заявка изменилась. Обновите страницу.", 409);
  const audit = await c.audit(id, patch.assigneeId ? String(patch.assigneeId) : patch.mergedIntoId ? String(patch.mergedIntoId) : undefined);
  await db.dormRepairEvent.create({ data: { repairId: id, auditId: audit.id, status, message, staffOnly } });
  if (notify) await alertRoom(c, repair.roomId, id, status === "VERIFY" ? "Подтвердите результат ремонта" : `Ремонт. ${repairStatuses[status]}`, notifyAssignee);
  return id;
}
