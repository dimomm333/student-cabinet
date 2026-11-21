import "server-only";
import type { DormPermission } from "../generated/prisma/client.ts";
import { requireDormGrant, type DormDB, type DormUser } from "./dormitory-access.ts";
import { DormError, type DormAction } from "./dormitory-shared.ts";
import { emitNotification } from "./notifications-repository.ts";

export type DormFileInput = { key: string; name: string; size: number; mime: string; sha256: string };
export type DormCommandInput = { action: DormAction; key: string; fields: Record<string, string>; file?: DormFileInput };
export type DormContext = {
  db: DormDB;
  user: DormUser;
  input: DormCommandInput;
  now: Date;
  audit: (targetId: string, detail?: string) => Promise<{ id: string }>;
};
export const value = (c: DormContext, name: string, max = 500, required = true) => {
  const raw = c.input.fields[name] ?? "";
  const s = raw.trim();
  if (s.length > max || (required && !s) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) {
    throw new DormError("Проверьте обязательные поля и длину текста.");
  }
  return s;
};
export const int = (c: DormContext, name: string, min: number, max: number) => {
  const s = value(c, name, 12);
  const n = Number(s);
  if (!/^-?\d+$/.test(s) || !Number.isSafeInteger(n) || n < min || n > max) throw new DormError("Число вне допустимого диапазона.");
  return n;
};
export function date(c: DormContext, name: string, required = true) {
  const s = value(c, name, 10, required);
  if (!s) return null;
  const d = new Date(s + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new DormError("Укажите корректную дату.");
  return d;
}
export function choice<T extends string>(c: DormContext, name: string, options: readonly T[]) {
  const s = value(c, name, 80);
  const result = options.find(item => item === s);
  if (result === undefined) throw new DormError("Выберите допустимое значение.");
  return result;
}
export const flag = (c: DormContext, name: string) => c.input.fields[name] === "on";
export const requireGrant = (c: DormContext, dormId: string, ...permissions: DormPermission[]) =>
  requireDormGrant(c.db, c.user, dormId, ...permissions);

export async function dormNotice(c: DormContext, id: string, title: string, students: string[], repairId?: string, assignees: DormUser[] = []) {
  await emitNotification(c.db, {
    sourceKey: `dorm:${c.user.id}:${c.input.key}`, source: "DORMITORY", sourceId: id, dormRepairId: repairId,
    type: c.input.action, category: "DORMITORY", title, body: "Подробности доступны в разделе «Общежитие».",
    mandatory: false, recipients: [
      ...students.map(id => ({ id, role: "STUDENT" as const, href: repairId ? "/dashboard/dormitory#repairs" : "/dashboard/dormitory" })),
      ...assignees.map(user => ({ ...user, href: user.role === "ADMIN" ? "/admin/dormitory?tab=repairs" : "/staff/dormitory?tab=repairs" })),
    ],
  });
}
