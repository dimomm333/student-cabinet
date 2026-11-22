import "server-only";
import { fail } from "./brs-repository.ts";
import { healthLabels } from "./physical-education-rules.ts";
import { parseCalendarDate } from "./schedule-calendar.ts";
import type { PeHealthCategory } from "../generated/prisma/enums.ts";

export type PhysicalCommand = { operation: string; requestId: string; fields: Record<string, string[]> };

export class PhysicalInput {
  readonly #fields: PhysicalCommand["fields"];

  constructor(fields: PhysicalCommand["fields"]) {
    this.#fields = fields;
  }
  value(key: string, max = 128, required = true) {
    const values = Object.hasOwn(this.#fields, key) ? this.#fields[key] : [];
    const value = values[0]?.trim() ?? "";
    if (values.length > 1 || value.length > max || required && !value) fail("Заполните обязательные поля и проверьте длину значений.");
    return value;
  }
  values(key: string) {
    const values = Object.hasOwn(this.#fields, key) ? this.#fields[key] : [];
    if (values.length > 501 || values.some(value => !value || value.length > 128)) fail("Слишком много значений или некорректный идентификатор.");
    return [...new Set(values)];
  }
  number(key: string, min: number, max: number) {
    const value = this.value(key);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) fail("Числовое значение вне допустимого диапазона.");
    return Number(value);
  }
  date(key: string) {
    return parseCalendarDate(this.value(key)) ?? fail("Выберите существующую дату.");
  }
  categories() {
    const values = this.values("category");
    if (!values.length || values.some(value => !Object.hasOwn(healthLabels, value))) fail("Выберите допустимые группы здоровья.");
    return values as PeHealthCategory[];
  }
  time() {
    const minute = (key: string) => {
      const input = this.value(key);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input)) fail("Укажите время занятия.");
      const [hour, minutes] = input.split(":").map(Number);
      return hour * 60 + minutes;
    };
    const startMinute = minute("start"), endMinute = minute("end");
    if (startMinute >= endMinute) fail("Окончание занятия должно быть позже начала.");
    return { startMinute, endMinute };
  }
}
