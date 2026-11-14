"use client";
import { useId, useState } from "react";
import { bellGrids, identifyPair, pairTimeLabel } from "@/lib/schedule-bells";

export function ScheduleTimeFields({ start, end }: { start?: string; end?: string }) {
  const id = useId();
  const match = identifyPair(start ?? "", end ?? "");
  const [mode, setMode] = useState(start && !match ? "custom" : "standard");
  const [gridId, setGridId] = useState<string>(match?.gridId ?? "A");
  const [number, setNumber] = useState<number>(match?.number ?? 1);
  const [custom, setCustom] = useState<{ start: string; end: string }>({ start: start ?? bellGrids[0].pairs[0].start, end: end ?? bellGrids[0].pairs[0].end });
  const [hasCustom, setHasCustom] = useState(Boolean(start));
  const grid = bellGrids.find(grid => grid.id === gridId)!;
  const pair = grid.pairs.find(pair => pair.number === number)!;
  const value = mode === "standard" ? pair : custom;
  return <>
    <div className="editor-field"><label htmlFor={`${id}-mode`}>Время занятия</label><select id={`${id}-mode`} value={mode} onChange={event => {
      if (event.target.value === "custom" && !hasCustom) { setCustom({ start: pair.start, end: pair.end }); setHasCustom(true); }
      setMode(event.target.value);
    }}><option value="standard">Стандартная пара</option><option value="custom">Произвольное время</option></select></div>
    {mode === "standard" && <>
      <div className="editor-field"><label htmlFor={`${id}-grid`}>Сетка звонков</label><select id={`${id}-grid`} value={gridId} onChange={event => setGridId(event.target.value)}>{bellGrids.map(grid => <option key={grid.id} value={grid.id}>{grid.label}</option>)}</select></div>
      <div className="editor-field"><label htmlFor={`${id}-pair`}>Номер пары</label><select id={`${id}-pair`} value={number} onChange={event => setNumber(Number(event.target.value))}>{grid.pairs.map(pair => <option key={pair.number} value={pair.number}>{pairTimeLabel(pair.start, pair.end)}</option>)}</select></div>
    </>}
    <label>Начало<input type="time" name="start" required readOnly={mode === "standard"} value={value.start} onChange={event => setCustom({ ...custom, start: event.target.value })} /></label>
    <label>Окончание<input type="time" name="end" required readOnly={mode === "standard"} value={value.end} onChange={event => setCustom({ ...custom, end: event.target.value })} /></label>
    <p aria-live="polite">{pairTimeLabel(value.start, value.end)}</p>
  </>;
}
