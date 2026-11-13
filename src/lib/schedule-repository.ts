import "server-only";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { DAY_MS, dayNames, isoDate, minuteLabel, filterScheduleChoices, weekParity, type ScheduleQuery } from "./schedule-calendar.ts";

export type PublicChoice = { slug: string; name: string };
export type GroupChoice = PublicChoice & { programme: string; faculty: string | null; department: string | null; parentSlug: string | null };
export type PublicLesson = { key: string; date: string; start: string; end: string; discipline: string; kind: string; weekPattern: string; teachers: PublicChoice[]; groups: PublicChoice[]; room: string; building: string; timeZone: string };

const publishedEntry = {
  isPublished: true,
  term: { isPublished: true },
  room: { isPublic: true, building: { isPublic: true } },
  lesson: {
    groups: { some: {}, every: { group: { isPublic: true } } },
    teachers: { some: {}, every: { teacher: { isSchedulePublic: true, scheduleSlug: { not: null }, publicName: { not: null } } } },
  },
} satisfies Prisma.ScheduleEntryWhereInput;

const kindNames = { LECTURE: "Лекция", PRACTICE: "Практика", SEMINAR: "Семинар", LAB: "Лабораторная" };
const patternNames = { EVERY: "Каждую неделю", NUMERATOR: "Числитель", DENOMINATOR: "Знаменатель" };

// Only this module reads schedule data for application routes. No User, Account,
// Session, student list, email or other private fields enter the public projection.
export async function getPublicScheduleData(prisma: PrismaClient, query: ScheduleQuery) {
  const [rawGroups, rawTeachers] = await Promise.all([
    prisma.studyGroup.findMany({ where: { isPublic: true }, select: { slug: true, code: true, programme: true, department: { select: { name: true, faculty: true } }, parent: { select: { slug: true, isPublic: true } } }, orderBy: { code: "asc" } }),
    prisma.teacherProfile.findMany({ where: { isSchedulePublic: true, scheduleSlug: { not: null }, publicName: { not: null } }, select: { scheduleSlug: true, publicName: true }, orderBy: { publicName: "asc" } }),
  ]);
  const allGroups: GroupChoice[] = rawGroups.map(g => ({ slug: g.slug, name: g.code, programme: g.programme, faculty: g.department?.faculty ?? null, department: g.department?.name ?? null, parentSlug: g.parent?.isPublic ? g.parent.slug : null }));
  const allTeachers = rawTeachers.map(t => ({ slug: t.scheduleSlug!, name: t.publicName! }));
  const choices = filterScheduleChoices(query.view === "group" ? allGroups : allTeachers, query.q);
  const selected = query.selected ? (query.view === "group" ? allGroups : allTeachers).find(item => item.slug === query.selected) ?? null : choices[0] ?? null;
  const selector: Prisma.ScheduleEntryWhereInput | null = !selected ? null : query.view === "group"
    ? { lesson: { groups: { some: { group: { slug: { in: groupScope(allGroups, selected.slug) }, isPublic: true } } } } }
    : { lesson: { teachers: { some: { teacher: { scheduleSlug: selected.slug, isSchedulePublic: true } } } } };
  return { ...await readSchedule(prisma, query, selected, selector, true), choices, allGroups, allTeachers };
}

// A subgroup includes shared parent lessons; a group includes its descendants.
// A visited set also makes malformed legacy cycles safe to read.
export function groupScope(groups: { slug: string; parentSlug: string | null }[], slug: string) {
  const scope = new Set([slug]);
  let parent = groups.find(g => g.slug === slug)?.parentSlug;
  while (parent && !scope.has(parent)) { scope.add(parent); parent = groups.find(g => g.slug === parent)?.parentSlug; }
  const descendants = new Set([slug]);
  for (let changed = true; changed;) {
    changed = false;
    for (const group of groups) if (group.parentSlug && descendants.has(group.parentSlug) && !descendants.has(group.slug)) { descendants.add(group.slug); changed = true; }
  }
  return [...new Set([...scope, ...descendants])];
}

// actor is supplied only by the server's requireRole(), never by URL parameters.
export async function getPersonalScheduleData(prisma: PrismaClient, query: ScheduleQuery, actor: { id: string; role: "STUDENT" | "TEACHER" }) {
  let selected: PublicChoice | null = null;
  let selector: Prisma.ScheduleEntryWhereInput | null = null;
  let visibleGroups: string[] | undefined;
  if (actor.role === "STUDENT") {
    const profile = await prisma.studentProfile.findUnique({ where: { userId: actor.id }, select: { group: { select: { slug: true, code: true } } } });
    if (profile?.group) {
      selected = { slug: profile.group.slug, name: profile.group.code };
      const groups = await prisma.studyGroup.findMany({ select: { slug: true, parent: { select: { slug: true } } } });
      visibleGroups = groupScope(groups.map(g => ({ slug: g.slug, parentSlug: g.parent?.slug ?? null })), selected.slug);
      selector = { lesson: { groups: { some: { group: { slug: { in: visibleGroups } } } } } };
    }
  } else {
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: actor.id }, select: { publicName: true } });
    if (profile) { selected = { slug: "", name: profile.publicName ?? "Моё расписание" }; selector = { lesson: { teachers: { some: { teacherId: actor.id } } } }; }
  }
  // Identity and search parameters are deliberately discarded in a cabinet.
  return readSchedule(prisma, { ...query, selected: "", q: "" }, selected, selector, false, visibleGroups);
}

