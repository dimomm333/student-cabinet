import type { DormDocumentKind } from "../generated/prisma/client.ts";
import { placementLocation, roomDormitory } from "./dormitory-access.ts";
import { choice, date, dormNotice, requireGrant, value, type DormContext } from "./dormitory-context.ts";
import { chargeBalance, encodeRubles, maxDormAmount, parseRubles } from "./dormitory-money.ts";
import { DormError, documentKinds } from "./dormitory-shared.ts";

export async function changeDormRecords(c: DormContext) {
  const { db, now, input } = c;
  if (input.action === "DOCUMENT_ARCHIVE") {
    const id = value(c, "id", 128);
    const doc = await db.dormDocument.findUnique({ where: { id } });
    if (!doc) throw new DormError("Документ недоступен.", 404);
    await requireGrant(c, doc.dormitoryId, "DOCUMENTS");
    await db.dormDocument.update({ where: { id }, data: { archivedAt: now } });
    await c.audit(id, doc.kind);
    return id;
  }
  if (input.action === "DOCUMENT") {
    const dormitoryId = value(c, "dormitoryId", 128);
    await requireGrant(c, dormitoryId, "DOCUMENTS");
    const file = input.file;
    if (!file) throw new DormError("Выберите файл.");
    const kind = choice(c, "kind", Object.keys(documentKinds) as DormDocumentKind[]);
    const placementId = value(c, "placementId", 128, false);
    const placement = placementId ? await db.dormPlacement.findFirst({
      where: { id: placementId, status: { in: ["ACTIVE", "ENDED"] }, bed: { room: { floor: { building: { dormitoryId } } } } },
    }) : null;
    if (placementId && !placement || !placement && ["CONTRACT", "RECEIPT"].includes(kind)) throw new DormError("Выберите подтверждённое проживание для персонального документа.");
    const title = value(c, "title", 200);
    const identical = await db.dormDocument.count({ where: {
      dormitoryId, ownerId: placement?.studentId ?? null, kind, archivedAt: null, file: { sha256: file.sha256 },
    } });
    if (identical) throw new DormError("Этот документ уже загружен.", 409);
    const doc = await db.dormDocument.create({ data: {
      dormitory: { connect: { id: dormitoryId } },
      ...(placement ? { placement: { connect: { id: placement.id } }, owner: { connect: { id: placement.studentId } } } : {}),
      kind, title, file: { create: file },
    } });
    await c.audit(doc.id, kind);
    return doc.id;
  }
  if (input.action === "CHARGE") {
    const id = value(c, "id", 128);
    const placement = await db.dormPlacement.findFirst({ where: { id, status: { in: ["ACTIVE", "ENDED"] } }, include: placementLocation });
    if (!placement) throw new DormError("Проживание недоступно.", 404);
    await requireGrant(c, roomDormitory(placement.bed.room), "FINANCE");
    const periodFrom = date(c, "from")!, periodTo = date(c, "to")!, dueOn = date(c, "dueOn")!;
    if (periodFrom > periodTo) throw new DormError("Проверьте период начисления.");
    const amount = parseRubles(value(c, "amountRub", 12));
    if (amount <= BigInt(0)) throw new DormError("Начисление должно быть больше нуля.");
    const charge = await db.dormCharge.create({ data: {
      placementId: id, studentId: placement.studentId, basis: value(c, "basis", 300),
      periodFrom, periodTo, dueOn, amountRub: encodeRubles(amount),
    } });
    await c.audit(charge.id, charge.basis);
    await dormNotice(c, charge.id, "Появилось начисление за проживание", [placement.studentId]);
    return charge.id;
  }
  if (input.action === "LEDGER") {
    const id = value(c, "id", 128);
    const charge = await db.dormCharge.findUnique({ where: { id }, include: { placement: { include: placementLocation }, entries: true } });
    if (!charge) throw new DormError("Начисление недоступно.", 404);
    await requireGrant(c, roomDormitory(charge.placement.bed.room), "FINANCE");
    const kind = choice(c, "kind", ["PAYMENT", "ADJUSTMENT"]);
    const amount = parseRubles(value(c, "amountRub", 12));
    if (kind === "PAYMENT" && amount <= BigInt(0)) throw new DormError("Платёж должен быть больше нуля.");
    if (amount === BigInt(0)) throw new DormError("Сумма должна отличаться от нуля.");
    const total = chargeBalance(charge) + (kind === "PAYMENT" ? -amount : amount);
    if (total < -maxDormAmount || total > maxDormAmount) throw new DormError("Итоговая сумма выходит за допустимый диапазон.");
    const reference = value(c, "reference", 300);
    const audit = await c.audit(id, kind);
    await db.dormLedgerEntry.create({ data: { chargeId: id, auditId: audit.id, kind, amountRub: encodeRubles(amount), reference } });
    await dormNotice(c, id, kind === "PAYMENT" ? "Оплата проживания подтверждена" : "Начисление за проживание скорректировано", [charge.studentId]);
    return id;
  }
  throw new DormError("Неизвестная операция.");
}
