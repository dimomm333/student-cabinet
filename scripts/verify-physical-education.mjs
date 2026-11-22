import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import { hashPassword } from "better-auth/crypto";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { executePhysicalCommand } from "../src/lib/physical-education-commands.ts";
import { physicalStudent, physicalWorkspace } from "../src/lib/physical-education-queries.ts";
import { authorizePlan, calculateStudent, getBrsWorkspace } from "../src/lib/brs-repository.ts";
import { executeBrsCommand } from "../src/lib/brs-commands.ts";
import { getPersonalScheduleData, getPublicScheduleData } from "../src/lib/schedule-repository.ts";
import { currentAcademicDate, DAY_MS, isoDate, mondayOf, parseScheduleQuery } from "../src/lib/schedule-calendar.ts";
import { fingerprint, integrity } from "./database-snapshot.mjs";
import { demoStudent, demoTeacher, readyStudent, newPhysicalAccounts, demoGroupCodes, seedPhysicalEducation } from "./physical-education-demo-data.mjs";
import { provisionTestDatabase } from "./test-fixtures.mjs";

const source = createClient({ url: getDatabaseUrl() });
const before = await fingerprint(source);
mkdirSync(".local", { recursive: true, mode: 0o700 });
const folder = mkdtempSync(resolve(".local/physical-education-test-"));
const screenshots = resolve(folder, "screenshots");
mkdirSync(screenshots);
const env = provisionTestDatabase(resolve(folder, "test.db"));
process.env.DATABASE_URL = env.DATABASE_URL;
const fixture = createClient({ url: env.DATABASE_URL });
await fixture.execute("PRAGMA journal_mode = WAL");
const db = createPrismaClient();
const extraPasswords = Object.fromEntries(newPhysicalAccounts.map(({ email }) => [email, randomBytes(24).toString("base64url")]));
const hashes = Object.fromEntries(await Promise.all(Object.entries(extraPasswords).map(async ([email, password]) => [email, await hashPassword(password)])));
const reports = [];
function pass(title) { reports.push(title); console.info("PASS: " + title); }
const command = (actor, operation, values) => executePhysicalCommand(db, actor, {
  operation, requestId: randomUUID(),
  fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? value : [String(value)]])),
});
const addDays = (date, days) => new Date(+date + days * DAY_MS);
const flatten = result => result.days.flatMap(day => day.lessons);
const rejected = (promise, message) => assert.rejects(promise, message);

