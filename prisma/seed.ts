import { Role } from "../src/generated/prisma/enums.ts";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { hashPassword } from "better-auth/crypto";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { practicalDemoNews, seedSchedule } from "./schedule-seed.ts";
import { seedDemoScheduleLinks } from "./schedule-demo-links.ts";

const prisma = createPrismaClient();
const deaneryOnly = process.argv.includes("--deanery-only");
const scheduleLinksOnly = process.argv.includes("--schedule-links-only");

const credentialsPath = ".env.demo.local";
const localPasswords = existsSync(credentialsPath) ? parse(readFileSync(credentialsPath, "utf8")) : {};

function demoPassword(key: string) {
  const password = process.env[key] ?? localPasswords[key] ?? randomBytes(24).toString("base64url");
  if (password.length < 12 || password.length > 128) throw new Error(`${key}: требуется пароль длиной 12–128 символов.`);
  if (!process.env[key] && !localPasswords[key]) {
    // Persist before committing its hash so a crash cannot lose a generated password.
    appendFileSync(credentialsPath, `${key}=${JSON.stringify(password)}\n`, { mode: 0o600 });
    localPasswords[key] = password;
  }
  return password;
}

async function main() {
  const prepared: { identity: { name: string; email: string; role: Role }; password: string | null }[] = [];
  for (const { passwordEnv, ...identity } of demoAccounts) {
    if (scheduleLinksOnly) continue;
    if (deaneryOnly && identity.role !== Role.DEANERY_STAFF) continue;
    const existing = await prisma.user.findUnique({ where: { email: identity.email } });
    if (existing && existing.role !== identity.role) {
      throw new Error(`Роль ${identity.email} изменена. Seed не перезаписывает роли; проверьте аккаунт вручную.`);
    }
    const account = existing && await prisma.account.findUnique({
      where: { providerId_accountId: { providerId: "credential", accountId: existing.id } },
    });
    prepared.push({ identity, password: account?.password ? null : await hashPassword(demoPassword(passwordEnv)) });
  }

  // No cleanup or password reset. Only the three managed demo news are refreshed.
  await prisma.$transaction(async (tx) => {
    for (const { identity, password } of prepared) {
      const user = await tx.user.upsert({ where: { email: identity.email }, update: {}, create: identity });
      if (password) {
        await tx.account.upsert({
          where: { providerId_accountId: { providerId: "credential", accountId: user.id } },
          update: { password },
          create: { userId: user.id, providerId: "credential", accountId: user.id, password },
        });
      }
      if (user.role === Role.STUDENT) {
        const defaults = { institute: "Институт цифровых технологий", program: "Прикладная информатика", groupName: "ПИ-24-1", course: 2, studyMode: "Очная форма" };
        const profile = await tx.studentProfile.findUnique({ where: { userId: user.id } });
        const missing = Object.fromEntries(Object.entries(defaults).filter(([key]) => profile?.[key as keyof typeof defaults] == null));
        await tx.studentProfile.upsert({ where: { userId: user.id }, update: missing, create: { userId: user.id, ...defaults } });
      }
      if (user.role === Role.TEACHER) {
        await tx.teacherProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, department: "Кафедра информатики", position: "Старший преподаватель" } });
      }
      if (user.role === Role.TECHNICAL_STAFF) {
        await tx.technicalStaffProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, department: "Служба эксплуатации кампуса", jobTitle: "Инженер" } });
      }
      if (user.role === Role.DEANERY_STAFF) {
        // Initial explicit assignment only. Re-running seed never re-grants
        // revoked assignments and never infers scope from legacy group names.
        const profile = await tx.deaneryStaffProfile.findUnique({ where: { userId: user.id } });
        if (!profile) {
          const department = await tx.academicDepartment.upsert({
            where: { faculty_name: { faculty: "Институт цифровых технологий", name: "Учебная кафедра" } }, update: {},
            create: { faculty: "Институт цифровых технологий", name: "Учебная кафедра" },
          });
          await tx.deaneryStaffProfile.create({ data: { userId: user.id, position: "Специалист деканата", departments: { create: { departmentId: department.id } } } });
        }
      }
    }
    if (!deaneryOnly && !scheduleLinksOnly) {
      for (const item of practicalDemoNews) await tx.news.upsert({ where: { id: item.id }, update: item, create: item });
      await seedSchedule(tx);
    }
    if (!deaneryOnly) await seedDemoScheduleLinks(tx);
  });

  const [userCount, newsCount] = await Promise.all([
    prisma.user.count(),
    prisma.news.count(),
  ]);
  console.info(`База заполнена. Пользователей: ${userCount}; новостей: ${newsCount}.`);
  console.info("Пароли заданы через DEMO_*_PASSWORD или сохранены только в игнорируемом .env.demo.local. Существующие хеши не изменены. Дополнительные преподаватели расписания не имеют паролей для входа.");
}

main()
  .catch((error: unknown) => {
    console.error("Не удалось заполнить базу данных:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
