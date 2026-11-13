import "server-only";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { academicWeeks, DAY_MS, filterScheduleChoices, isoDate, weekParity } from "./schedule-calendar.ts";
import { getPublicScheduleCatalog, getPublicScheduleData } from "./schedule-repository.ts";
import { parseScheduleApiParameters, ScheduleApiError, type ScheduleApiResource } from "./schedule-api-parameters.ts";

export type ApiParameters = ReturnType<typeof parseScheduleApiParameters>;
export async function getScheduleApiData(db: PrismaClient, resource: ScheduleApiResource, parameters: ApiParameters) {
  const catalog = await getPublicScheduleCatalog(db, 5001);
  if (catalog.allGroups.length > 5000 || catalog.allTeachers.length > 5000) throw new ScheduleApiError(503, "CATALOG_CAPACITY", "Справочник временно недоступен.");
  if (parameters.kind === "list") {
    const matches = filterScheduleChoices(resource === "groups" ? catalog.allGroups : catalog.allTeachers, parameters.q);
    const items = matches.slice(parameters.offset, parameters.offset + parameters.limit);
    const nextOffset = parameters.offset + items.length;
    return { data: items, pagination: { limit: parameters.limit, offset: parameters.offset, total: matches.length, hasMore: nextOffset < matches.length, nextOffset: nextOffset < matches.length ? nextOffset : null } };
  }
  let week = parameters.week;
  let explicitTerm: { code: string; name: string; startsOn: Date; endsOn: Date; firstNumeratorMonday: Date } | null = null;
  if (parameters.term) {
    explicitTerm = await db.academicTerm.findFirst({ where: { code: parameters.term, isPublished: true }, select: { code: true, name: true, startsOn: true, endsOn: true, firstNumeratorMonday: true } });
    if (!explicitTerm) throw new ScheduleApiError(404, "TERM_NOT_FOUND", "Опубликованный учебный период не найден.");
    if (parameters.weekNumber !== null) {
      const numbered = academicWeeks(isoDate(explicitTerm.startsOn), isoDate(explicitTerm.endsOn)).find(w => w.number === parameters.weekNumber);
      if (!numbered) throw new ScheduleApiError(400, "INVALID_WEEK_NUMBER", "Номер недели выходит за границы учебного периода.");
      week = new Date(numbered.start + "T00:00:00Z");
    }
    if (week > explicitTerm.endsOn || new Date(week.getTime() + 6 * DAY_MS) < explicitTerm.startsOn) throw new ScheduleApiError(400, "WEEK_OUTSIDE_TERM", "Дата недели находится вне указанного учебного периода.");
  }
  const model = await getPublicScheduleData(db, { view: parameters.view, selected: parameters.selected, week, term: parameters.term, q: "", day: null, invalid: false }, catalog);
  if (!model.selected) throw new ScheduleApiError(404, "SELECTION_NOT_FOUND", "Публичная группа или преподаватель не найдены.");
  if (model.days.some(day => day.lessons.some(lesson => lesson.timeZone !== "Europe/Moscow"))) throw new ScheduleApiError(503, "UNSUPPORTED_TIME_ZONE", "Учебный календарь требует уточнения часового пояса.");
  const terms = [...model.terms];
  if (explicitTerm && !terms.some(t => t.code === explicitTerm.code)) terms.push({ code: explicitTerm.code, name: explicitTerm.name, startsOn: isoDate(explicitTerm.startsOn), endsOn: isoDate(explicitTerm.endsOn), firstNumeratorMonday: isoDate(explicitTerm.firstNumeratorMonday) });
  return { data: {
    selection: { type: parameters.view, slug: model.selected.slug, name: model.selected.name },
    week: { startsOn: model.weekStart, endsOn: model.weekEnd, timeZone: "Europe/Moscow", selectedTerm: parameters.term || null,
      periods: terms.flatMap(term => {
        const numbered = academicWeeks(term.startsOn, term.endsOn).find(w => w.start === model.weekStart);
        return numbered ? [{ code: term.code, name: term.name, startsOn: term.startsOn, endsOn: term.endsOn, weekNumber: numbered.number, parity: weekParity(week, new Date(term.firstNumeratorMonday + "T00:00:00Z")) }] : [];
      }),
    },
    days: model.days.map(day => ({ date: day.date, dayOfWeek: day.dayOfWeek, lessons: day.lessons.map(lesson => ({
      discipline: lesson.discipline, kind: lesson.kindCode, start: lesson.start, end: lesson.end, weekPattern: lesson.weekPatternCode, term: lesson.termCode,
      teachers: lesson.teachers.map(t => ({ slug: t.slug, name: t.name })), groups: lesson.groups.map(g => ({ slug: g.slug, name: g.name })),
      room: lesson.room, building: lesson.building, timeZone: "Europe/Moscow",
    })) })),
    truncated: model.truncated,
  } };
}
