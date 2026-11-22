import "server-only";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { DeaneryAccessDenied, deaneryGroupWhere, getDeaneryContext, type DeaneryActor } from "./deanery-repository.ts";
import { currentAcademicDate, isoDate, parseCalendarDate } from "./schedule-calendar.ts";
import { effectiveSchedule, loadScheduleRecords } from "./schedule-effective.ts";

const select = {
  id: true, version: true, date: true, startMinute: true, endMinute: true, cancelledAt: true,
  teacherId: true, teacher: { select: { user: { select: { name: true } } } },
  disciplineId: true, discipline: { select: { title: true } },
  roomId: true, room: { select: { number: true, building: { select: { id: true, name: true } } } },
} satisfies Prisma.ConsultationSelect;
const orderBy = [{ date: "asc" }, { startMinute: "asc" }, { id: "asc" }] satisfies Prisma.ConsultationOrderByWithRelationInput[];
const groupSelect = { id: true, code: true } as const;
const teacherSelect = { userId: true, user: { select: { name: true } } } as const;
const disciplineSelect = { id: true, title: true } as const;

type ConsultationRecord = Prisma.ConsultationGetPayload<{ select: typeof select }> & {
  groups: { group: { code: string } }[];
};

function project(row: ConsultationRecord) {
  return {
    id: row.id, version: row.version, date: isoDate(row.date), startMinute: row.startMinute, endMinute: row.endMinute,
    cancelled: row.cancelledAt !== null, teacherId: row.teacherId, teacher: row.teacher.user.name,
    disciplineId: row.disciplineId, discipline: row.discipline.title,
    roomId: row.roomId, room: row.room.number, buildingId: row.room.building.id, building: row.room.building.name,
    groupCodes: row.groups.map(target => target.group.code),
  };
}
export type ConsultationRow = ReturnType<typeof project>;

export function getConsultationClock(now = new Date()) {
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const [hour, minute] = clock.format(now).split(":").map(Number);
  return { today: isoDate(currentAcademicDate(now)), minute: hour * 60 + minute };
}

export async function getPersonalConsultations(db: PrismaClient, actor: DeaneryActor) {
  let where: Prisma.ConsultationWhereInput;
  let groupWhere: Prisma.ConsultationGroupWhereInput | undefined;
  if (actor.role === "STUDENT") {
    // Joint consultations expose only the student's own group in the card.
    groupWhere = { group: { students: { some: { userId: actor.id, user: { role: "STUDENT" } } } } };
    where = { groups: { some: groupWhere } };
  } else if (actor.role === "TEACHER") {
    where = { teacherId: actor.id, teacher: { user: { role: "TEACHER" } } };
  } else {
    throw new DeaneryAccessDenied();
  }
  return (await db.consultation.findMany({ where, orderBy, select: {
    ...select, groups: {
      where: groupWhere, select: { group: { select: { code: true } } }, orderBy: { group: { code: "asc" } },
    },
  } })).map(project);
}

function scopedConsultations(actor: DeaneryActor): Prisma.ConsultationWhereInput {
  return { groups: { some: {}, every: { group: deaneryGroupWhere(actor) } } };
}

const activeAssignment = { isActive: true } satisfies Prisma.TeachingAssignmentWhereInput;
const scheduledLesson = { OR: [
  { entries: { some: { isPublished: true, isDeleted: false, term: { isPublished: true } } } },
  { exceptions: { some: { isPublished: true, isActive: true, isCancelled: false, term: { isPublished: true } } } },
] } satisfies Prisma.LessonWhereInput;

export async function getDeaneryConsultations(db: PrismaClient, actor: DeaneryActor) {
  const { departments } = await getDeaneryContext(db, actor);
  const empty = { rows: [], groups: [], teachers: [], disciplines: [], buildings: [] };
  if (!departments.length) return { ...empty, hasAssignments: false };
  const groupScope = deaneryGroupWhere(actor);
  const lessonScope = { ...scheduledLesson, groups: { some: { group: groupScope } } };
  const assignmentScope = { ...activeAssignment, group: groupScope };
  const [rows, groups, teachers, disciplines, buildings] = await Promise.all([
    db.consultation.findMany({ where: scopedConsultations(actor), orderBy, select: {
      ...select, groups: { select: { group: { select: groupSelect } }, orderBy: { group: { code: "asc" } } },
    } }),
    db.studyGroup.findMany({ where: groupScope, select: groupSelect, orderBy: { code: "asc" } }),
    db.teacherProfile.findMany({ where: {
      user: { role: "TEACHER" }, OR: [
        { user: { teachingAssignments: { some: assignmentScope } } },
        { lessons: { some: { lesson: lessonScope } } },
      ],
    }, select: teacherSelect, orderBy: { user: { name: "asc" } } }),
    db.discipline.findMany({ where: { OR: [
      { teachingAssignments: { some: { ...assignmentScope, teacher: { role: "TEACHER", teacherProfile: { isNot: null } } } } },
      { lessons: { some: { ...lessonScope, teachers: { some: { teacher: { user: { role: "TEACHER" } } } } } } },
    ] }, select: disciplineSelect, orderBy: { title: "asc" } }),
    db.building.findMany({ where: { rooms: { some: {} } }, select: {
      id: true, name: true, rooms: { select: { id: true, number: true }, orderBy: { number: "asc" } },
    }, orderBy: { name: "asc" } }),
  ]);
  return { hasAssignments: true, groups, teachers, disciplines, buildings,
    rows: rows.map(row => ({ ...project(row), groups: row.groups.map(target => target.group) })),
  };
}
export type ConsultationEditorModel = Awaited<ReturnType<typeof getDeaneryConsultations>>;

