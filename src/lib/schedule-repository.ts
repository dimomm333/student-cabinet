import "server-only";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { effectiveSchedule, loadScheduleRecords, isPublicPair, type EffectivePair } from "./schedule-effective.ts";
import { DAY_MS, dayNames, isoDate, minuteLabel, filterScheduleChoices, weekParity, currentAcademicDate, scheduleHref, mondayOf, type ScheduleQuery } from "./schedule-calendar.ts";

export type PublicChoice = { slug: string; name: string };
export type GroupChoice = PublicChoice & { programme: string; faculty: string | null; department: string | null; parentSlug: string | null };
export type PublicLesson = { key: string; date: string; start: string; end: string; discipline: string; kind: string; kindCode: "LECTURE" | "PRACTICE" | "SEMINAR" | "LAB"; weekPattern: string; weekPatternCode: "EVERY" | "NUMERATOR" | "DENOMINATOR"; termCode: string; teachers: PublicChoice[]; groups: PublicChoice[]; room: string; building: string; timeZone: string; change?: { type: string; cancelled: boolean; sourceDate: string; targetDate?: string; original?: { discipline: string; start: string; end: string; room: string; teachers: string[] } } };

type Audience = { groups?: string[]; teacherId?: string; teacherSlug?: string };
function matches(pair: Pick<EffectivePair, "record">, audience: Audience) {
  return audience.groups ? pair.record.lesson.groups.some(item => audience.groups!.includes(item.group.slug))
    : pair.record.lesson.teachers.some(item => audience.teacherId ? item.teacherId === audience.teacherId : item.teacher.scheduleSlug === audience.teacherSlug);
}

const kindNames = { LECTURE: "Лекция", PRACTICE: "Практика", SEMINAR: "Семинар", LAB: "Лабораторная" };
const patternNames = { EVERY: "Каждую неделю", NUMERATOR: "Числитель", DENOMINATOR: "Знаменатель" };

// Only this module reads schedule data for application routes. No User, Account,
// Session, student list, email or other private fields enter the public projection.
export async function getPublicScheduleCatalog(prisma: PrismaClient, take?: number) {
  const [rawGroups, rawTeachers] = await Promise.all([
    prisma.studyGroup.findMany({ take, where: { isPublic: true }, select: { slug: true, code: true, programme: true, department: { select: { name: true, faculty: true } }, parent: { select: { slug: true, isPublic: true } } }, orderBy: [{ code: "asc" }, { slug: "asc" }] }),
    prisma.teacherProfile.findMany({ take, where: { isSchedulePublic: true, scheduleSlug: { not: null }, publicName: { not: null } }, select: { scheduleSlug: true, publicName: true }, orderBy: [{ publicName: "asc" }, { scheduleSlug: "asc" }] }),
  ]);
  const allGroups: GroupChoice[] = rawGroups.map(g => ({ slug: g.slug, name: g.code, programme: g.programme, faculty: g.department?.faculty ?? null, department: g.department?.name ?? null, parentSlug: g.parent?.isPublic ? g.parent.slug : null }));
  const allTeachers = rawTeachers.map(t => ({ slug: t.scheduleSlug!, name: t.publicName! }));
  return { allGroups, allTeachers };
}

export async function getPublicScheduleData(prisma: PrismaClient, query: ScheduleQuery, catalog?: Awaited<ReturnType<typeof getPublicScheduleCatalog>>) {
  const { allGroups, allTeachers } = catalog ?? await getPublicScheduleCatalog(prisma);
  const choices = filterScheduleChoices(query.view === "group" ? allGroups : allTeachers, query.q);
  const selected = query.selected ? (query.view === "group" ? allGroups : allTeachers).find(item => item.slug === query.selected) ?? null : choices[0] ?? null;
  const selector: Audience | null = !selected ? null : query.view === "group" ? { groups: groupScope(allGroups, selected.slug) } : { teacherSlug: selected.slug };
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
async function personalAudience(prisma: PrismaClient, actor: { id: string; role: "STUDENT" | "TEACHER" }) {
  let selected: PublicChoice | null = null;
  let selector: Audience | null = null;
  let visibleGroups: string[] | undefined;
  if (actor.role === "STUDENT") {
    const profile = await prisma.studentProfile.findUnique({ where: { userId: actor.id }, select: { group: { select: { slug: true, code: true } } } });
    if (profile?.group) {
      selected = { slug: profile.group.slug, name: profile.group.code };
      const groups = await prisma.studyGroup.findMany({ select: { slug: true, parent: { select: { slug: true } } } });
      visibleGroups = groupScope(groups.map(g => ({ slug: g.slug, parentSlug: g.parent?.slug ?? null })), selected.slug);
      selector = { groups: visibleGroups };
    }
  } else {
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: actor.id }, select: { publicName: true } });
    if (profile) { selected = { slug: "", name: profile.publicName ?? "Моё расписание" }; selector = { teacherId: actor.id }; }
  }
  return { selected, selector, visibleGroups };
}
export async function getPersonalScheduleData(prisma: PrismaClient, query: ScheduleQuery, actor: { id: string; role: "STUDENT" | "TEACHER" }) {
  const { selected, selector, visibleGroups } = await personalAudience(prisma, actor);
  // Identity and search parameters are deliberately discarded in a cabinet.
  return readSchedule(prisma, { ...query, selected: "", q: "" }, selected, selector, false, visibleGroups);
}

