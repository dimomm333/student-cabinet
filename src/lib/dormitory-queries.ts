import "server-only";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { currentPlacement, dormDocumentScope, dormGrantScope, dormLocation, dormRepairScope, dormStaffRole, placementLocation, type DormDB, type DormUser } from "./dormitory-access.ts";
import { chargeBalance } from "./dormitory-money.ts";
import { dormCalendarDay, occupiedPlacement, openBed } from "./dormitory-state.ts";
import { DormError, dormitoryServiceCodes, openRepairStatuses } from "./dormitory-shared.ts";

export const dormPageSize = 12;
const pageRows = (page: number) => ({ take: dormPageSize + 1, skip: page * dormPageSize });
const ordered = [{ createdAt: "desc" }, { id: "desc" }] as const;
const entryInclude = { entries: { orderBy: { recordedAt: "desc" } }, placement: { include: placementLocation } } as const;
const staffName = { select: { id: true, name: true } } as const;
export const dormChargeSelect = { amountRub: true, entries: { select: { kind: true, amountRub: true } } } as const;
export type DormStudentPages = { history?: number; repairs?: number; repairHistory?: number; payments?: number; documents?: number };

export async function getOwnDormitory(db: PrismaClient, user: DormUser, pages: DormStudentPages = {}) {
  if (user.role !== "STUDENT") throw new DormError("Кабинет доступен студенту.", 403);
  return db.$transaction(async tx => {
    const now = new Date();
    const resident = await tx.dormPlacement.findFirst({
      where: currentPlacement(user.id), include: {
        ...placementLocation, departure: true, loans: { orderBy: { issuedAt: "desc" } },
        documents: { where: { archivedAt: null, kind: "CONTRACT" }, select: { id: true } },
      },
    });
    const reservations = await tx.dormPlacement.findFirst({
      where: { studentId: user.id, status: "RESERVED", reservedUntil: { gt: now } }, include: placementLocation,
    });
    const decisions = await tx.serviceRequest.findMany({
      where: { ownerId: user.id, serviceCode: { in: [...dormitoryServiceCodes] }, deletedAt: null },
      select: { id: true, serviceCode: true, status: true, resultText: true,
        dormPlacements: { where: { status: { in: ["ACTIVE", "ENDED"] } }, select: { id: true } } },
      orderBy: [...ordered], take: 8,
    });
    const history = await tx.dormPlacement.findMany({
      where: { studentId: user.id, startedAt: { not: null } }, include: placementLocation, orderBy: [...ordered], ...pageRows(pages.history ?? 0),
    });
    const repairWhere = dormRepairScope(user);
    const openWhere = { ...repairWhere, status: { in: [...openRepairStatuses] } };
    const repairs = await tx.dormRepair.findMany({
      where: openWhere, include: repairInclude(user), orderBy: [{ urgent: "desc" }, ...ordered], ...pageRows(pages.repairs ?? 0),
    });
    const completedRepairs = await tx.dormRepair.findMany({
      where: { ...repairWhere, status: { notIn: [...openRepairStatuses] } },
      include: repairInclude(user), orderBy: [...ordered], ...pageRows(pages.repairHistory ?? 0),
    });
    const activeRepairs = await tx.dormRepair.count({ where: openWhere });
    const formerRepairs = await tx.dormRepair.findMany({
      where: { authorId: user.id, NOT: repairWhere }, select: { id: true, title: true, createdAt: true }, orderBy: [...ordered], take: 8,
    });
    const payments = await tx.dormCharge.findMany({
      where: { studentId: user.id }, include: entryInclude, orderBy: [{ dueOn: "desc" }, { id: "desc" }], ...pageRows(pages.payments ?? 0),
    });
    const balances = await tx.dormCharge.findMany({
      where: { studentId: user.id }, select: { id: true, dueOn: true, ...dormChargeSelect, placement: { include: placementLocation } },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    });
    const today = dormCalendarDay(now);
    const unpaid = balances.map(charge => ({ ...charge, balance: chargeBalance(charge) })).filter(charge => charge.balance > BigInt(0));
    const next = unpaid.find(charge => charge.dueOn >= today) ?? unpaid[0];
    const overdue = unpaid.filter(charge => charge.dueOn < today);
    const documents = await tx.dormDocument.findMany({
      where: dormDocumentScope(user), include: { file: { select: { name: true, id: true } } },
      orderBy: [...ordered], ...pageRows(pages.documents ?? 0),
    });
    const lastDeparture = resident?.departure || (await tx.dormPlacement.findFirst({
      where: { studentId: user.id, departure: { isNot: null } }, select: { departure: true }, orderBy: [...ordered],
    }))?.departure;
    const clearance = await tx.clearanceProcess.findFirst({
      where: { studentId: user.id, openedAt: { not: null }, activeKey: { not: null } }, select: { id: true }, orderBy: [...ordered],
    });
    return { resident, reservations, decisions, history, repairs, completedRepairs, formerRepairs, activeRepairs, payments, hasCharges: balances.length > 0, next, overdue, documents, lastDeparture, clearance };
  });
}