export class ConsultationError extends Error {}
function fail(message: string): never { throw new ConsultationError(message); }

type ConsultationCommand = {
  operation: string; id: string; version: number;
  teacherId: string; disciplineId: string; buildingId: string; roomId: string; groupIds: string[];
  date: string; start: string; end: string;
};

function minutes(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail("Укажите время в формате ЧЧ:ММ.");
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

async function checkConflicts(tx: Prisma.TransactionClient, data: {
  date: Date; startMinute: number; endMinute: number; teacherId: string; roomId: string;
}, excludeId?: string) {
  const { date, startMinute, endMinute, teacherId, roomId } = data;
  const overlap = {
    date, cancelledAt: null, id: { not: excludeId },
    startMinute: { lt: endMinute }, endMinute: { gt: startMinute },
  } satisfies Prisma.ConsultationWhereInput;
  const [teacherConflict, roomConflict, records] = await Promise.all([
    tx.consultation.findFirst({ where: { ...overlap, teacherId }, select: { id: true } }),
    tx.consultation.findFirst({ where: { ...overlap, roomId }, select: { id: true } }),
    loadScheduleRecords(tx),
  ]);
  const pairs = effectiveSchedule(records, date, date).filter(({ record, cancelled }) =>
    !cancelled && record.startMinute < endMinute && record.endMinute > startMinute);
  if (teacherConflict || pairs.some(({ record }) => record.lesson.teachers.some(teacher => teacher.teacherId === teacherId))) {
    fail("Преподаватель занят в выбранное время.");
  }
  if (roomConflict || pairs.some(({ record }) => record.roomId === roomId)) fail("Аудитория занята в выбранное время.");
}

export async function executeConsultationCommand(db: PrismaClient, actor: DeaneryActor, command: ConsultationCommand) {
  if (actor.role !== "DEANERY_STAFF") throw new DeaneryAccessDenied();
  const { operation, id, version } = command;
  if (!["create", "update", "cancel"].includes(operation) || (operation === "create" ? id : !id || !Number.isSafeInteger(version) || version < 1)) {
    fail("Некорректная операция.");
  }
  try {
    return await db.$transaction(async tx => {
      // Share the timetable writer lock so validation cannot race with a pair edit.
      await tx.scheduleWriteState.upsert({ where: { id: "schedule" }, create: { id: "schedule" }, update: { revision: { increment: 0 } } });
      const { departments } = await getDeaneryContext(tx, actor);
      if (!departments.length) throw new DeaneryAccessDenied();
      if (operation !== "create") {
        const current = await tx.consultation.findFirst({ where: { id, ...scopedConsultations(actor) }, select: { version: true, cancelledAt: true } });
        if (!current) throw new DeaneryAccessDenied();
        if (current.cancelledAt || current.version !== version) fail("Консультация уже изменена или отменена. Обновите страницу.");
        if (operation === "cancel") {
          return tx.consultation.update({ where: { id }, data: { cancelledAt: new Date(), version: { increment: 1 } }, select: { id: true } });
        }
      }

      const { teacherId, disciplineId, roomId, buildingId } = command;
      const date = parseCalendarDate(command.date);
      if (!date) fail("Укажите существующую дату консультации.");
      const startMinute = minutes(command.start), endMinute = minutes(command.end);
      if (endMinute <= startMinute) fail("Окончание консультации должно быть позже начала.");
      const groupIds = [...new Set(command.groupIds)];
      if (!groupIds.length || groupIds.length > 100 || groupIds.some(groupId => !groupId)) fail("Выберите от 1 до 100 учебных групп.");
      const groupScope = { id: { in: groupIds }, ...deaneryGroupWhere(actor) };
      if (await tx.studyGroup.count({ where: groupScope }) !== groupIds.length) throw new DeaneryAccessDenied();
      const [teacher, room, eligibleCount] = await Promise.all([
        tx.teacherProfile.findFirst({ where: { userId: teacherId, user: { role: "TEACHER" } }, select: { userId: true } }),
        tx.room.findFirst({ where: { id: roomId, buildingId }, select: { id: true } }),
        tx.studyGroup.count({ where: { ...groupScope, OR: [
          { teachingAssignments: { some: { ...activeAssignment, teacherId, disciplineId } } },
          { lessons: { some: { lesson: { ...scheduledLesson, disciplineId, teachers: { some: { teacherId } } } } } },
        ] } }),
      ]);
      if (!room) fail("Выберите аудиторию в указанном корпусе.");
      if (!teacher || eligibleCount !== groupIds.length) fail("Для каждой группы нужна связь преподавателя и дисциплины через учебное назначение или расписание.");
      const data = { teacherId, disciplineId, roomId, date, startMinute, endMinute };
      await checkConflicts(tx, data, id || undefined);
      const create = groupIds.map(groupId => ({ groupId }));
      if (operation === "create") return tx.consultation.create({ data: { ...data, groups: { create } }, select: { id: true } });
      return tx.consultation.update({
        where: { id }, data: { ...data, version: { increment: 1 }, groups: { deleteMany: {}, create } }, select: { id: true },
      });
    }, { timeout: 20000, maxWait: 10000 });
  } catch (error) {
    if (error instanceof Error && "code" in error && ["P2034", "P1008", "P2028"].includes(String(error.code))) {
      fail("Расписание меняется другим сотрудником. Обновите страницу и повторите попытку.");
    }
    throw error;
  }
}