// Same audience, effective occurrences and calendar as the full timetable.
// Search through published terms rather than dropping lessons after 14 days.
export async function getStudentScheduleOverviewData(prisma: PrismaClient, studentId: string, now = new Date()) {
  const { selected, selector, visibleGroups } = await personalAudience(prisma, { id: studentId, role: "STUDENT" });
  const records = await loadScheduleRecords(prisma);
  const relevant = [...records.entries, ...records.exceptions].filter(record => selector && record.isPublished && record.term.isPublished && matches({ record }, selector));
  const terms = [...new Map(relevant.map(record => [record.termId, record.term])).values()].sort((a,b) => a.startsOn.getTime() - b.startsOn.getTime());
  const primary = terms.find(term => { const date = currentAcademicDate(now, term.timeZone); return term.startsOn <= date && date <= term.endsOn; })
    ?? terms.find(term => term.endsOn >= currentAcademicDate(now, term.timeZone)) ?? terms.at(-1);
  const timeZone = primary?.timeZone ?? "Europe/Moscow";
  const todayDate = currentAcademicDate(now, timeZone), today = isoDate(todayDate);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const end = new Date(Math.max(todayDate.getTime(), ...terms.map(term => term.endsOn.getTime())));
  const pairs = selector ? effectiveSchedule(records, todayDate, end, "personal").filter(pair => matches(pair, selector)).map(pair => projectPair(pair, visibleGroups)) : [];
  const todayLessons = pairs.filter(lesson => lesson.date === today);
  const next = pairs.find(lesson => !lesson.change?.cancelled && (lesson.date > today || lesson.end > time)) ?? null;
  const date = next?.date ?? today;
  const activeTerms = terms.filter(term => term.startsOn <= todayDate && term.endsOn >= todayDate);
  const parity = [...new Set(activeTerms.map(term => patternNames[weekParity(todayDate, term.firstNumeratorMonday)]))];
  const day = next ? { date, dayOfWeek: (new Date(date).getUTCDay() + 6) % 7 + 1, name: dayNames[(new Date(date).getUTCDay() + 6) % 7], lessons: pairs.filter(lesson => lesson.date === date) } : null;
  const href = (lesson: PublicLesson) => scheduleHref("/dashboard/schedule", { view: "group", selected: "", week: isoDate(mondayOf(new Date(lesson.date))), day: (new Date(lesson.date).getUTCDay() + 6) % 7 + 1, term: lesson.termCode });
  return { today, time, timeZone, selectedDate: date, parity: parity.length === 1 ? parity[0] : parity.length ? "Разные учебные календари" : "Вне учебного периода",
    todayCount: todayLessons.filter(lesson => !lesson.change?.cancelled).length,
    todayFirst: todayLessons.find(lesson => !lesson.change?.cancelled)?.start ?? null,
    day, next, linked: !!selected, group: selected?.name ?? null,
    reason: !selected ? "unlinked" : !next ? "none" : date === today ? "today" : todayLessons.some(lesson => !lesson.change?.cancelled) ? "finished" : todayLessons.length ? "cancelled" : "empty",
    lessons: day?.lessons.map(lesson => ({ ...lesson, href: href(lesson), ended: lesson.date === today && lesson.end <= time })) ?? [],
    nextHref: next ? href(next) : "/dashboard/schedule",
  };
}

