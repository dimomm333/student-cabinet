import type { Prisma } from "../generated/prisma/client.ts";
import { currentPlacement, dormLocation, placementLocation, roomDormitory } from "./dormitory-access.ts";
import { date, dormNotice, flag, int, requireGrant, value, type DormContext } from "./dormitory-context.ts";
import { DormError, dormitoryServiceCodes } from "./dormitory-shared.ts";
import { chargeBalance } from "./dormitory-money.ts";
import { dormCalendarDay, occupiedPlacement, openBed } from "./dormitory-state.ts";

async function expireReservations(c: DormContext, studentId: string, bedId: string) {
  const where: Prisma.DormPlacementWhereInput = { status: "RESERVED", reservedUntil: { lte: c.now }, OR: [{ studentId }, { bedId }] };
  const expired = await c.db.dormPlacement.findMany({ where, select: { id: true } });
  if (!expired.length) return;
  await c.db.dormPlacement.updateMany({ where, data: { status: "EXPIRED", endedAt: c.now } });
  await c.db.dormAudit.createMany({ data: expired.map(({ id }) => ({ targetId: id, action: "RESERVE_EXPIRED" })) });
}

async function allocate(c: DormContext) {
  const { db, now, input } = c;
  const bed = await db.dormBed.findFirst({ where: { id: value(c, "bedId", 128), ...openBed(now) }, include: { room: dormLocation } });
  if (!bed) throw new DormError("Место больше недоступно.", 409);
  await requireGrant(c, roomDormitory(bed.room), "HOUSING");
  const activeCount = await db.dormPlacement.count({ where: { bed: { roomId: bed.roomId }, ...occupiedPlacement(now) } });
  if (activeCount >= bed.room.capacity) throw new DormError("Вместимость комнаты исчерпана.", 409);
  const endsOn = date(c, "endsOn", false);
  if (endsOn && endsOn < dormCalendarDay(now)) throw new DormError("Срок проживания уже закончился.");
  const legacy = input.action === "LEGACY_MATCH";
  const decision = legacy ? null : await db.serviceRequest.findFirst({ where: {
    id: value(c, "requestId", 128), serviceCode: { in: [...dormitoryServiceCodes] }, status: "COMPLETED",
    submittedAt: { not: null }, completedAt: { not: null }, deletedAt: null,
    dormPlacements: { none: { status: { in: ["ACTIVE", "ENDED"] } } },
  } });
  if (!legacy && !decision) throw new DormError("Согласованное заявление недоступно.", 404);
  const studentId = decision?.ownerId ?? value(c, "studentId", 128);
  const student = await db.user.findFirst({ where: { id: studentId, role: "STUDENT" }, include: { studentProfile: true } });
  if (!student?.studentProfile) throw new DormError("Профиль студента недоступен.", 404);
  const previous = await db.dormPlacement.findFirst({ where: currentPlacement(studentId), include: placementLocation });
  if (decision?.serviceCode === "dorm-transfer") {
    if (!previous) throw new DormError("Для переселения требуется действующее проживание.", 409);
    await requireGrant(c, roomDormitory(previous.bed.room), "HOUSING");
  } else if (previous) throw new DormError("У студента уже есть действующее проживание.", 409);
  if (legacy && (student.studentProfile.dormitory !== bed.room.floor.building.dormitory.name || !student.studentProfile.dormitoryRoom ||
    await db.dormPlacement.count({ where: { studentId, startedAt: { not: null } } }))) {
    throw new DormError("Для сверки нужна прежняя запись этого общежития без подтверждённой истории.", 409);
  }
  await expireReservations(c, studentId, bed.id);
  if (await db.dormPlacement.count({ where: { studentId, status: "RESERVED" } })) throw new DormError("У студента уже есть действующий резерв.", 409);
  const placement = await db.dormPlacement.create({ data: {
    studentId, bedId: bed.id, previousId: previous?.id, serviceRequestId: decision?.id,
    basis: legacy ? value(c, "basis", 500) : (decision?.resultText || "По согласованному заявлению"),
    status: legacy ? "ACTIVE" : "RESERVED", startedAt: legacy ? now : null,
    reservedUntil: legacy ? now : new Date(now.getTime() + int(c, "hours", 1, 720) * 3600000), endsOn,
  } });
  await c.audit(placement.id, bed.id);
  await dormNotice(c, placement.id, legacy ? "Проживание подтверждено после сверки" : "Для вас зарезервировано место", [studentId]);
  return placement.id;
}

