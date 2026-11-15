import "server-only";
import type { BrsDB, FullPlan } from "./brs-repository.ts";
import { calculateStudent, fail } from "./brs-repository.ts";
import { calculateBrs, effectiveModules } from "./brs-rules.ts";
import { converted, roundedHundredths } from "./brs-exact.ts";

export async function previewPrimaryScale(db: BrsDB, plan: FullPlan, eventId: string, maximum: number) {
  if (!Number.isInteger(maximum) || maximum <= 0 || maximum > 99999999) fail("Максимум первичных баллов должен быть от 0,01 до 999999,99.");
  const event = plan.modules.flatMap(item => item.events).find(item => item.id === eventId);
  if (!event || event.kind === "SEMINAR") fail("Настройка первичных баллов для этого мероприятия недоступна.");
  const results = await db.brsResult.findMany({ where: { eventId, deleted: false }, include: { student: { select: { name: true } } } });
  if (results.length > 1000) fail("Слишком много результатов для изменения шкалы.");
  if (results.some(result => result.primaryScore !== null && result.primaryScore > maximum)) fail("Новый максимум меньше уже выставленного первичного результата.");
  const rows = [];
  for (const result of results.filter(result => result.primaryMax !== null)) {
    const current = await calculateStudent(db, plan, result.studentId);
    const nextResults = current.results.map(item => item.id === result.id ? { ...item, primaryMax: maximum, score: item.primaryScore === null ? null : roundedHundredths(converted(item.primaryScore, maximum, event.maxScore)) } : item);
    const next = calculateBrs(plan.control, effectiveModules(plan.modules, nextResults, current.attendance), current.attempts, current.admission);
    rows.push({ resultId: result.id, studentId: result.studentId, name: result.student.name, authorId: result.authorId, primaryScore: result.primaryScore,
      before: result.score, after: result.primaryScore === null ? null : roundedHundredths(converted(result.primaryScore, maximum, event.maxScore)),
      totalBefore: current.calculation.total, totalAfter: next.total, ratingBefore: current.calculation.rating, ratingAfter: next.rating });
  }
  return { oldMax: event.primaryMax, newMax: maximum, ratingMax: event.maxScore, rows, legacyCount: results.filter(result => result.primaryMax === null).length, requiresConfirmation: await db.brsResult.count({ where: { eventId } }) > 0 };
}
