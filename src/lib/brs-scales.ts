import "server-only";
import { fail } from "./brs-repository.ts";

// Work settings apply only when explicitly saving an individual student's result.
export function gradingSettings(mode: unknown, maximum: unknown) {
  if (mode !== "PRIMARY" && mode !== "RATING") fail("Выберите способ выставления баллов.");
  if (mode === "PRIMARY" && (!Number.isInteger(maximum) || Number(maximum) <= 0 || Number(maximum) > 99999999)) fail("Максимум первичных баллов должен быть от 0,01 до 999999,99.");
  return { scoringMode: mode, primaryMax: mode === "PRIMARY" ? maximum as number : null };
}