async function changeInventory(c: DormContext) {
  const { db, now, input } = c;
  const id = value(c, "id", 128);
  const item = input.action === "ASSET_EDIT" ? await db.dormAsset.findUnique({ where: { id } }) : null;
  const room = await db.dormRoom.findUnique({ where: { id: item?.roomId ?? id }, include: dormLocation.include });
  if (!room || input.action === "ASSET_EDIT" && !item) throw new DormError("Имущество или комната недоступны.", 404);
  await requireGrant(c, roomDormitory(room), "HOUSING", "FUND");
  const data = { label: value(c, "label", 200), condition: value(c, "condition", 500) };
  const entry = item ? await db.dormAsset.update({ where: { id }, data: { ...data, archivedAt: flag(c, "archive") ? now : null } })
    : await db.dormAsset.create({ data: { ...data, roomId: room.id } });
  await c.audit(entry.id, JSON.stringify(data));
  return entry.id;
}

export async function changeDormHousing(c: DormContext) {
  const { db, user, now, input } = c;
  const action = input.action;
  if (action === "RESERVE" || action === "LEGACY_MATCH") return allocate(c);
  if (action === "ASSET" || action === "ASSET_EDIT") return changeInventory(c);
  const id = value(c, "id", 128);
  const loan = action === "RETURN" ? await db.dormLoan.findUnique({ where: { id } }) : null;
  const placement = await db.dormPlacement.findUnique({ where: { id: loan?.placementId ?? id }, include: { ...placementLocation, departure: true } });
  if (!placement || action === "RETURN" && !loan) throw new DormError("Запись проживания недоступна.", 404);
  if (action === "DEPART" && user.role === "STUDENT") {
    if (placement.studentId !== user.id) throw new DormError("Запись проживания недоступна.", 404);
  } else await requireGrant(c, roomDormitory(placement.bed.room), "HOUSING");

  if (action === "CHECK_IN" || action === "RESERVE_CANCEL") {
    if (placement.status !== "RESERVED") throw new DormError("Резерв уже обработан.", 409);
    if (action === "RESERVE_CANCEL") {
      const reason = value(c, "reason", 500);
      await db.dormPlacement.update({ where: { id }, data: { status: placement.reservedUntil <= now ? "EXPIRED" : "CANCELLED", endedAt: now } });
      await c.audit(id, reason);
      await dormNotice(c, id, "Резерв места снят", [placement.studentId]);
      return id;
    }
    if (placement.reservedUntil <= now || placement.endsOn && placement.endsOn < dormCalendarDay(now)) {
      throw new DormError("Срок резерва или проживания истёк.", 409);
    }
    if (!await db.dormBed.count({ where: { id: placement.bedId, ...openBed(now), placements: {
      none: { ...occupiedPlacement(now), id: { not: id } },
    } } })) throw new DormError("Место недоступно для заселения.", 409);
    const previous = await db.dormPlacement.findFirst({ where: currentPlacement(placement.studentId), include: { ...placementLocation, departure: true } });
    if ((previous?.id ?? null) !== placement.previousId) throw new DormError("Исходное проживание изменилось.", 409);
    if (!await db.user.count({ where: { id: placement.studentId, role: "STUDENT" } })) throw new DormError("Студент недоступен.", 409);
    if (previous) {
      await requireGrant(c, roomDormitory(previous.bed.room), "HOUSING");
      if (previous.departure || await db.dormLoan.count({ where: { placementId: previous.id, returnedAt: null } })) {
        throw new DormError("Завершите процедуру выезда или примите выданные ключи и имущество.", 409);
      }
      await db.dormPlacement.update({ where: { id: previous.id }, data: { status: "ENDED", endedAt: now } });
    }
    await db.dormPlacement.update({ where: { id }, data: { status: "ACTIVE", startedAt: now } });
    await c.audit(id, previous?.id);
    await dormNotice(c, id, previous ? "Переселение подтверждено" : "Заселение подтверждено", [placement.studentId]);
    return id;
  }
  if (placement.status !== "ACTIVE") throw new DormError("Проживание уже завершено.", 409);
  switch (action) {
    case "DEPART": {
      if (placement.departure) throw new DormError("Процедура выезда уже открыта.", 409);
      const plannedOn = date(c, "plannedOn")!;
      if (plannedOn < dormCalendarDay(now)) throw new DormError("Дата выезда уже прошла.");
      await db.dormDeparture.create({ data: { placementId: id, reason: value(c, "reason", 500), plannedOn } });
      await dormNotice(c, id, "Открыта процедура выезда", [placement.studentId]);
      break;
    }
    case "INSPECT":
      if (!placement.departure) throw new DormError("Сначала откройте процедуру выезда.", 409);
      await db.dormDeparture.update({ where: { placementId: id }, data: { inspectedAt: now, notes: value(c, "notes", 500, false) } });
      break;
    case "CHECK_OUT": {
      if (!placement.departure?.inspectedAt) throw new DormError("Сначала подтвердите проверку комнаты.", 409);
      if (await db.dormLoan.count({ where: { placementId: id, returnedAt: null } })) throw new DormError("Примите выданное имущество и ключи.", 409);
      const charges = await db.dormCharge.findMany({ where: { studentId: placement.studentId }, include: { entries: true } });
      const outstanding = charges.some(charge => chargeBalance(charge) > BigInt(0));
      if (outstanding && !flag(c, "ackDebt")) throw new DormError("Подтвердите ознакомление с оставшимися начислениями.", 409);
      await db.dormDeparture.update({ where: { placementId: id }, data: { completedAt: now } });
      await db.dormPlacement.update({ where: { id }, data: { status: "ENDED", endedAt: now } });
      const pending = await db.dormPlacement.findMany({ where: { previousId: id, status: "RESERVED" }, select: { id: true } });
      if (pending.length) {
        await db.dormPlacement.updateMany({ where: { previousId: id, status: "RESERVED" }, data: { status: "CANCELLED", endedAt: now } });
        await db.dormAudit.createMany({ data: pending.map(reserve => ({
          actorId: user.id, targetId: reserve.id, action: "RESERVE_CANCEL", detail: "Прежнее проживание завершено",
        })) });
      }
      await dormNotice(c, id, outstanding ? "Выезд подтверждён. Остались начисления" : "Выезд подтверждён", [placement.studentId]);
      break;
    }
    case "LOAN":
      if (placement.departure?.inspectedAt) throw new DormError("Комната уже принята при выезде.", 409);
      await db.dormLoan.create({ data: { placementId: id, label: value(c, "label", 200), isKey: flag(c, "isKey") } });
      break;
    case "RETURN":
      if (!loan || loan.returnedAt) throw new DormError("Имущество уже принято.", 409);
      await db.dormLoan.update({ where: { id }, data: { returnedAt: now, condition: value(c, "condition", 500) } });
      break;
    default: throw new DormError("Неизвестная операция.");
  }
  await c.audit(id, value(c, action === "DEPART" ? "reason" : action === "INSPECT" ? "notes" : action === "LOAN" ? "label" : "condition", 500, false) || undefined);
  return id;
}
