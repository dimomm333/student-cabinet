import { dormStaffRole, roomDormitory } from "./dormitory-access.ts";
import { choice, flag, int, requireGrant, value, type DormContext } from "./dormitory-context.ts";
import { DormError, dormPermissions, paymentLink } from "./dormitory-shared.ts";
import type { DormPermission } from "../generated/prisma/client.ts";

export async function changeDormFund(c: DormContext) {
  const { db, user, input, now } = c;
  if (input.action === "DORM_CREATE") {
    if (user.role !== "ADMIN") throw new DormError("Создание доступно администратору.", 403);
    const dorm = await db.dormitory.create({ data: {
      name: value(c, "name", 150), address: value(c, "address", 300), contacts: value(c, "contacts", 500, false),
      grants: { create: (Object.keys(dormPermissions) as DormPermission[]).filter(permission => permission !== "TECHNICIAN").map(permission => ({ userId: user.id, permission })) },
    } });
    await c.audit(dorm.id, dorm.name);
    return dorm.id;
  }
  if (input.action === "GRANT" || input.action === "DORM_EDIT" || input.action === "ROOM_CREATE") {
    const dormitoryId = value(c, "dormitoryId", 128);
    if (input.action === "GRANT") {
      await requireGrant(c, dormitoryId, "GRANTS");
      const userId = value(c, "userId", 254);
      const target = await db.user.findFirst({ where: { OR: [{ id: userId }, { email: userId.toLowerCase() }] } });
      const permission = choice(c, "permission", Object.keys(dormPermissions) as DormPermission[]);
      const active = choice(c, "state", ["enable", "revoke"]) === "enable";
      if (!target || !dormStaffRole(target.role)) throw new DormError("Учётная запись сотрудника недоступна.");
      const existing = await db.dormGrant.findUnique({ where: { dormitoryId_userId_permission: { dormitoryId, userId: target.id, permission } } });
      if (!active && !existing?.active) throw new DormError("Действующего назначения нет.", 409);
      if (!active && permission === "GRANTS" && !await db.dormGrant.count({ where: {
        dormitoryId, permission: "GRANTS", active: true, userId: { not: target.id }, user: { role: "ADMIN" },
      } })) throw new DormError("Сохраните хотя бы одного администратора с правом назначений.", 409);
      await db.dormGrant.upsert({
        where: { dormitoryId_userId_permission: { dormitoryId, userId: target.id, permission } },
        create: { dormitoryId, userId: target.id, permission, active }, update: { active },
      });
      await c.audit(dormitoryId, [target.id, permission, active].join(" "));
      return dormitoryId;
    }
    if (input.action === "DORM_EDIT") {
      const editPayment = input.fields.paymentUrl !== undefined;
      if (editPayment) await requireGrant(c, dormitoryId, "FINANCE");
      else await requireGrant(c, dormitoryId, "FUND");
      const data = editPayment ? { paymentUrl: paymentLink(value(c, "paymentUrl", 1000, false)) }
        : { name: value(c, "name", 150), address: value(c, "address", 300), contacts: value(c, "contacts", 500, false) };
      await db.dormitory.update({ where: { id: dormitoryId }, data });
      await c.audit(dormitoryId, editPayment ? "Платёжная ссылка изменена" : JSON.stringify(data));
      return dormitoryId;
    }
    await requireGrant(c, dormitoryId, "FUND");
    const dorm = await db.dormitory.findUniqueOrThrow({ where: { id: dormitoryId } });
    if (dorm.archivedAt) throw new DormError("Общежитие архивировано.", 409);
    const name = value(c, "building", 100, false);
    const building = await db.dormBuilding.upsert({ where: { dormitoryId_name: { dormitoryId, name } }, create: { dormitoryId, name }, update: {} });
    const buildingId = building.id, number = int(c, "floor", -5, 150);
    const floor = await db.dormFloor.upsert({ where: { buildingId_number: { buildingId, number } }, create: { buildingId, number }, update: {} });
    const blockName = value(c, "block", 100, false), floorId = floor.id;
    const block = blockName ? await db.dormBlock.upsert({
      where: { floorId_name: { floorId, name: blockName } }, create: { floorId, name: blockName }, update: {},
    }) : null;
    const capacity = int(c, "capacity", 1, 30);
    const room = await db.dormRoom.create({ data: {
      floorId, blockId: block?.id, capacity, number: value(c, "number", 40),
      type: value(c, "type", 100), notes: value(c, "notes", 500, false) || null, available: !flag(c, "unavailable"),
      beds: { create: Array.from({ length: capacity }, (_, index) => ({ number: index + 1 })) },
    } });
    await c.audit(room.id, JSON.stringify({ dormitoryId, building: name, floor: number, block: blockName, number: room.number, capacity }));
    return room.id;
  }
  const id = value(c, "id", 128);
  const bed = input.action === "BED_STATE" ? await db.dormBed.findUnique({ where: { id } }) : null;
  const room = await db.dormRoom.findUnique({ where: { id: bed?.roomId ?? id }, include: { floor: { include: { building: true } } } });
  if (!room || input.action === "BED_STATE" && !bed) throw new DormError("Запись недоступна.", 404);
  await requireGrant(c, roomDormitory(room), "FUND");
  const state = choice(c, "state", ["open", "unavailable", "archive"]);
  const live = await db.dormPlacement.count({ where: {
    bed: { roomId: room.id, ...(bed ? { id: bed.id } : {}) },
    OR: [{ status: "ACTIVE" }, { status: "RESERVED", reservedUntil: { gt: now } }],
  } });
  if (live && (state === "archive" || state === "unavailable" && bed)) throw new DormError("Сначала завершите проживание или отмените резерв.", 409);
  if (state === "archive" && !bed && await db.dormRepair.count({ where: {
    roomId: room.id, status: { notIn: ["CLOSED", "REJECTED", "CANCELLED", "MERGED"] },
  } })) throw new DormError("Сначала завершите ремонтные заявки комнаты.", 409);
  const data = { available: state === "open", archivedAt: state === "archive" ? now : null };
  if (bed) await db.dormBed.update({ where: { id }, data });
  else await db.dormRoom.update({ where: { id }, data });
  await c.audit(id, state);
  return id;
}
