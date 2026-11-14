/** Presentation presets only: conflicts still use actual time intervals. */
const common = [
  { number: 1, start: "08:30", end: "10:00" },
  { number: 2, start: "10:10", end: "11:40" },
  { number: 4, start: "14:05", end: "15:35" },
  { number: 5, start: "15:55", end: "17:25" },
  { number: 6, start: "17:35", end: "19:05" },
  { number: 7, start: "19:15", end: "20:45" },
] as const;
export const bellGrids = [
  { id: "A", label: "Обед после 2-й пары", lunch: { start: "11:40", end: "12:25" }, break: { start: "15:35", end: "15:55" }, pairs: [...common.slice(0, 2), { number: 3, start: "12:25", end: "13:55" }, ...common.slice(2)] },
  { id: "B", label: "Обед после 3-й пары", lunch: { start: "13:20", end: "14:05" }, break: { start: "15:35", end: "15:55" }, pairs: [...common.slice(0, 2), { number: 3, start: "11:50", end: "13:20" }, ...common.slice(2)] },
] as const;
export function identifyPair(start: string, end: string) {
  for (const grid of bellGrids) {
    const pair = grid.pairs.find(pair => pair.start === start && pair.end === end);
    if (pair) return { gridId: grid.id, ...pair };
  }
  return null;
}
export function pairTimeLabel(start: string, end: string) {
  const pair = identifyPair(start, end);
  return (pair ? `${pair.number}-я пара · ` : "") + `${start}–${end}`;
}
