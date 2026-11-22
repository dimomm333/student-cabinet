import "server-only";
import type { Prisma } from "../generated/prisma/client.ts";
import { currentAcademicDate, isoDate, minuteLabel } from "./schedule-calendar.ts";
import type { EffectivePair, ExceptionPair, RegularPair } from "./schedule-effective.ts";

type Tx = Prisma.TransactionClient;
type Slot = { date: Date; record: Pick<RegularPair, "startMinute" | "term"> };
type Interval = { startsAt: Date | null; endsAt: Date | null };

export function compareSlot(date: Date, minute: number, zone: string, instant: Date) {
  const localDate = isoDate(currentAcademicDate(instant, zone));
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(instant);
  return (isoDate(date) + "T" + minuteLabel(minute) + ":00").localeCompare(localDate + "T" + localTime);
}

export function inMembership(pair: Slot, member: Interval) {
  const { startMinute, term } = pair.record;
  return (!member.startsAt || compareSlot(pair.date, startMinute, term.timeZone, member.startsAt) >= 0)
    && (!member.endsAt || compareSlot(pair.date, startMinute, term.timeZone, member.endsAt) < 0);
}

export function occurrenceKey(pair: EffectivePair) {
  return pair.entryId ? `entry:${pair.entryId}:${isoDate(pair.sourceDate)}` : `extra:${pair.exceptionId}`;
}

export async function physicalAudience(db: Tx, studentId: string) {
  const [memberships, booked] = await Promise.all([
    db.peMembership.findMany({
      where: { enrollment: { studentId } },
      select: { startsAt: true, endsAt: true, group: { select: { plan: { select: { groupId: true, termId: true, disciplineId: true } } } } },
    }),
    db.peBooking.findMany({
      where: { studentId, cancelledAt: null },
      select: { makeup: { select: { exceptionId: true } } },
    }),
  ]);
  const makeupIds = new Set(booked.map(row => row.makeup.exceptionId));
  function belongs(record: RegularPair | ExceptionPair, plan: typeof memberships[number]["group"]["plan"]) {
    return record.termId === plan.termId && record.lesson.disciplineId === plan.disciplineId
      && record.lesson.groups.some(link => link.groupId === plan.groupId);
  }
  return {
    matchesRecord: (record: RegularPair | ExceptionPair) => makeupIds.has(record.id)
      || memberships.some(({ group: { plan } }) => belongs(record, plan)),
    matchesPair: (pair: EffectivePair) => "physicalMakeup" in pair.record && pair.record.physicalMakeup
      ? makeupIds.has(pair.record.id)
      : memberships.some(member => belongs(pair.record, member.group.plan) && inMembership(pair, member)),
  };
}