export const dormTabs = {
  fund: "Жилой фонд", housing: "Размещение", repairs: "Ремонт", finance: "Начисления",
  documents: "Документы", grants: "Назначения", news: "Объявления",
} as const;
export type DormTab = keyof typeof dormTabs;

export function repairInclude(user: DormUser) {
  return {
    room: dormLocation, assignee: staffName,
    events: { where: user.role === "STUDENT" ? { staffOnly: false } : {}, orderBy: { createdAt: "desc" as const }, take: 50 },
    files: { select: { id: true, name: true } },
  };
}

export async function dormAnnouncementTargets(db: DormDB, user: DormUser) {
  return db.dormitory.findMany({
    where: { ...dormGrantScope(user, ["ANNOUNCEMENTS"]), archivedAt: null },
    select: { id: true, name: true, buildings: { where: { name: { not: "" } }, select: { id: true, name: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
}

export async function getDormStaffContext(db: PrismaClient, user: DormUser, dormitoryId: string, tab: DormTab, q: string, page: number, status: string, bedPage = 0) {
  if (!dormStaffRole(user.role)) throw new DormError("Доступ к управлению общежитиями не предоставлен.", 403);
  return db.$transaction(async tx => {
    const now = new Date();
    const dorms = await tx.dormitory.findMany({
      where: { grants: { some: { userId: user.id, active: true } } },
      include: { grants: { where: { userId: user.id, active: true }, select: { permission: true } } }, orderBy: { name: "asc" },
    });
    const dorm = dormitoryId ? dorms.find(item => item.id === dormitoryId) : dorms[0];
    const permissions = new Set(dorm?.grants.map(g => g.permission));
    if (!dorm) return { dorms, dorm, permissions };
    const dormId = dorm.id;
    const inDorm = { floor: { building: { dormitoryId: dormId } } };
    const buildingScope = { ...inDorm, ...(q ? { number: { contains: q } } : {}) };
    const fundFilter = status === "free" ? { beds: { some: openBed(now) } }
      : status === "occupied" ? { beds: { some: { placements: { some: { status: "ACTIVE" as const } } } } }
        : status === "reserved" ? { beds: { some: { placements: { some: { status: "RESERVED" as const, reservedUntil: { gt: now } } } } } }
          : status === "unavailable" ? { OR: [{ available: false }, { beds: { some: { available: false } } }] } : {};
    const fund = tab === "fund" && (permissions.has("FUND") || permissions.has("HOUSING")) ? await tx.dormRoom.findMany({
      where: { ...buildingScope, ...fundFilter }, include: { ...dormLocation.include, inventory: { orderBy: { label: "asc" } }, beds: {
        include: { placements: { where: occupiedPlacement(now), select: { status: true } } }, orderBy: { number: "asc" },
      } }, orderBy: [{ number: "asc" }, { id: "asc" }], ...pageRows(page),
    }) : undefined;
    const placementSearch = q ? { OR: [{ student: { name: { contains: q } } }, { bed: { room: { number: { contains: q } } } }] } : {};
    const housingTab = tab === "housing" && permissions.has("HOUSING");
    const selectedStatus = status === "reserved" ? ["RESERVED"] as const : status === "history" ? ["ENDED", "EXPIRED", "CANCELLED"] as const
      : status === "active" ? ["ACTIVE"] as const : ["ACTIVE", "RESERVED"] as const;
    const placements = housingTab ? await tx.dormPlacement.findMany({
      where: { bed: { room: inDorm }, ...placementSearch, status: { in: [...selectedStatus] } },
      include: { ...placementLocation, student: staffName, departure: true, loans: { orderBy: { issuedAt: "desc" } } },
      orderBy: [...ordered], ...pageRows(page),
    }) : undefined;
    const approved = housingTab ? await tx.serviceRequest.findMany({
      where: {
        serviceCode: { in: [...dormitoryServiceCodes] }, deletedAt: null, status: "COMPLETED", submittedAt: { not: null }, completedAt: { not: null },
        dormPlacements: { none: { OR: [{ status: { in: ["ACTIVE", "ENDED"] } }, { status: "RESERVED", reservedUntil: { gt: now } }] } },
        owner: { role: "STUDENT", ...(q ? { name: { contains: q } } : {}) },
        OR: [
          { serviceCode: "dorm-move-in", owner: { dormPlacements: { none: { status: "ACTIVE" } } } },
          { serviceCode: "dorm-transfer", owner: { dormPlacements: { some: {
            status: "ACTIVE", bed: { room: { floor: { building: { dormitory: dormGrantScope(user, ["HOUSING"]) } } } },
          } } } },
        ],
      }, select: { id: true, serviceCode: true, owner: staffName, fieldsJson: true, completedAt: true },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }], ...pageRows(page),
    }) : undefined;
    const beds = housingTab ? await tx.dormBed.findMany({
      where: { AND: [openBed(now), { room: inDorm }] },
      include: { room: dormLocation }, orderBy: [{ room: { number: "asc" } }, { number: "asc" }, { id: "asc" }], ...pageRows(bedPage),
    }) : undefined;
    const legacy = housingTab && q.length >= 2 ? await tx.user.findMany({
      where: { role: "STUDENT", name: { contains: q }, studentProfile: { dormitory: dorm.name, dormitoryRoom: { not: null } },
        dormPlacements: { none: { startedAt: { not: null } } } },
      select: { id: true, name: true, studentProfile: { select: { dormitory: true, dormitoryRoom: true } } }, ...pageRows(page), orderBy: { id: "asc" },
    }) : [];
    const repairs = tab === "repairs" ? await tx.dormRepair.findMany({
      where: { AND: [dormRepairScope(user), { room: inDorm }], ...(q ? { OR: [{ title: { contains: q } }, { room: { number: { contains: q } } }] } : {}),
        ...(status === "closed" ? { status: { notIn: [...openRepairStatuses] } } : { status: { in: [...openRepairStatuses] } }) },
      include: repairInclude(user), orderBy: [{ urgent: "desc" }, ...ordered], ...pageRows(page),
    }) : undefined;
    const technicians = tab === "repairs" && permissions.has("REPAIR") ? await tx.user.findMany({
      where: { role: { in: ["ADMIN", "TECHNICAL_STAFF"] }, dormGrants: { some: { dormitoryId: dormId, active: true, permission: "TECHNICIAN" } } },
      select: { id: true, name: true }, orderBy: { name: "asc" },
    }) : [];
    const finance = tab === "finance" && permissions.has("FINANCE");
    const charges = finance ? await tx.dormCharge.findMany({
      where: { placement: { bed: { room: inDorm } }, ...(q ? { OR: [{ basis: { contains: q } }, { student: { name: { contains: q } } }] } : {}) },
      include: { ...entryInclude, student: staffName }, orderBy: [...ordered], ...pageRows(page),
    }) : undefined;
    const docAccess = tab === "documents" && permissions.has("DOCUMENTS");
    const recordPlacements = finance || docAccess ? await tx.dormPlacement.findMany({
      where: { bed: { room: inDorm }, status: { in: ["ACTIVE", "ENDED"] }, ...placementSearch },
      include: { ...placementLocation, student: staffName }, orderBy: [...ordered], ...pageRows(page),
    }) : undefined;
    const documents = docAccess ? await tx.dormDocument.findMany({
      where: { dormitoryId: dormId, ...(q ? { title: { contains: q } } : {}) }, include: { file: { select: { id: true, name: true } }, owner: staffName },
      orderBy: [...ordered], ...pageRows(page),
    }) : undefined;
    const grants = tab === "grants" && permissions.has("GRANTS") ? await tx.dormGrant.findMany({
      where: { dormitoryId: dormId, ...(q ? { user: { OR: [{ name: { contains: q } }, { email: { contains: q } }] } } : {}) },
      include: { user: { select: { id: true, name: true, email: true, role: true } } }, orderBy: [{ userId: "asc" }, { permission: "asc" }], ...pageRows(page),
    }) : undefined;
    const targets = tab === "news" ? await dormAnnouncementTargets(tx, user) : [];
    const auditIds = [
      ...(fund ? [dorm.id, ...fund.slice(0, dormPageSize).flatMap(room => [room.id, ...room.beds.map(bed => bed.id), ...room.inventory.map(asset => asset.id)])] : []),
      ...(placements?.slice(0, dormPageSize).flatMap(placement => [placement.id, ...placement.loans.map(loan => loan.id)]) ?? []),
    ];
    const audit = auditIds.length ? await tx.dormAudit.findMany({
      where: { targetId: { in: auditIds }, ...(tab === "fund" ? { action: { not: "GRANT" } } : {}) },
      select: { id: true, targetId: true, action: true, createdAt: true, actor: { select: { name: true } } },
      orderBy: [...ordered], take: 50,
    }) : [];
    return { dorms, dorm, permissions, fund, placements, approved, beds, legacy, repairs, technicians, charges, recordPlacements, documents, grants, targets, audit };
  });
}
