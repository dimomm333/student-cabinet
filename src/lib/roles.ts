import type { Role } from "@/generated/prisma/enums";

export const roleHomes: Record<Role, string> = {
  STUDENT: "/dashboard",
  TEACHER: "/teacher",
  TECHNICAL_STAFF: "/staff",
  ADMIN: "/admin",
};

export const roleLabels: Record<Role, string> = {
  STUDENT: "Студент",
  TEACHER: "Преподаватель",
  TECHNICAL_STAFF: "Технический персонал",
  ADMIN: "Администратор",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.hasOwn(roleHomes, value);
}
