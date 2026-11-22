export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function parseDateText(value: string): Date | null {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return null;
  return parseDateOnly(value.split(".").reverse().join("-"));
}