export function projectPair(pair: EffectivePair, visibleGroups?: string[], publicOnly = false): PublicLesson {
  const entry = pair.record;
  const pattern = "weekPattern" in entry ? entry.weekPattern : "EVERY";
  const original = pair.original && (!publicOnly || isPublicPair(pair.original)) ? pair.original : undefined;
  return { key: `${pair.date.toISOString()}-${entry.id}-${pair.status}`, date: isoDate(pair.date), start: minuteLabel(entry.startMinute), end: minuteLabel(entry.endMinute),
    discipline: entry.lesson.discipline.title, kind: kindNames[entry.lesson.kind], kindCode: entry.lesson.kind, weekPattern: patternNames[pattern], weekPatternCode: pattern, termCode: entry.term.code,
    teachers: entry.lesson.teachers.filter(item => item.teacher.isSchedulePublic && item.teacher.publicName && item.teacher.scheduleSlug).map(item => ({ slug: item.teacher.scheduleSlug!, name: item.teacher.publicName! })),
    groups: entry.lesson.groups.filter(item => !visibleGroups || item.group.isPublic || visibleGroups.includes(item.group.slug)).map(item => ({ slug: item.group.slug, name: item.group.code })),
    room: entry.room.number, building: entry.room.building.name, timeZone: entry.term.timeZone,
    ...(pair.status !== "REGULAR" ? { change: { type: pair.status, cancelled: pair.cancelled, sourceDate: isoDate(pair.sourceDate), ...(pair.targetDate ? { targetDate: isoDate(pair.targetDate) } : {}),
      ...(original ? { original: { discipline: original.lesson.discipline.title, start: minuteLabel(original.startMinute), end: minuteLabel(original.endMinute), room: original.room.number,
        teachers: original.lesson.teachers.filter(item => item.teacher.isSchedulePublic && item.teacher.publicName).map(item => item.teacher.publicName!) } } : {}),
    } } : {}),
  };
}
async function readSchedule(prisma: PrismaClient, query: ScheduleQuery, selected: PublicChoice | null, selector: Audience | null, publicOnly: boolean, visibleGroups?: string[]) {
  const end = new Date(query.week.getTime() + 6 * DAY_MS);
  const days = Array.from({ length: 7 }, (_, i) => ({ date: isoDate(new Date(query.week.getTime() + i * DAY_MS)), dayOfWeek: i + 1, name: dayNames[i], lessons: [] as PublicLesson[] }));
  const records = await loadScheduleRecords(prisma);
  const visible = (record: typeof records.entries[number] | typeof records.exceptions[number]) => publicOnly ? isPublicPair(record) : record.isPublished && record.term.isPublished;
  const relevantTerms = new Set([...records.entries, ...records.exceptions].filter(record => visible(record) && (!selector || matches({ record }, selector))).map(record => record.termId));
  const terms = await prisma.academicTerm.findMany({ where: { isPublished: true, ...(selector ? { id: { in: [...relevantTerms] } } : {}) }, orderBy: [{ startsOn: "asc" }, { code: "asc" }], select: { code: true, name: true, startsOn: true, endsOn: true, firstNumeratorMonday: true } });
  const pairs = selector && !query.invalid ? effectiveSchedule(records, query.week, end, publicOnly ? "public" : "personal").filter(pair => matches(pair, selector)) : [];
  for (const pair of pairs.slice(0, 300)) days[(pair.date.getUTCDay() + 6) % 7].lessons.push(projectPair(pair, visibleGroups, publicOnly));
  const activeTerms = terms.filter(term => term.startsOn <= end && term.endsOn >= query.week);
  const parities = [...new Set(activeTerms.map(term => patternNames[weekParity(query.week, term.firstNumeratorMonday)]))];
  return { selected, days, weekStart: isoDate(query.week), weekEnd: isoDate(end), termCode: activeTerms.find(t => t.code === query.term)?.code ?? activeTerms[0]?.code ?? "", terms: terms.map(t => ({ code: t.code, name: t.name, startsOn: isoDate(t.startsOn), endsOn: isoDate(t.endsOn), firstNumeratorMonday: isoDate(t.firstNumeratorMonday) })), parity: parities.length === 1 ? parities[0] : parities.length ? "Разные учебные календари" : "Вне опубликованного учебного периода", truncated: pairs.length > 300 };
}
export type ScheduleModel = Awaited<ReturnType<typeof readSchedule>>;
