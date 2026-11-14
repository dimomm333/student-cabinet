import type { Prisma } from "../src/generated/prisma/client.ts";

// Explicit fixture ownership, not an inference from prefixes or faculty names.
// Only the well-known seed IDs with an empty link may be filled.
export async function seedDemoScheduleLinks(tx: Prisma.TransactionClient) {
  for (const [id, slug, name] of [
    ["demo-group-pi-24-1", "pi-24-1", "Учебная кафедра"],
    ["demo-group-pi-24-2", "pi-24-2", "Учебная кафедра"],
    ["demo-group-it-25-1", "it-25-1", "Кафедра информационных технологий"],
  ]) {
    const group = await tx.studyGroup.findFirst({ where: { id, slug, departmentId: null }, select: { id: true } });
    if (!group) continue;
    const department = await tx.academicDepartment.upsert({ where: { faculty_name: { faculty: "Институт цифровых технологий", name } }, update: {}, create: { faculty: "Институт цифровых технологий", name } });
    await tx.studyGroup.updateMany({ where: { id, slug, departmentId: null }, data: { departmentId: department.id } });
  }
}