async function readSchedule(prisma: PrismaClient, query: ScheduleQuery, selected: PublicChoice | null, selector: Prisma.ScheduleEntryWhereInput | null, publicOnly: boolean, visibleGroups?: string[]) {
  const end = new Date(query.week.getTime() + 6 * DAY_MS);
  const days = Array.from({ length: 7 }, (_, i) => ({ date: isoDate(new Date(query.week.getTime() + i * DAY_MS)), dayOfWeek: i + 1, name: dayNames[i], lessons: [] as PublicLesson[] }));
  let truncated = false;
  if (selector && !query.invalid) {
    const entries = await prisma.scheduleEntry.findMany({
      where: { AND: [publicOnly ? publishedEntry : { isPublished: true, term: { isPublished: true } }, selector, { term: { startsOn: { lte: end }, endsOn: { gte: query.week } } }] },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }, { id: "asc" }], take: 301,
      select: {
        dayOfWeek: true, startMinute: true, endMinute: true, weekPattern: true,
        term: { select: { startsOn: true, endsOn: true, firstNumeratorMonday: true, timeZone: true } },
        room: { select: { number: true, building: { select: { name: true } } } },
        lesson: { select: {
          kind: true, discipline: { select: { title: true } },
          teachers: { where: { teacher: { isSchedulePublic: true, publicName: { not: null } } }, select: { teacher: { select: { scheduleSlug: true, publicName: true } } } },
          groups: { ...(visibleGroups ? { where: { group: { OR: [{ isPublic: true }, { slug: { in: visibleGroups } }] } } } : {}), select: { group: { select: { slug: true, code: true } } } },
        } },
      },
    });
    truncated = entries.length > 300;
    for (const [index, entry] of entries.slice(0, 300).entries()) {
      const day = days[entry.dayOfWeek - 1];
      if (!day || entry.startMinute < 0 || entry.startMinute >= entry.endMinute || entry.endMinute > 1440) continue;
      const date = new Date(day.date + "T00:00:00Z");
      if (date < entry.term.startsOn || date > entry.term.endsOn) continue;
      if (entry.weekPattern !== "EVERY" && entry.weekPattern !== weekParity(query.week, entry.term.firstNumeratorMonday)) continue;
      day.lessons.push({ key: `${day.date}-${index}`, date: day.date, start: minuteLabel(entry.startMinute), end: minuteLabel(entry.endMinute), discipline: entry.lesson.discipline.title, kind: kindNames[entry.lesson.kind], weekPattern: patternNames[entry.weekPattern], teachers: entry.lesson.teachers.map(t => ({ slug: t.teacher.scheduleSlug!, name: t.teacher.publicName! })), groups: entry.lesson.groups.map(g => ({ slug: g.group.slug, name: g.group.code })), room: entry.room.number, building: entry.room.building.name, timeZone: entry.term.timeZone });
    }
  }
  const terms = await prisma.academicTerm.findMany({ where: { isPublished: true, ...(selector ? { entries: { some: { AND: [publicOnly ? publishedEntry : { isPublished: true }, selector] } } } : {}) }, orderBy: [{ startsOn: "asc" }, { code: "asc" }], select: { code: true, name: true, startsOn: true, endsOn: true, firstNumeratorMonday: true } });
  const activeTerms = terms.filter(term => term.startsOn <= end && term.endsOn >= query.week);
  const parities = [...new Set(activeTerms.map(term => patternNames[weekParity(query.week, term.firstNumeratorMonday)]))];
  return { selected, days, weekStart: isoDate(query.week), weekEnd: isoDate(end), termCode: activeTerms.find(t => t.code === query.term)?.code ?? activeTerms[0]?.code ?? "", terms: terms.map(t => ({ code: t.code, name: t.name, startsOn: isoDate(t.startsOn), endsOn: isoDate(t.endsOn) })), parity: parities.length === 1 ? parities[0] : parities.length ? "Разные учебные календари" : "Вне опубликованного учебного периода", truncated };
}

export type ScheduleModel = Awaited<ReturnType<typeof readSchedule>>;
