import type { BrsWorkspace } from "@/lib/brs-repository";
import type { BrsCalculation } from "@/lib/brs-rules";
import { points, resultPoints, workStatus, workTitle } from "@/lib/brs-rules";

type Plan = NonNullable<BrsWorkspace["selected"]>;
type Student = Plan["students"][number];
type Work = Plan["modules"][number]["events"][number];
type Module = Plan["modules"][number];
export function AcademicIssues({ issues }: { issues: BrsCalculation["issues"] }) {
  return <>{([['DEBT','Задолженности'],['WAITING','Ожидается оценивание'],['UPCOMING','Предстоящие работы']] as const).map(([category,title]) => {
    const rows = issues.filter(issue => issue.category === category);
    return !!rows.length && <section key={category} className={`brs-issues brs-issues-${category.toLowerCase()}`}><h4>{title}</h4><ul>{rows.map(issue => <li key={issue.id}><strong>{issue.title}</strong> — {issue.reason.toLowerCase()}</li>)}</ul></section>;
  })}</>;
}
export function OfficialResult({ official }: { official: { valid: boolean; grade: string; rating: number; status: string } | null }) {
  return !official ? <>Не утверждён</> : official.valid ? <>{official.grade} · {official.rating} баллов</> : <span className="brs-official-review">Действительный итог отсутствует · ожидает повторной фиксации</span>;
}
export function ModuleDetails({ plan, student, brsModule }: { plan: Plan; student: Student; brsModule: Module }) {
  const calculation = student.calculation.modules.find(item => item.id === brsModule.id)!;
  const state = calculation.academicStatus.toLowerCase();
  return <section className="brs-detail-section"><h3>Итоги модуля {brsModule.number}</h3><div className="brs-scroll"><table className="brs-table brs-module-breakdown"><thead><tr><th>Работа</th><th>Баллы / максимум</th><th>Состояние</th></tr></thead><tbody>{brsModule.events.filter(event => event.kind !== "SEMINAR").map(event => {
    const result = student.results.find(item => item.eventId === event.id && !item.deleted), condition = student.calculation.workStates[event.id];
    const replacement = plan.control === "DISTRIBUTED" && event.id === student.calculation.finalEventId && !!student.calculation.bestAttemptId;
    return <tr key={event.id} className={condition?.category === "DEBT" && !condition.coveredByAttempt ? "brs-breakdown-debt" : ""}><th scope="row">{workTitle(event, false)}</th><td>{resultPoints(result, event.maxScore)}/{points(event.maxScore)}{replacement && <small>В расчёте лучший РК/сессионный результат: {points(student.calculation.examScore)}/{points(event.maxScore)}</small>}</td><td>{condition?.coveredByAttempt ? "Учтена сессионная замена" : condition?.reason ?? workStatus(event, result)}</td></tr>;
  })}<tr><th scope="row">Работа на семинарах</th><td>{points(calculation.seminarScore)}/{points(brsModule.seminarMax)}</td><td>{calculation.seminarMissing ? `Неотмеченных занятий: ${calculation.seminarMissing}` : "По посещаемости"}</td></tr></tbody><tfoot className={`brs-condition-${state}`}><tr><th scope="row">Итог модуля {brsModule.number}</th><td>{points(calculation.score)}/{points(calculation.max)}</td><td>{calculation.debts.some(issue => issue.category === "DEBT") ? "Есть задолженности" : calculation.complete && !calculation.seminarMissing ? "Обязательные работы выполнены" : "Недостаточно данных"}</td></tr></tfoot></table></div><AcademicIssues issues={calculation.debts} /></section>;
}
export function WorkDetails({ plan, student, event, brsModule }: { plan: Plan; student: Student; event: Work; brsModule?: Module }) {
  const result = student.results.find(item => item.eventId === event.id && !item.deleted), control = ["INTERIM", "FINAL"].includes(event.kind), condition = student.calculation.workStates[event.id];
  return <><p className="brs-detail-course">{plan.discipline.title}</p><section className="brs-detail-section"><h3>{control ? `Рубежный контроль №${event.controlNumber}` : "Результат работы"}</h3><p className="brs-detail-score">Результат: {resultPoints(result, event.maxScore)}/{points(event.maxScore)}</p><p>Состояние сдачи: {workStatus(event, result)}</p>{condition && <p className={`brs-work-condition brs-condition-${condition.coveredByAttempt || condition.category === "DEBT" ? "waiting" : condition.category.toLowerCase()}`}>{condition.coveredByAttempt ? "Исходный РК заменён сессионным результатом в расчёте" : condition.reason}</p>}{result?.primaryMax != null && <p>Первичные баллы: {points(result.primaryScore)}/{points(result.primaryMax)}</p>}<div className="brs-comment"><p>{result?.comment ? `Комментарий преподавателя:\n${result.comment}` : "Комментарий отсутствует"}</p></div></section>{event.kind === "FINAL" && brsModule ? <ModuleDetails plan={plan} student={student} brsModule={brsModule} /> : null}</>;
}
