import type { Prisma } from "../generated/prisma/client.ts";

export const dormCalendarDay = (now: Date) => new Date(now.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" }) + "T00:00:00.000Z");

export const occupiedPlacement = (now: Date): Prisma.DormPlacementWhereInput => ({
  OR: [{ status: "ACTIVE" }, { status: "RESERVED", reservedUntil: { gt: now } }],
});

export const openBed = (now: Date): Prisma.DormBedWhereInput => ({
  available: true, archivedAt: null,
  placements: { none: occupiedPlacement(now) },
  room: { available: true, archivedAt: null, floor: { building: { dormitory: { archivedAt: null } } } },
});