let browser, child, logs = "";
try {
  assert((await seedPhysicalEducation(db, hashes)).inserted);
  assert(!(await seedPhysicalEducation(db, hashes)).inserted);
  await integrity(fixture);
  pass("Isolated migration, demo coherence and repeated seeding");

  const probe = createServer();
  await new Promise((ok, fail) => { probe.once("error", fail); probe.listen(0, "127.0.0.1", ok); });
  const port = probe.address().port;
  await new Promise(ok => probe.close(ok));
  const base = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, ...env, NODE_ENV: "production", BETTER_AUTH_URL: base,
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), AUTH_TRUST_PROXY: "false", AUTH_PROXY_SECRET: "",
      NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", data => { logs += data; });
  child.stderr.on("data", data => { logs += data; });
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt++) {
    assert.equal(child.exitCode, null, "Изолированный сервер завершился.");
    try { ready = (await fetch(base + "/login", { signal: AbortSignal.timeout(3000) })).ok; } catch {}
    if (!ready) await delay(250);
  }
  assert(ready, "Изолированный production-сервер недоступен.");
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
  const browserErrors = [];
  const users = {};
  async function signIn(key, email) {
    const account = demoAccounts.find(row => row.email === email);
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", colorScheme: "light" });
    const response = await context.request.post(base + "/api/auth/sign-in/email", {
      headers: { Origin: base }, data: { email, password: account ? env[account.passwordEnv] : extraPasswords[email] },
    });
    assert(response.ok(), "Вход в изолированный аккаунт " + key + ": " + response.status());
    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true, role: true } });
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const page = await context.newPage();
    page.on("pageerror", error => browserErrors.push(error.message));
    users[key] = { context, page, actor: { ...user, sessionId: session.id } };
  }
  const identities = { alex: "alexander.smirnov@example.test", maria: "maria.volkova@example.test", nikita: demoStudent.email, elena: readyStudent.email,
    teacher: "mikhail.sokolov@example.test", otherTeacher: demoTeacher.email, admin: "irina.lebedeva@example.test",
    deanery: "olga.kuznetsova@example.test", staff: "sergey.petrov@example.test" };
  for (const [key, email] of Object.entries(identities)) await signIn(key, email);
  const [a, b, c] = await Promise.all(demoGroupCodes.map(code => db.peGroup.findFirstOrThrow({
    where: { plan: { group: { code } } }, include: { plan: { include: { term: true, group: true } } },
  })));
  const go = async (user, path, heading = "Физкультура") => {
    await user.page.goto(base + path);
    await expect(user.page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await user.page.evaluate(() => document.fonts.ready.then(() => true));
  };
  const reveal = async (user, id) => {
    const tab = user.page.locator('[role="tab"][id$="-tab-' + id + '"]');
    if (await tab.count()) {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      return user.page.locator("#" + id);
    }
    const section = user.page.locator("#" + id);
    if (!await section.evaluate(element => element.open)) await section.locator(":scope > summary").click();
    await expect(section).toHaveAttribute("open", "");
    return section;
  };
  const shot = async (user, filename, id) => {
    if (id) {
      const section = await reveal(user, id);
      await section.evaluate(element => element.scrollIntoView({ block: "start" }));
    }
    await user.page.screenshot({ path: resolve(screenshots, filename + ".png") });
  };
  const anonymous = await browser.newContext();
  const anon = await anonymous.newPage();
  await anon.goto(base + "/dashboard/sports");
  await anon.waitForURL(base + "/login");
  await anonymous.close();
  await users.staff.page.goto(base + "/admin/sports");
  await users.staff.page.waitForURL(base + "/staff");
  await users.otherTeacher.page.goto(base + "/teacher/sports?group=" + a.id);
  await expect(users.otherTeacher.page.getByRole("heading", { level: 1, name: "Физкультура" })).toHaveCount(0);
  await go(users.alex, "/dashboard/sports");
  const overview = users.alex.page.getByRole("region", { name: "Сводка по физкультуре" });
  await expect(overview).toContainText("25 / 25");
  await expect(overview).toContainText("62 / 100");
  await expect(overview).toContainText("Зачтено");
  await go(users.elena, "/dashboard/sports");
  await expect(users.elena.page.locator("#summary")).toContainText("62 / 100");
  await expect(users.elena.page.locator("#summary")).toContainText("Зачтено");
  await shot(users.elena, "01-student");
  await expect(await reveal(users.alex, "choose")).toContainText("Нет свободных мест");
  await shot(users.alex, "02-group-selection", "choose");
  await reveal(users.alex, "my-group");
  const scheduleSection = await reveal(users.alex, "semester-schedule");
  assert(await scheduleSection.locator("li").count() >= 34);
  await shot(users.alex, "03-semester-schedule", "semester-schedule");
  await expect(await reveal(users.alex, "attendance")).toContainText("Посещаемость 50/70");
  await shot(users.alex, "04-attendance-points", "attendance");
  await expect(await reveal(users.alex, "standards")).toContainText("Техника передачи мяча");
  await shot(users.alex, "05-standards", "standards");
  const makeupSection = await reveal(users.alex, "makeups");
  await expect(makeupSection).toContainText("Посещение подтверждено");
  await expect(makeupSection).toContainText("Занятие отменено");
  await shot(users.alex, "06-makeup-booking", "makeups");
  await go(users.teacher, "/teacher/sports?group=" + a.id);
  await expect(users.teacher.page.locator("#schedule-journal")).toContainText("Александр Смирнов");
  await shot(users.teacher, "07-teacher-journal", "schedule-journal");
  await go(users.admin, "/admin/sports?group=" + a.id);
  await expect(users.admin.page.locator("#roster")).toContainText("62 / 100");
  await shot(users.admin, "08-administration");
  await go(users.deanery, "/deanery/sports?group=" + a.id);
  await go(users.maria, "/dashboard/sports");
  assert.equal((await physicalStudent(db, users.maria.actor, "")).current.id, b.id);
  await expect(users.maria.page.locator("#summary")).toContainText("24 / 25");
  await expect(users.maria.page.locator("#summary")).toContainText("69 / 100");
  await expect(await reveal(users.maria, "control")).toContainText("Контроль техники упражнений");
  await go(users.nikita, "/dashboard/sports");
  await expect(users.nikita.page.locator("#summary")).toContainText("Не хватает баллов");
  await go(users.alex, "/dashboard/grades?planId=" + a.planId, "Успеваемость");
  await expect(users.alex.page.locator(".brs-workspace")).toContainText("Физкультура");
  await expect(users.alex.page.locator(".brs-workspace")).toContainText("62");
  await go(users.alex, "/dashboard/session?planId=" + a.planId, "Сессия");
  await expect(users.alex.page.locator('[data-plan="' + a.planId + '"]')).toContainText("Итог: Зачтено");
  const lastMonth = isoDate(addDays(mondayOf(a.plan.term.endsOn), -14));
  await go(users.alex, "/dashboard/schedule?week=" + lastMonth, "Расписание");
  await expect(users.alex.page.getByText("Физкультура", { exact: true }).last()).toBeVisible();
  pass("Five roles, private groups, student demo, full semester, BRS grades/credit and eight screenshots");

  for (const [user, path] of [[users.alex, "/dashboard/sports"], [users.teacher, "/teacher/sports?group=" + a.id],
    [users.admin, "/admin/sports?group=" + a.id], [users.deanery, "/deanery/sports?group=" + a.id]]) {
    await go(user, path);
    for (const theme of ["light", "dark"]) {
      await user.page.emulateMedia({ colorScheme: theme });
      await expect(user.page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const width of [346, 360, 390, 768, 1366]) {
        await user.page.setViewportSize({ width, height: 900 });
        const fits = await user.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        assert(fits, "Горизонтальное переполнение " + path + " / " + width + " / " + theme);
        if (user === users.alex && width === 346) {
          const start = await user.page.evaluate(() => performance.timeOrigin);
          await reveal(user, "choose");
          for (const selector of [".pe-tabs", ".pe-group-list"]) {
            assert(await user.page.locator(selector).evaluate(element => {
              element.scrollLeft = 150;
              return element.scrollWidth > element.clientWidth && element.scrollLeft > 0;
            }));
          }
          await expect(user.page.locator("#my-group")).toHaveCount(0);
          assert.equal(await user.page.evaluate(() => performance.timeOrigin), start);
        }
      }
    }
  }
  pass("Light/dark and widths 346, 360, 390, 768 and 1366 across four cabinets");

  const { alex, maria, nikita, teacher, otherTeacher, admin, deanery, staff } = Object.fromEntries(Object.entries(users).map(([key, value]) => [key, value.actor]));
  const today = currentAcademicDate();
  const week = mondayOf(today);
  const far = parseScheduleQuery({ week: lastMonth });
  assert.equal(flatten(await getPersonalScheduleData(db, far, alex)).filter(row => row.discipline === "Физкультура").length, 2);
  assert(flatten(await getPersonalScheduleData(db, far, teacher)).some(row => row.discipline === "Физкультура"));
  const publicPairs = flatten(await getPublicScheduleData(db, parseScheduleQuery({ week: lastMonth, view: "teacher", teacher: "mikhail-sokolov" })));
  assert(!publicPairs.some(row => row.discipline === "Физкультура" || row.discipline === "Отработка по физкультуре"));
  await rejected(physicalWorkspace(db, otherTeacher, a.id, "", ""), /недоступна/);
  await rejected(command(staff, "assign-health", { studentId: alex.id, category: "SPECIAL" }), /закрыт/);
  await rejected(command(maria, "submit-transfer", { groupId: a.id }), /группе здоровья/);
  await rejected(command(alex, "assign-health", { studentId: alex.id, category: "SPECIAL" }), /недоступно/);
  const deaneryLinks = await db.deaneryDepartmentAssignment.findMany({ where: { userId: deanery.id } });
  assert(deaneryLinks.length);
  await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: deanery.id } });
  assert.equal((await physicalWorkspace(db, deanery, "", "", "")).groups.length, 0);
  await rejected(command(deanery, "assign-health", { studentId: alex.id, category: "SPECIAL" }), /недоступен/);
  await db.deaneryDepartmentAssignment.createMany({ data: deaneryLinks });
  const assignment = await db.teachingAssignment.findFirstOrThrow({ where: { groupId: a.plan.groupId, teacherId: teacher.id } });
  await db.teachingAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
  await rejected(command(teacher, "create-work", { groupId: a.id }), /назначение отсутствует/);
  await db.teachingAssignment.update({ where: { id: assignment.id }, data: { isActive: true } });
  assert(!(JSON.stringify(await physicalWorkspace(db, teacher, a.id, "", "")).includes("адаптированные задания")));
  assert(!(JSON.stringify(await physicalStudent(db, alex, "")).includes("адаптированные задания")));
  pass("Schedule privacy, health compatibility, unauthorized changes and live revocation");

  const openRows = (await physicalStudent(db, alex, "")).makeups.filter(row => row.opened);
  const booked = openRows.find(row => row.booked), available = openRows.find(row => !row.booked);
  assert(booked && available);
  const occupiedWeek = parseScheduleQuery({ week: booked.date });
  assert(flatten(await getPersonalScheduleData(db, occupiedWeek, alex)).some(row => row.discipline === "Отработка по физкультуре"));
  await rejected(command(nikita, "book", { groupId: a.id, makeupId: booked.id }), /Нет свободных мест/);
  await go(users.alex, "/dashboard/sports");
  const availableCard = (await reveal(users.alex, "makeups")).locator("article").filter({ hasText: available.date.split("-").reverse().join(".") });
  await availableCard.getByRole("button", { name: "Записаться на отработку" }).click();
  await expect(availableCard.getByText("Вы записаны")).toBeVisible();
  await availableCard.getByRole("button", { name: "Отменить запись" }).click();
  await expect(availableCard.getByText("Запись отменена", { exact: true })).toBeVisible();
  const room = await db.room.findFirstOrThrow({ where: { building: { code: "pe-demo-sports" }, number: "Зал 2" } });
  const bookedMonday = mondayOf(new Date(booked.date));
  const extras = [];
  for (const [offset, start, end] of [[1, "18:25", "18:55"], [2, "18:25", "18:55"]]) {
    const date = isoDate(addDays(bookedMonday, offset));
    extras.push(await command(teacher, "create-makeup", { groupId: a.id, date, until: date, start, end, capacity: 3, roomId: room.id }));
  }
  await command(alex, "book", { groupId: a.id, makeupId: extras[0] });
  await rejected(command(alex, "book", { groupId: a.id, makeupId: extras[1] }), /две отработки/);
  const makeup = await db.peMakeup.findUniqueOrThrow({ where: { id: extras[0] } });
  await rejected(command(teacher, "attendance", { groupId: a.id, slot: "extra:" + makeup.exceptionId,
    students: [alex.id], mark: "PRESENT", ["version-" + alex.id]: 0 }), /проведённое занятие/);
  await command(teacher, "cancel-slot", { groupId: a.id, slot: "extra:" + makeup.exceptionId, version: 1 });
  await command(alex, "book", { groupId: a.id, makeupId: extras[1] });
  const audit = await db.scheduleAudit.findFirstOrThrow({ where: { objectId: makeup.exceptionId, action: "CANCEL" } });
  const recent = await db.notification.findFirst({ where: { recipientId: alex.id, event: { source: "SCHEDULE", type: "SCHEDULE_CHANGED", sourceId: { endsWith: audit.id } } } });
  assert(recent);
  const afterCancel = flatten(await getPersonalScheduleData(db, parseScheduleQuery({ week: isoDate(bookedMonday) }), alex));
  assert(afterCancel.some(row => row.discipline === "Отработка по физкультуре" && row.change?.cancelled));
  pass("Browser booking and withdrawal, capacity, weekly limit, future attendance rejection, cancellation and notification");

  const standard = await db.brsEvent.findFirstOrThrow({ where: { kind: "STANDARD", module: { planId: a.planId } } });
  const version = (await db.brsResult.findUniqueOrThrow({ where: { eventId_studentId: { eventId: standard.id, studentId: nikita.id } } })).version;
  await rejected(executeBrsCommand(db, teacher, { operation: "FINALIZE", requestId: randomUUID(), planId: a.planId, studentId: nikita.id,
    revision: (await db.brsPlan.findUniqueOrThrow({ where: { id: a.planId } })).revision, version: 0 }), /25 подтверждённых посещений и 60 баллов/);
  await go(users.teacher, "/teacher/sports?group=" + a.id);
  const journal = users.teacher.page.locator("#schedule-journal");
  const studentMark = journal.locator(".pe-journal-row").filter({ hasText: demoStudent.name });
  await expect(studentMark).toContainText("Присутствовал");
  for (const [mark, label, visits] of [["ABSENT", "Отсутствовал", 24], ["PRESENT", "Присутствовал", 25]]) {
    await studentMark.getByRole("checkbox").check();
    await journal.getByLabel("Отметка для выбранных студентов").selectOption(mark);
    await journal.getByRole("button", { name: "Сохранить отметки" }).click();
    await expect(studentMark).toContainText(label);
    const plan = await authorizePlan(db, teacher, a.planId);
    assert.equal((await calculateStudent(db, plan, nikita.id)).calculation.physical.visits, visits);
  }
  assert.equal(await db.brsAudit.count({ where: { planId: a.planId, action: "PE_ATTENDANCE_MARK", afterJson: { contains: nikita.id } } }), 27);
  const works = await reveal(users.teacher, "work");
  const edit = works.locator("details.pe-item").filter({ hasText: standard.title });
  await edit.locator("summary").click();
  const editResult = edit.locator("form").filter({ hasText: demoStudent.name });
  await editResult.getByLabel("Баллы").fill("10");
  await editResult.getByRole("button", { name: "Сохранить результат" }).click();
  await expect(editResult.getByRole("status")).toContainText("Сохранено");
  assert.equal((await db.brsResult.findUniqueOrThrow({ where: { eventId_studentId: { eventId: standard.id, studentId: nikita.id } } })).version, version + 1);
  const currentPlan = await authorizePlan(db, teacher, a.planId);
  assert.equal((await calculateStudent(db, currentPlan, nikita.id)).calculation.total, 6000);
  await go(users.teacher, "/teacher/session?planId=" + a.planId, "Сессия");
  const sessionCard = users.teacher.page.locator('[data-student="' + nikita.id + '"]');
  await sessionCard.getByRole("button", { name: "Зафиксировать итог" }).click();
  await expect(sessionCard).toContainText("Зачтено");
  await expect.poll(() => db.brsFinal.count({ where: { planId: a.planId, studentId: nikita.id, grade: "Зачтено" } })).toBe(1);
  await go(users.nikita, "/dashboard/session?planId=" + a.planId, "Сессия");
  await expect(users.nikita.page.locator('[data-plan="' + a.planId + '"]')).toContainText("Итог: Зачтено");
  pass("Browser grading and official credit at exactly 25 visits and 60 points without interim control");

  const closure = { groupId: c.id, name: c.name, directionId: c.directionId, capacity: 1, from: isoDate(c.registrationFrom),
    until: isoDate(c.registrationUntil), category: ["MAIN", "PREPARATORY", "SPECIAL", "INDIVIDUAL"] };
  await command(admin, "update-group", closure);
  await rejected(command(alex, "enroll", { groupId: c.id }), /заявку на перевод/);
  const scheduleBefore = await getPersonalScheduleData(db, far, alex);
  const firstRequest = await command(alex, "submit-transfer", { groupId: c.id });
  await rejected(command(alex, "submit-transfer", { groupId: c.id }), /уже есть заявка/);
  await rejected(command(nikita, "cancel-transfer", { transferId: firstRequest }), /недоступна/);
  await rejected(command(alex, "approve-transfer", { transferId: firstRequest }), /недоступно/);
  await rejected(command(admin, "approve-transfer", { transferId: firstRequest }), /недоступно/);
  await rejected(command(teacher, "approve-transfer", { transferId: firstRequest }), /недоступно/);
  await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: deanery.id } });
  assert.equal((await physicalWorkspace(db, deanery, "", "", "")).transfers.length, 0);
  await rejected(command(deanery, "approve-transfer", { transferId: firstRequest }), /недоступна/);
  await db.deaneryDepartmentAssignment.createMany({ data: deaneryLinks });
  assert.deepEqual(await getPersonalScheduleData(db, far, alex), scheduleBefore);
  await go(users.deanery, "/deanery/sports");
  const refusal = users.deanery.page.locator("#transfer-requests article").filter({ hasText: "Александр Смирнов" });
  await refusal.getByLabel("Причина отказа").fill("Демонстрационный отказ");
  await refusal.getByRole("button", { name: "Отклонить заявку" }).click();
  await expect(refusal).toHaveCount(0);
  assert.deepEqual(await getPersonalScheduleData(db, far, alex), scheduleBefore);
  assert.equal((await db.peTransfer.findUniqueOrThrow({ where: { id: firstRequest } })).status, "REJECTED");
  const withdrawn = await command(alex, "submit-transfer", { groupId: c.id });
  await go(users.alex, "/dashboard/sports?term=" + a.plan.termId + "#choose");
  await users.alex.page.getByRole("button", { name: "Отменить заявку" }).click();
  await expect(users.alex.page.locator("#choose")).toContainText("Отменена");
  assert.equal((await db.peTransfer.findUniqueOrThrow({ where: { id: withdrawn } })).status, "CANCELLED");
  const requests = [await command(alex, "submit-transfer", { groupId: c.id }), await command(nikita, "submit-transfer", { groupId: c.id })];
  const concurrent = await Promise.allSettled(requests.map(transferId => command(deanery, "approve-transfer", { transferId })));
  assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(await db.peEnrollment.count({ where: { groupId: c.id } }), 1);
  const winner = concurrent[0].status === "fulfilled" ? alex : nikita;
  const index = winner.id === alex.id ? 0 : 1;
  assert.equal(await db.notification.count({ where: { recipientId: winner.id, event: { sourceId: requests[index], type: "PE_TRANSFER_APPROVED" } } }), 1);
  await rejected(command(deanery, "approve-transfer", { transferId: requests[1 - index] }), /Нет свободных мест/);
  await command(index === 0 ? nikita : alex, "cancel-transfer", { transferId: requests[1 - index] });
  const picked = await db.peEnrollment.findFirstOrThrow({ where: { groupId: c.id } });
  const course = (await getBrsWorkspace(db, winner, c.planId)).overview.find(row => row.id === c.planId);
  assert.equal(course.calculation.physical.visits, 25);
  assert.equal(course.calculation.total, winner.id === alex.id ? 6200 : 6000);
  assert.equal(course.official.grade, "Зачтено");
  assert.equal((await db.peMembership.count({ where: { enrollmentId: picked.id } })), 2);
  assert.equal(await db.peEnrollment.count({ where: { studentId: winner.id, termId: c.plan.termId } }), 1);
  assert.equal(await db.brsFinal.count({ where: { planId: a.planId, studentId: winner.id } }), 0);
  await rejected(authorizePlan(db, winner, a.planId), /недоступен/);
  const next = flatten(await getPersonalScheduleData(db, parseScheduleQuery({ week: isoDate(addDays(week, 7)) }), winner))
    .filter(row => row.discipline === "Физкультура");
  assert.deepEqual(next.map(row => row.start), ["16:30", "16:30"]);
  pass("Closed registration, concurrent final seat, one enrollment, transfer history, official credit and new schedule");

  await go(users.teacher, "/teacher/sports?group=" + c.id);
  const standards = await reveal(users.teacher, "work");
  await standards.getByText("Добавить норматив или РК", { exact: true }).click();
  const newWork = standards.locator("form").filter({ has: users.teacher.page.getByRole("button", { name: "Добавить работу" }) });
  await newWork.getByLabel("Название", { exact: true }).fill("Демонстрационная координация");
  await newWork.getByLabel("Максимум баллов").fill("4");
  await newWork.getByLabel("Способ фиксации результата").fill("Учебный протокол");
  await newWork.getByLabel("Критерии оценки").fill("Выполнение задания");
  for (const category of ["Подготовительная", "Специальная", "Индивидуальный порядок занятий"]) {
    await newWork.getByRole("checkbox", { name: category, exact: true }).uncheck();
  }
  await newWork.getByRole("button", { name: "Добавить работу" }).click();
  await expect(standards.getByText("Демонстрационная координация · 4 баллов")).toBeVisible();

  const upcomingSlot = (await physicalWorkspace(db, teacher, c.id, "", "")).slots.find(slot => !slot.started && !slot.change?.cancelled);
  const movedDate = upcomingSlot.date;
  await command(teacher, "move-slot", { groupId: c.id, slot: upcomingSlot.source, version: upcomingSlot.version,
    date: movedDate, start: "16:40", end: "17:40", roomId: room.id });
  const moved = flatten(await getPersonalScheduleData(db, parseScheduleQuery({ week: movedDate }), winner))
    .find(row => row.date === movedDate && row.discipline === "Физкультура");
  assert.equal(moved?.start, "16:40");
  assert.equal(moved?.change?.type, "REPLACED");
  await command(admin, "assign-teacher", { groupId: c.id, teacherId: otherTeacher.id });
  await rejected(physicalWorkspace(db, teacher, c.id, "", ""), /недоступна/);
  assert((await physicalWorkspace(db, otherTeacher, c.id, "", "")).selected);
  assert(flatten(await getPersonalScheduleData(db, parseScheduleQuery({ week: movedDate }), otherTeacher))
    .some(row => row.date === movedDate && row.discipline === "Физкультура" && row.start === "16:40"));
  pass("Browser standard creation, exception-based rescheduling and teacher reassignment");

  const candidate = winner.id === alex.id ? users.nikita : users.alex;
  const fullName = winner.id === alex.id ? demoStudent.name : "Александр Смирнов";
  await go(users.admin, "/admin/sports?group=" + c.id);
  const create = await reveal(users.admin, "new-group");
  const form = create.locator("form");
  await form.getByLabel("Название", { exact: true }).fill("Демонстрационная адаптивная группа");
  await form.getByLabel("Спортивное направление").selectOption(c.directionId);
  await form.getByLabel("Вместимость").fill("5");
  const enterDate = async (label, date) => {
    const input = form.getByLabel(label, { exact: true });
    await input.fill(date.split("-").reverse().join("."));
    await input.blur();
  };
  await enterDate("Начало записи", isoDate(c.registrationFrom));
  await enterDate("Конец записи включительно", isoDate(c.registrationUntil));
  await form.getByRole("checkbox", { name: "Набор открыт" }).check();
  await form.getByRole("checkbox", { name: "Специальная", exact: true }).check();
  await form.getByLabel("Код группы").fill("ДЕМО-ПРОВЕРКА-04");
  await form.getByLabel("Подразделение").selectOption(c.plan.group.departmentId);
  await form.locator('select[name="termId"]').selectOption(c.plan.termId);
  await form.locator('select[name="teacherId"]').selectOption(teacher.id);
  for (const [index, day] of [[0, "2"], [1, "5"]]) {
    const weekly = form.locator(".pe-weekly-fields").nth(index);
    await weekly.getByLabel("День недели").selectOption(day);
    await weekly.getByLabel("Начало", { exact: true }).fill("19:40");
    await weekly.getByLabel("Окончание", { exact: true }).fill("20:25");
    await weekly.getByLabel("Место проведения").selectOption(room.id);
  }
  await form.getByRole("button", { name: "Создать группу" }).click();
  await expect(form.getByRole("status")).toContainText("Сохранено");
  const freshGroup = await db.peGroup.findFirstOrThrow({ where: { plan: { group: { code: "ДЕМО-ПРОВЕРКА-04" } } } });

  const studentSettings = await reveal(users.admin, "students");
  await studentSettings.getByLabel("Поиск студента").fill(fullName);
  await studentSettings.getByRole("button", { name: "Найти" }).click();
  const candidateCard = users.admin.page.locator("#students article").filter({ has: users.admin.page.getByRole("heading", { name: fullName }) });
  await candidateCard.getByLabel("Группа здоровья").selectOption("SPECIAL");
  await candidateCard.getByLabel("Особые условия зачёта").fill("Учебный сценарий с адаптированным заданием");
  await candidateCard.getByRole("button", { name: "Назначить группу здоровья" }).click();
  await expect(candidateCard.getByRole("status")).toContainText("Сохранено");
  assert((await physicalStudent(db, candidate.actor, "")).schedule.every(slot => slot.started || slot.change?.cancelled));
  await go(candidate, "/dashboard/sports");
  const selected = (await reveal(candidate, "choose")).locator("article").filter({ hasText: "ДЕМО-ПРОВЕРКА-04" });
  await selected.getByRole("button", { name: "Подать заявку на перевод" }).click();
  await expect(candidate.page.locator("#choose")).toContainText("На рассмотрении");
  await expect(candidate.page.locator("#summary")).toContainText(a.plan.group.code);
  await go(users.deanery, "/deanery/sports");
  const review = users.deanery.page.locator("#transfer-requests article").filter({ hasText: fullName });
  await review.getByRole("button", { name: "Одобрить перевод" }).click();
  await expect(review).toHaveCount(0);
  await candidate.page.reload();
  await expect(candidate.page.locator("#summary")).toContainText("ДЕМО-ПРОВЕРКА-04");
  assert.equal(await db.peEnrollment.count({ where: { groupId: freshGroup.id, studentId: candidate.actor.id } }), 1);
  const newcomerId = "pe-test-newcomer";
  const newcomerPassword = randomBytes(24).toString("base64url");
  const newcomer = await db.user.create({ data: { id: newcomerId, name: "Новый студент регрессии", email: "pe.newcomer@example.test", role: "STUDENT", emailVerified: true,
    studentProfile: { create: { groupId: (await db.studentProfile.findUniqueOrThrow({ where: { userId: alex.id } })).groupId } },
    accounts: { create: { providerId: "credential", accountId: newcomerId, password: await hashPassword(newcomerPassword) } },
  } });
  extraPasswords[newcomer.email] = newcomerPassword;
  await command(admin, "assign-health", { studentId: newcomer.id, category: "SPECIAL" });
  await signIn("newcomer", newcomer.email);
  await go(users.newcomer, "/dashboard/sports");
  const firstGroup = users.newcomer.page.locator("#choose article").filter({ hasText: "ДЕМО-ПРОВЕРКА-04" });
  await firstGroup.getByRole("button", { name: "Записаться", exact: true }).click();
  await expect(users.newcomer.page.locator("#summary")).toContainText("ДЕМО-ПРОВЕРКА-04");
  assert.equal(await db.peTransfer.count({ where: { enrollment: { studentId: newcomer.id } } }), 0);
  pass("Browser group creation, health assignment, scoped transfer approval and automatic first enrollment");

  await integrity(fixture);
  assert.equal(browserErrors.length, 0, browserErrors.join("\n"));
  assert(!/Blocking Route|Instant validation|Could not validate `instant`/.test(logs), "В журнале есть предупреждения Next.js.");
  assert.equal(await fingerprint(source), before);
  pass("Isolated database integrity and original data unchanged");
} finally {
  await browser?.close();
  child?.kill();
  await db.$disconnect();
  fixture.close();
  source.close();
  writeFileSync(resolve(folder, "results.json"), JSON.stringify({ reports, screenshots }, null, 2), { mode: 0o600 });
  writeFileSync(resolve(folder, "server.log"), logs, { mode: 0o600 });
  console.info("Результаты: " + folder);
}
