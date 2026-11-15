"use client";
import { useState } from "react";
import type { BrsWorkspace } from "@/lib/brs-repository";
import { compare, converted, fraction, roundedHundredths } from "@/lib/brs-exact";
import { halfPoints, parsePoints, parsePrimary, pointInput, points, resultPoints, timingLabels } from "@/lib/brs-rules";

type Plan = NonNullable<BrsWorkspace["selected"]>;
type Work = Plan["modules"][number]["events"][number];
type Record = Plan["students"][number]["results"][number];
export function ScoreFields({ event, result }: { event: Work; result?: Record }) {
  const existing = result && !result.deleted ? result : undefined;
  const timed = ["HOMEWORK", "INTERIM", "FINAL"].includes(event.kind);
  const [timing, setTiming] = useState(existing?.submissionTiming ?? "NOT_SUBMITTED");
  const [value, setValue] = useState(pointInput(event.scoringMode === "PRIMARY" ? existing?.primaryScore : existing?.score));
  const notSubmitted = timed && timing === "NOT_SUBMITTED", late = timed && timing === "LATE";
  let preview = "Не оценено", success = "";
  try {
    const exact = late ? fraction(event.maxScore, 2) : !notSubmitted && value ? event.scoringMode === "PRIMARY" && event.primaryMax ? converted(parsePrimary(value), event.primaryMax, event.maxScore) : fraction(parsePoints(value)) : null;
    if (exact) { preview = late ? halfPoints(event.maxScore) : points(roundedHundredths(exact)); success = compare(exact, fraction(event.maxScore, 2)) >= 0 ? "Успешно сдано" : "Менее 50% — не сдано успешно"; }
  } catch { preview = "Проверьте ввод"; }
  return <div className="brs-score-fields">
    {existing?.score != null && <small className="brs-saved-score">Сохранено: {resultPoints(existing, event.maxScore)} / {points(event.maxScore)} БРС{existing.primaryMax != null ? ` · первичные ${points(existing.primaryScore)} / ${points(existing.primaryMax)}` : existing.scoreSource === "LATE" ? " · 50% за опоздание" : " · прямой рейтинг"}. Изменится только при сохранении этой формы.</small>}
    <input type="hidden" name="scoringMode" value={event.scoringMode} />
    {timed && <label className="brs-field"><span>Состояние сдачи</span><select aria-label="Состояние сдачи" name="submissionTiming" value={timing} onChange={e => setTiming(e.target.value)}>{Object.entries(timingLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
    {notSubmitted ? <><p>Баллы не выставляются. Работа не считается выполненной.</p>{existing?.score != null && <label><input type="checkbox" name="confirmed" required /> Подтверждаю аннулирование сохранённого результата {points(existing.score)} БРС</label>}</> : late ? <p className="brs-score-preview" role="status">Итог БРС: {preview} / {points(event.maxScore)} — ровно 50% за сдачу с опозданием. Первичные баллы не создаются.</p> : <>
      <label className="brs-field"><span>{event.scoringMode === "PRIMARY" ? "Первичные баллы" : "Баллы БРС"} / {points(event.scoringMode === "PRIMARY" ? event.primaryMax : event.maxScore)}</span><input name={event.scoringMode === "PRIMARY" ? "primaryScore" : "score"} aria-label={event.scoringMode === "PRIMARY" ? "Первичные баллы" : "Баллы БРС"} inputMode="decimal" required={timed} value={value} onChange={e => setValue(e.target.value)} /></label>
      {event.scoringMode === "PRIMARY" && <p className="brs-score-preview" role="status">Итог БРС: {preview} / {points(event.maxScore)}</p>}
    </>}
    {timed && !notSubmitted && <small>{success}</small>}
  </div>;
}
export function ScaleFields({ event, busy }: { event: Work; busy: boolean }) {
  const [mode, setMode] = useState(event.scoringMode);
  const [maximum, setMaximum] = useState(pointInput(event.primaryMax));
  let valid = mode === "RATING";
  try { if (mode === "PRIMARY") valid = parsePrimary(maximum) > 0; } catch { valid = false; }
  return <>
    <label className="brs-field"><span>Способ выставления баллов</span><select name="scoringMode" aria-label="Способ выставления баллов" value={mode} onChange={e => setMode(e.target.value)}><option value="PRIMARY">По первичным баллам</option><option value="RATING">По рейтинговым баллам</option></select></label>
    {mode === "PRIMARY" && <label className="brs-field"><span>Максимальный первичный балл</span><input name="primaryMax" aria-label="Максимальный первичный балл" inputMode="decimal" required value={maximum} onChange={e => setMaximum(e.target.value)} /></label>}
    <p>Максимум БРС: {points(event.maxScore)}</p><small>Настройка применяется к новым оценкам и явным исправлениям. Сохранённые результаты остаются прежними.</small>
    <button className="button button-primary" type="submit" disabled={busy || !valid}>{busy ? "Сохранение…" : "Сохранить"}</button>
  </>;
}
