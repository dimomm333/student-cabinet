"use client";
import { useRef, useState } from "react";
import type { BrsWorkspace } from "@/lib/brs-repository";
import type { BrsCommand } from "@/lib/brs-commands";
import type { previewPrimaryScale } from "@/lib/brs-scales";
import { converted, roundedHundredths } from "@/lib/brs-exact";
import { parsePrimary, pointInput, points } from "@/lib/brs-rules";
type Plan = NonNullable<BrsWorkspace["selected"]>;
type Work = Plan["modules"][number]["events"][number];
type Record = Plan["students"][number]["results"][number];
export function ScoreFields({ event, result }: { event: Work; result?: Record }) {
  const legacy = !!result && result.primaryMax === null;
  const [mode, setMode] = useState(legacy ? "LEGACY" : "PRIMARY");
  const [primary, setPrimary] = useState(pointInput(result?.deleted ? null : result?.primaryScore));
  let preview: string = "Не выставлено";
  try { if (primary && event.primaryMax) preview = points(roundedHundredths(converted(parsePrimary(primary), event.primaryMax, event.maxScore))); } catch { preview = "Проверьте ввод"; }
  return <div className="brs-score-fields">
    {legacy ? <label className="brs-field"><span>Способ ввода</span><select name="scoringMode" value={mode} onChange={e => setMode(e.target.value)}><option value="LEGACY">Ранее выставленные рейтинговые баллы</option><option value="PRIMARY">Ввести реальные первичные баллы</option></select></label> : <input type="hidden" name="scoringMode" value="PRIMARY" />}
    {mode === "LEGACY" ? <label className="brs-field"><span>{["INTERIM", "FINAL"].includes(event.kind) ? "Баллы РК — прежний рейтинговый результат" : "Прежние рейтинговые баллы"}</span><input aria-label="Прежние рейтинговые баллы" name="score" inputMode="decimal" defaultValue={pointInput(result?.deleted ? null : result?.score)} /></label> : <>
      {!event.primaryMax && <p className="brs-error">Сначала настройте максимальный первичный балл работы.</p>}
      <label className="brs-field"><span>{["INTERIM", "FINAL"].includes(event.kind) ? "Первичные баллы РК" : "Первичные баллы"} (максимум {points(event.primaryMax)})</span><input aria-label={event.kind === "INTERIM" || event.kind === "FINAL" ? "Первичные баллы РК" : "Первичные баллы"} name="primaryScore" inputMode="decimal" value={primary} onChange={e => setPrimary(e.target.value)} disabled={!event.primaryMax} /></label>
      <p className="brs-score-preview" role="status">{event.kind === "INTERIM" || event.kind === "FINAL" ? "Рейтинговые баллы РК" : "Рейтинговые баллы"}: {preview} / {points(event.maxScore)}. Коэффициент: {points(event.maxScore)} / {points(event.primaryMax)}.</p>
      {legacy && <><label><input type="checkbox" name="confirmConversion" required /> Подтверждаю переход на введённые первичные данные</label><label className="brs-field"><span>Основание перехода</span><textarea name="conversionReason" required minLength={5} maxLength={1000} /></label></>}
    </>}
  </div>;
}
export function ScaleFields({ event, command, busy }: { event: Work; command: Partial<BrsCommand>; busy: boolean }) {
  const [maximum, setMaximum] = useState(pointInput(event.primaryMax)), [preview, setPreview] = useState<Awaited<ReturnType<typeof previewPrimaryScale>> | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  async function inspect() {
    setLoading(true); setError(""); const tag = ++generation.current;
    try {
      const response = await fetch("/api/brs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, operation: "PREVIEW_SCALE", requestId: crypto.randomUUID(), primaryMax: parsePrimary(maximum) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (tag === generation.current) setPreview(data.preview);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка проверки."); } finally { setLoading(false); }
  }
  return <>
    <label className="brs-field"><span>Максимальный первичный балл</span><input name="primaryMax" aria-label="Максимальный первичный балл" inputMode="decimal" required value={maximum} onChange={e => { generation.current++; setMaximum(e.target.value); setPreview(null); }} /></label>
    <p>Рейтинговый максимум: {points(event.maxScore)}. Он закреплён планом и не изменяется. Коэффициент пересчёта: {points(event.maxScore)} / {maximum || "—"}.</p>
    <button type="button" disabled={loading || busy} onClick={inspect}>{loading ? "Проверка…" : "Проверить последствия"}</button>
    {error && <p role="alert" className="brs-error">{error}</p>}
    {preview && <><p>Прежние прямые рейтинговые результаты: {preview.legacyCount}. Их баллы останутся без пересчёта.</p><div className="brs-scroll"><table className="brs-table"><thead><tr><th>Студент</th><th>Работа до → после</th><th>Рейтинг до → после</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.resultId}><td>{row.name}</td><td>{points(row.before)} → {points(row.after)}</td><td>{points(row.totalBefore)} → {points(row.totalAfter)}</td></tr>)}</tbody></table></div>{preview.requiresConfirmation && <><label><input type="checkbox" name="confirmed" required /> Подтверждаю последствия пересчёта</label><label className="brs-field"><span>Основание изменения шкалы</span><textarea aria-label="Основание изменения шкалы" name="scaleReason" required minLength={5} maxLength={1000} /></label></>}</>}
    <button className="button button-primary" disabled={busy || loading || !preview} type="submit">Сохранить шкалу</button>
  </>;
}
