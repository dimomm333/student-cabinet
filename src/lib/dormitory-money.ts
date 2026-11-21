import { DormError } from "./dormitory-shared.ts";

// BigInt uses hundredths only for arithmetic. Persist values via encodeRubles.
const scale = BigInt(100);
export const maxDormAmount = BigInt(2147483647);
const groupedInteger = new Intl.NumberFormat("ru-RU");

export function decodeRubles(raw: string): bigint {
  const match = /^(-?)(0|[1-9]\d*)\.(\d{2})$/.exec(raw);
  if (!match || raw === "-0.00") throw new Error("Invalid stored dormitory amount");
  const [, sign, whole, fraction] = match;
  return (BigInt(whole) * scale + BigInt(fraction)) * (sign ? -BigInt(1) : BigInt(1));
}

export function encodeRubles(value: bigint): string {
  const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${absolute / scale}.${String(absolute % scale).padStart(2, "0")}`;
}

export function parseRubles(raw: string): bigint {
  const match = /^(-?)(\d{1,8})(?:[,.](\d{1,2}))?$/.exec(raw.trim());
  if (!match) throw new DormError("Укажите сумму в рублях, до двух знаков после запятой.");
  const [, sign, whole, fraction = ""] = match;
  const amount = (BigInt(whole) * scale + BigInt(fraction.padEnd(2, "0"))) * (sign ? -BigInt(1) : BigInt(1));
  if (amount < -maxDormAmount || amount > maxDormAmount) throw new DormError("Сумма выходит за допустимый диапазон.");
  return amount;
}

export function formatRubles(value: string | bigint): string {
  const amount = typeof value === "string" ? decodeRubles(value) : value;
  const absolute = amount < BigInt(0) ? -amount : amount;
  const fraction = absolute % scale;
  return `${amount < BigInt(0) ? "−" : ""}${groupedInteger.format(absolute / scale)}${fraction ? "," + String(fraction).padStart(2, "0") : ""}\u00a0₽`;
}

export function chargeBalance(charge: { amountRub: string; entries: { kind: string; amountRub: string }[] }): bigint {
  return charge.entries.reduce((balance, entry) => {
    const amount = decodeRubles(entry.amountRub);
    return entry.kind === "PAYMENT" ? balance - amount : balance + amount;
  }, decodeRubles(charge.amountRub));
}
