import type { BrsWorkspace } from "@/lib/brs-repository";
import { controlTitles, distributedAttemptPassed, points } from "@/lib/brs-rules";
import { presentAcademicText } from "@/lib/presentation-copy";
import { formatDateInput } from "@/lib/schedule-calendar";
import { AcademicIssues, OfficialResult } from "./brs-result-details";
import { workTitle } from "./brs-work-labels";

type Course = BrsWorkspace["overview"][number];
const dateLabel = (date: string) => formatDateInput(date.slice(0, 10));

function courseStatus({ official, control, calculation }: Course) {
  if (official?.valid) return "Итог утверждён";
  if (official) return "Итог требует повторной фиксации";
  if (control === "EXAM" && calculation.admissionStatus !== "Допущен") return calculation.admissionStatus;
  if (calculation.ready) return "Ожидает утверждения итога";
  if (calculation.physical) return "Не выполнены условия зачёта";
  if (calculation.confirmedDebts.length) return "Есть задолженности";
  if (control === "EXAM" && !calculation.bestAttemptId) return "Допущен";
  if (calculation.sessionRequired) return "Требуется сессионная попытка";
  return "Расчёт не завершён";
}

function CourseSession({ course }: { course: Course }) {
  const { title, control, examOn, teachers, admission, attempts, official, calculation: c } = course;
  const exam = control === "EXAM", distributed = control === "DISTRIBUTED";
  const finalWork = distributed ? course.modules.flatMap(module => module.events).find(event => event.id === c.finalEventId) : undefined;
  return (
    <details className="panel brs-panel brs-session-course" data-plan={course.id}>
      <summary>
        <span className="brs-session-summary">
          <strong>{title}</strong>
          <span className="brs-session-meta">
            <span className="brs-badge">{controlTitles[control]}</span>
            <span>{courseStatus(course)}</span>
            {examOn && <time dateTime={examOn}>{dateLabel(examOn)}</time>}
            {official?.valid && <strong>Итог: {official.grade}</strong>}
          </span>
        </span>
      </summary>
      <div className="brs-session-content">
        <dl className="brs-facts">
          <div><dt>Дата проведения</dt><dd>{examOn ? <time dateTime={examOn}>{dateLabel(examOn)}</time> : "Дата не назначена"}</dd></div>
          {!!teachers.length && <div><dt>{teachers.length === 1 ? "Преподаватель дисциплины" : "Преподаватели дисциплины"}</dt><dd>{teachers.join(", ")}</dd></div>}
          <div><dt>Баллы за семестр</dt><dd>{points(c.semesterScore)} / {points(c.semesterMax)}</dd></div>
          {exam && <div><dt>Экзаменационные баллы</dt><dd>{points(c.examScore)} / {points(c.examMax)}</dd></div>}
          <div><dt>Накопленный рейтинг</dt><dd>{points(c.total)} / 100</dd></div>
          {c.physical && <div><dt>Подтверждённые посещения</dt><dd>{c.physical.visits} / 25</dd></div>}
          {c.ready && <div><dt>Расчётная оценка</dt><dd>{c.provisionalGrade} · {c.finalCalculatedRating} баллов</dd></div>}
          <div><dt>Утверждённый результат</dt><dd><OfficialResult official={official} /></dd></div>
        </dl>
        {official?.valid && <p>Фиксация: {official.author.name}, {dateLabel(official.approvedAt)}</p>}
        {exam && <section className="brs-admission">
          <h3>Допуск к экзамену</h3>
          <p><strong>{c.admissionStatus}</strong></p>
          <p>Академическая проверка: {c.academic.state === "MET" ? "условия выполнены" : c.academic.state === "FAILED" ? "условия не выполнены" : "недостаточно данных"}</p>
          {admission && <p>{presentAcademicText(admission.reason)} · {dateLabel(admission.decidedAt)}</p>}
        </section>}
        {distributed && <section className="brs-admission">
          <h3>Распределённый экзамен</h3>
          <p>Допуск к последнему РК: {c.academic.state === "MET" ? "допущен" : c.academic.state === "FAILED" ? "не допущен" : "проверка не завершена"}</p>
          <p>Баллы за предыдущие модули: {points(c.previousScore)}</p>
          {finalWork && <p>Исходный результат {workTitle(finalWork, false)}: {points(c.originalFinalScore)} / {points(c.examMax)}</p>}
          <p>{c.sessionRequired ? "Требуется сессионная попытка." : "Сессионная попытка доступна для повышения."}</p>
          <p>В рейтинге учитывается лучший результат последнего РК или сессионной попытки: {points(c.originalFinalScore !== null || c.bestAttemptId ? c.examScore : null)} / {points(c.examMax)}.</p>
        </section>}
        <AcademicIssues issues={c.issues} />
        {(exam || distributed) && <section>
          <h3>Экзаменационные попытки · до {points(c.examMax)} баллов</h3>
          {attempts.length ? <ul className="brs-session-attempts">
            {attempts.map(attempt => {
              const passed = distributed ? distributedAttemptPassed(attempt.score, c.examMax) : attempt.passed;
              return <li key={attempt.id}>
                <strong>Попытка {attempt.number}</strong>
                <span><time dateTime={attempt.heldOn}>{dateLabel(attempt.heldOn)}</time> · {points(attempt.score)} / {points(c.examMax)} · {passed ? "Сдан" : "Не сдан"}</span>
                {attempt.deleted ? <small>Удалена</small> : c.bestAttemptId === attempt.id && <small>{exam ? "Учтена в рейтинге" : "Лучшая попытка"}</small>}
                {attempt.comment && <span className="brs-text-comment">{presentAcademicText(attempt.comment)}</span>}
              </li>;
            })}
          </ul> : <p>Попыток пока нет.</p>}
        </section>}
      </div>
    </details>
  );
}

export function StudentSession({ courses, today }: { courses: Course[]; today: string }) {
  const upcoming = (course: Course) => !course.official?.valid && course.examOn && course.examOn >= today ? course.examOn : null;
  const ordered = [...courses].sort((a, b) => {
    const aDate = upcoming(a), bDate = upcoming(b);
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
    if (!!aDate !== !!bDate) return aDate ? -1 : 1;
    return a.title.localeCompare(b.title, "ru");
  });
  return <div className="brs-session">{ordered.map(course => <CourseSession key={course.id} course={course} />)}</div>;
}
