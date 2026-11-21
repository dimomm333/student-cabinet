import "server-only";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { digest } from "./services-storage.ts";
import { dormActions, DormError, type DormAction } from "./dormitory-shared.ts";
import { changeDormFund } from "./dormitory-fund.ts";
import { changeDormHousing } from "./dormitory-housing.ts";
import { changeDormRepair } from "./dormitory-repairs.ts";
import { changeDormRecords } from "./dormitory-records.ts";
import { dormActor, type DormActor } from "./dormitory-access.ts";
import type { DormContext, DormCommandInput } from "./dormitory-context.ts";
const fundActions = new Set<DormAction>(["DORM_CREATE", "DORM_EDIT", "GRANT", "ROOM_CREATE", "ROOM_STATE", "BED_STATE"]);
const housingActions = new Set<DormAction>(["RESERVE", "RESERVE_CANCEL", "CHECK_IN", "LEGACY_MATCH", "DEPART", "INSPECT", "CHECK_OUT", "LOAN", "RETURN", "ASSET", "ASSET_EDIT"]);

export async function executeDormCommand(db: PrismaClient, actor: DormActor, input: DormCommandInput) {
  if (!Object.hasOwn(dormActions, input.action) || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.key)) throw new DormError("Некорректная операция.");
  if (Object.keys(input.fields).length > 30 || Object.values(input.fields).some(s => typeof s !== "string" || s.length > 5000)) {
    throw new DormError("Слишком много данных.");
  }
  const { file } = input;
  const hash = digest(JSON.stringify([input.action, Object.entries(input.fields).sort(), file && [file.name, file.mime, file.sha256]]));
  try {
    return await db.$transaction(async tx => {
      await tx.dormWriteState.upsert({ where: { id: "dormitory" }, create: { id: "dormitory", version: 1 }, update: { version: { increment: 1 } } });
      const user = await dormActor(tx, actor);
      const old = await tx.dormAudit.findUnique({ where: { actorId_requestKey: { actorId: user.id, requestKey: input.key } } });
      if (old) {
        if (old.commandHash !== hash) throw new DormError("Запрос уже использован с другими данными.", 409);
        return { replayed: true, id: old.targetId };
      }
      const context: DormContext = {
        db: tx, user, input, now: new Date(),
        audit: (targetId, detail) => tx.dormAudit.create({
          data: { actorId: user.id, requestKey: input.key, commandHash: hash, targetId, action: input.action, detail },
          select: { id: true },
        }),
      };
      const id = fundActions.has(input.action) ? await changeDormFund(context)
        : housingActions.has(input.action) ? await changeDormHousing(context)
        : input.action.startsWith("REPAIR_") ? await changeDormRepair(context)
        : await changeDormRecords(context);
      return { id, replayed: false };
    }, { timeout: 20000, maxWait: 20000 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["P2002", "P2028", "P2034", "SQLITE_BUSY", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(error.code))) {
      throw new DormError("Данные изменились или запись уже существует. Обновите страницу.", 409);
    }
    throw error;
  }
}
