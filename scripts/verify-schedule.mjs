import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { hashPassword } from "better-auth/crypto";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { getPublicScheduleData, getPersonalScheduleData, groupScope } from "../src/lib/schedule-repository.ts";
import { academicWeeks, filterScheduleChoices, scheduleHref, currentAcademicDate, isoDate, mondayOf, parseCalendarDate, parseDateInput, formatDateInput, shiftCalendarMonth, parseScheduleQuery, weekParity, weekRangeLabel } from "../src/lib/schedule-calendar.ts";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { roleHomes } from "../src/lib/roles.ts";
import { provisionTestDatabase } from "./test-fixtures.mjs";

mkdirSync(".local", { recursive: true });
const root = mkdtempSync(resolve(".local/schedule-test-"));
const databaseURL = `file:${resolve(root, "test.db").replaceAll("\\", "/")}`;
const sourceURL = getDatabaseUrl(); assert.notEqual(databaseURL, sourceURL);
const source = createClient({ url: sourceURL });
const tableNames = ["User", "News", "Account", "Session", "StudentProfile", "TeacherProfile", "TechnicalStaffProfile"];
async function snapshot(client) {
  const records = {};
  for (const table of tableNames) records[table] = (await client.execute(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
  return JSON.parse(JSON.stringify(records, (_, value) => typeof value === "bigint" ? value.toString() : value));
}
const baseline = await snapshot(source);
await source.execute({ sql: "VACUUM INTO ?", args: [resolve(root, "test.db")] });
let copy = createClient({ url: databaseURL });
let env = { ...process.env, DATABASE_URL: databaseURL };
const results = [];
function pass(name, evidence) { results.push({ name, ...evidence }); console.info(`PASS: ${name} ${JSON.stringify(evidence)}`); }
function run(args) {
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, `Command failed: ${args[0]}`);
}
function checkExisting(before, after, skipNews = false) {
  for (const [table, rows] of Object.entries(before)) {
    if (skipNews && table === "News") continue;
    const key = ["StudentProfile", "TeacherProfile", "TechnicalStaffProfile"].includes(table) ? "userId" : "id";
    for (const record of rows) {
      const found = after[table].find(row => row[key] === record[key]); assert(found, `Preserve ${table}`);
      for (const [field, value] of Object.entries(record)) assert(JSON.stringify(found[field]) === JSON.stringify(value), `Preserve ${table}.${field}`);
    }
  }
}
// Exercise the new SQL against the previous schema with actual session/profile
// rows even when the developer's source database has no active sessions.
const legacy = createClient({ url: `file:${resolve(root, "legacy.db").replaceAll("\\", "/")}` });
try {
  for (const migration of ["20261111211700_init", "20261112190000_shared_auth"]) await legacy.executeMultiple(readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"));
  await legacy.execute("INSERT INTO User (id, name, email, role) VALUES ('legacy-student', 'Fixture Student', 'fixture-student@example.test', 'STUDENT'), ('legacy-teacher', 'Fixture Teacher', 'fixture-teacher@example.test', 'TEACHER')");
  await legacy.execute({ sql: "INSERT INTO Session (id, token, userId, expiresAt, updatedAt) VALUES (?, ?, ?, ?, ?)", args: ["legacy-session", randomBytes(32).toString("hex"), "legacy-student", Date.now() + 3600000, Date.now()] });
  await legacy.execute("INSERT INTO StudentProfile (userId, groupName) VALUES ('legacy-student', 'Fixture Group')");
  await legacy.execute("INSERT INTO TeacherProfile (userId, department) VALUES ('legacy-teacher', 'Fixture Department')");
  await legacy.execute("INSERT INTO News (id, title, content) VALUES ('legacy-news', 'Fixture News', 'Preserve this content')");
  const previousSchemaData = await snapshot(legacy);
  await legacy.executeMultiple(readFileSync("prisma/migrations/20261113003000_shared_schedule/migration.sql", "utf8"));
  await legacy.executeMultiple(readFileSync("prisma/migrations/20261113120000_group_hierarchy/migration.sql", "utf8"));
  checkExisting(previousSchemaData, await snapshot(legacy));
  assert.equal((await legacy.execute("PRAGMA foreign_key_check")).rows.length, 0);
} finally { legacy.close(); }
run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
checkExisting(baseline, await snapshot(copy));
assert.equal((await copy.execute("PRAGMA integrity_check")).rows[0].integrity_check, "ok");
assert.equal((await copy.execute("PRAGMA foreign_key_check")).rows.length, 0);
pass("Migration and original identities/sessions", { preserved: true, activeSessionFixturePreserved: true, integrity: "ok" });
copy.close();
env = provisionTestDatabase(resolve(root, 'fixture.db'));
copy = createClient({ url: env.DATABASE_URL });
process.env.DATABASE_URL = env.DATABASE_URL;
const db = createPrismaClient();
// Missing official values in existing demo records must stay missing on reseed.
await db.studentProfile.updateMany({ data: { institute: null, citizenship: null } });
const allTables = [...tableNames, "StudyGroup", "Discipline", "Building", "Room", "AcademicTerm", "Lesson", "LessonGroup", "LessonTeacher", "ScheduleEntry"];
async function seedFingerprint() {
  const values = [];
  for (const table of allTables) values.push((await copy.execute(`SELECT * FROM "${table}" ORDER BY 1`)).rows);
  return createHash("sha256").update(JSON.stringify(values, (_, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
}
const seeded = await seedFingerprint(); run(["--env-file-if-exists=.env", "prisma/seed.ts"]);
assert.equal(await seedFingerprint(), seeded);
assert.equal(await db.news.count(), 3);
assert.equal(await db.scheduleEntry.count(), 12);
pass("Seed idempotence", { entries: 12, groups: 3, publicTeachers: 3, duplicateNews: false });

const query = overrides => parseScheduleQuery({ view: "group", group: "pi-24-1", week: "2026-11-09", ...overrides });
const read = overrides => getPublicScheduleData(db, query(overrides));
let child, logs = ""; const privateValues = [];
const base = "http://127.0.0.1:3201";
async function request(path, options = {}) {
  const response = await fetch(new URL(path, base), { redirect: "manual", ...options, signal: AbortSignal.timeout(10000) });
  const text = await response.text(); return { status: response.status, text, headers: response.headers };
}
try {
  assert.equal(parseCalendarDate("2026-02-31"), null);
  assert.equal(parseCalendarDate("2025-02-29"), null);
  assert.equal(isoDate(parseCalendarDate("2024-02-29")), "2024-02-29");
  assert.equal(isoDate(currentAcademicDate(new Date("2026-11-12T22:30:00Z"))), "2026-11-13");
  assert.equal(isoDate(mondayOf(new Date("2026-11-15T00:00:00Z"))), "2026-11-09");
  assert.equal(weekParity(new Date("2026-11-09"), new Date("2026-08-31")), "NUMERATOR");
  assert.equal(weekParity(new Date("2026-11-16"), new Date("2026-08-31")), "DENOMINATOR");
  assert.equal(weekParity(new Date("2026-08-24"), new Date("2026-08-31")), "DENOMINATOR");
  assert.equal(weekRangeLabel("2026-12-28", "2027-01-03"), "28 декабря 2026 — 3 января 2027");
  for (const value of ["", "1", "12.11.", "2026-11-12", "1.11.2026", "31.04.2026", "29.02.2027", "01.01.2100"]) assert.equal(parseDateInput(value), null);
  assert.equal(isoDate(parseDateInput("29.02.2028")), "2028-02-29");
  assert.equal(formatDateInput("2026-01-09"), "09.01.2026");
  for (const [from, offset, expected] of [["2026-12-31", 1, "2027-01-31"], ["2027-01-31", -1, "2026-12-31"], ["2028-01-31", 1, "2028-02-29"], ["2027-03-31", -1, "2027-02-28"]]) assert.equal(isoDate(shiftCalendarMonth(parseCalendarDate(from), offset)), expected);
  pass("Calendar", { invalidDatesRejected: true, leapYear: true, moscowMidnight: true, negativeWeekParity: true, dateInput: true, monthAndYearTransitions: true });

  const weeks = academicWeeks("2026-09-01", "2027-06-30");
  assert.equal(weeks[0].number, 1); assert.equal(weeks[0].start, "2026-08-31");
  assert.equal(weeks.at(-1).start, "2027-06-28");
  assert.equal(weeks.find(w => w.start === "2027-01-04").number, 19);
  for (const week of weeks) assert.equal(isoDate(mondayOf(parseCalendarDate(week.start))), week.start);
  assert.deepEqual(academicWeeks("2027-01-01", "2026-01-01"), []);
  assert.deepEqual(academicWeeks("2026-02-31", "2026-06-01"), []);
  const catalogue = [{ slug: "sm7", name: "СМ7" }, { slug: "other", name: "Другая группа" }];
  for (const text of ["см7", "СМ7", "См7", "  см7  ", "\tСМ7\n"]) assert.deepEqual(filterScheduleChoices(catalogue, text), [catalogue[0]]);
  const people = [{ slug: "teacher", name: "Семён Смирнов" }];
  for (const text of ["смирнов", "СМИРНОВ", "СмИрНоВ", "  СМИРНОВ  ", "  семен  "]) assert.deepEqual(filterScheduleChoices(people, text), people);
  const tree = [{ slug: "parent", parentSlug: null }, { slug: "a", parentSlug: "parent" }, { slug: "b", parentSlug: "parent" }];
  assert.deepEqual(groupScope(tree, "a").sort(), ["a", "parent"]);
  assert.deepEqual(groupScope(tree, "parent").sort(), ["a", "b", "parent"]);
  assert.deepEqual(groupScope([{ slug: "a", parentSlug: "b" }, { slug: "b", parentSlug: "a" }], "a").sort(), ["a", "b"]);
  assert(!scheduleHref("/dashboard/schedule", { view: "teacher", selected: "foreign", week: "2026-11-09", day: 2 }).includes("foreign"));
  pass("Search and week regressions", { cyrillicGroupCase: true, teacherCase: true, surroundingWhitespace: true, partialWeeks: true, academicYearBoundary: true, subgroupInheritance: true, subgroupIsolation: true });

  const numerator = await read({}); const denominator = await read({ week: "2026-11-16" });
  assert.equal(numerator.days.flatMap(day => day.lessons).length, 5);
  assert.equal(numerator.days[1].lessons[0].kind, "Лабораторная");
  assert.equal(denominator.days[1].lessons[0].discipline, "Базы данных");
  assert.equal(numerator.days[0].lessons[0].start, "09:00");
  assert.equal(numerator.days[0].lessons[0].building, "Учебный корпус А");
  assert.equal(numerator.days[0].lessons[0].groups.length, 2);
  assert.equal(numerator.days[6].lessons.length, 0);
  assert.equal((await read({ week: "2027-01-11" })).days.flatMap(day => day.lessons).length, 0);
  assert.equal((await read({ week: "2026-08-31" })).days[0].lessons.length, 0);
  assert.equal((await read({ week: "2026-12-28", group: "it-25-1" })).days[4].lessons.length, 0);
  const teacher = await read({ view: "teacher", group: "", teacher: "anna-belova" });
  assert.equal(teacher.days.flatMap(day => day.lessons).length, 4);
  assert(teacher.days.flatMap(day => day.lessons).every(lesson => lesson.teachers.every(t => t.name === "Анна Белова")));
  const searchedTeacher = await read({ view: "teacher", group: "", teacher: "", q: "бЕлОвА" });
  assert.equal(searchedTeacher.choices.length, 1);
  assert.equal(searchedTeacher.selected.slug, "anna-belova");
  assert.equal((await read({ group: "", q: "пи-24" })).choices.length, 2);
  assert.equal((await read({ group: "", q: "НЕСУЩЕСТВУЮЩАЯ" })).selected, null);
  assert.equal((await read({ group: "' OR 1=1 --" })).days.flatMap(day => day.lessons).length, 0);
  pass("Common timetable and search", { numeratorAndDenominator: true, sharedLessonNotDuplicated: true, teacherLessons: 4, cyrillicCaseInsensitive: true, emptySunday: true, outOfTermEmpty: true });

  for (const q of ["пи-24", "ПИ-24", "Пи-24", "  пИ-24  "]) assert.deepEqual((await read({ group: "", q })).choices.map(c => c.slug), ["pi-24-1", "pi-24-2"]);
  for (const q of ["белова", "БЕЛОВА", "БеЛоВа", "  БЕЛОВА  "]) assert.equal((await read({ view: "teacher", group: "", teacher: "", q })).selected.slug, "anna-belova");
  const students = await db.user.findMany({ where: { role: "STUDENT" }, select: { id: true, studentProfile: { select: { group: { select: { slug: true } } } } } });
  for (const student of students) {
    const mine = await getPersonalScheduleData(db, query({ group: "it-25-1", view: "teacher", teacher: "anna-belova", q: "foreign" }), { id: student.id, role: "STUDENT" });
    assert.equal(mine.selected?.slug, student.studentProfile?.group?.slug);
    assert(mine.days.flatMap(d => d.lessons).every(l => l.groups.some(g => g.slug === mine.selected.slug)));
  }
  const sokolov = await db.user.findUniqueOrThrow({ where: { email: "mikhail.sokolov@example.test" } });
  const teaching = await getPersonalScheduleData(db, query({ teacher: "anna-belova" }), { id: sokolov.id, role: "TEACHER" });
  assert.equal(teaching.days.flatMap(d => d.lessons).length, 4);
  assert.equal(new Set(teaching.days.flatMap(d => d.lessons).flatMap(l => l.groups.map(g => g.slug))).size, 3);
  const unlinked = await db.user.create({ data: { email: "unlinked@example.test", name: "Unlinked", role: "STUDENT", studentProfile: { create: {} } } });
  assert.equal((await getPersonalScheduleData(db, query({}), { id: unlinked.id, role: "STUDENT" })).selected, null);
  await db.user.delete({ where: { id: unlinked.id } });
  pass("Personal schedule scope", { studentProfileRelation: true, teacherAllGroups: true, unlinkedProfile: true, spoofedIdentityIgnored: true });

  const department = await db.academicDepartment.create({ data: { faculty: "Fixture Faculty", name: "Fixture Department" } });
  const rootGroup = await db.studyGroup.update({ where: { slug: "pi-24-1" }, data: { departmentId: department.id } });
  const subgroup = await db.studyGroup.create({ data: { slug: "fixture-subgroup", code: "СМ7", programme: rootGroup.programme, course: 2, parentId: rootGroup.id, departmentId: department.id, isPublic: true } });
  const nested = await read({ group: "fixture-subgroup" });
  assert.equal(nested.days.flatMap(d => d.lessons).length, 5);
  const hierarchyChoice = nested.allGroups.find(g => g.slug === "fixture-subgroup");
  assert.equal(hierarchyChoice.parentSlug, "pi-24-1"); assert.equal(hierarchyChoice.faculty, "Fixture Faculty"); assert.equal(hierarchyChoice.department, "Fixture Department");
  for (const q of ["см7", "СМ7", "См7", "  см7  "]) assert.equal((await read({ group: "", q })).selected.slug, "fixture-subgroup");
  await db.studyGroup.delete({ where: { id: subgroup.id } });
  await db.studyGroup.update({ where: { id: rootGroup.id }, data: { departmentId: null } });
  await db.academicDepartment.delete({ where: { id: department.id } });
  pass("Database hierarchy", { realDepartmentRelation: true, realSubgroupRelation: true, inheritedLessons: true, groupCaseAndTrimAgainstDatabase: true });

  const dto = JSON.stringify(numerator);
  for (const key of ["email", "password", "userId", "teacherId", "studentNumber", "sessions"]) assert(!dto.includes(`\"${key}\"`));
  for (const user of await db.user.findMany({ select: { id: true, email: true } })) assert(!dto.includes(user.id) && !dto.includes(user.email));
  await db.user.create({ data: { id: "schedule-test-private-user", email: "private-probe@example.test", name: "PRIVATE-NAME-MARKER", role: "TEACHER", teacherProfile: { create: { scheduleSlug: "private-probe", publicName: "PRIVATE-NAME-MARKER", isSchedulePublic: false } } } });
  await db.lessonTeacher.create({ data: { lessonId: "demo-lesson-math-shared", teacherId: "schedule-test-private-user" } });
  const privateMix = await read({});
  assert(!privateMix.days[0].lessons.some(lesson => lesson.start === "09:00"));
  assert(!JSON.stringify(privateMix).includes("PRIVATE-NAME-MARKER"));
  await db.lessonTeacher.delete({ where: { lessonId_teacherId: { lessonId: "demo-lesson-math-shared", teacherId: "schedule-test-private-user" } } });
  await db.studyGroup.update({ where: { slug: "pi-24-2" }, data: { isPublic: false } });
  const privateGroup = await read({});
  assert(!privateGroup.choices.some(group => group.slug === "pi-24-2"));
  assert(!privateGroup.days[0].lessons.some(lesson => lesson.start === "09:00"));
  await db.studyGroup.update({ where: { slug: "pi-24-2" }, data: { isPublic: true } });
  await db.scheduleEntry.update({ where: { id: "demo-entry-math-shared" }, data: { isPublished: false } });
  assert(!(await read({})).days[0].lessons.some(lesson => lesson.start === "09:00"));
  await db.scheduleEntry.update({ where: { id: "demo-entry-math-shared" }, data: { isPublished: true } });
  await db.room.update({ where: { id: "demo-room-b304" }, data: { isPublic: false } });
  assert(!(await read({})).days.flatMap(day => day.lessons).some(lesson => lesson.room === "304"));
  await db.room.update({ where: { id: "demo-room-b304" }, data: { isPublic: true } });
  await db.building.update({ where: { code: "b" }, data: { isPublic: false } });
  assert(!(await read({})).days.flatMap(day => day.lessons).some(lesson => lesson.building === "Учебный корпус Б"));
  await db.building.update({ where: { code: "b" }, data: { isPublic: true } });
  await db.academicTerm.update({ where: { id: "demo-term-autumn-2026" }, data: { isPublished: false } });
  assert.equal((await read({})).days.flatMap(day => day.lessons).length, 0);
  await db.academicTerm.update({ where: { id: "demo-term-autumn-2026" }, data: { isPublished: true } });
  await assert.rejects(db.scheduleEntry.create({ data: { id: "invalid-time-probe", lessonId: "demo-lesson-math-shared", termId: "demo-term-autumn-2026", roomId: "demo-room-a201", dayOfWeek: 8, startMinute: 100, endMinute: 90 } }));
  pass("Publication boundary", { noPrivateUserFieldsOrIDs: true, privateCoTeacherOrGroupHidesWholeEntry: true, roomBuildingAndTermPublication: true, unpublishedEntryHidden: true, databaseTimeConstraint: true });

  const secret = randomBytes(48).toString("base64url"); privateValues.push(secret);
  const actors = [];
  for (const account of demoAccounts) {
    const user = await db.user.findUniqueOrThrow({ where: { email: account.email } });
    const password = randomBytes(24).toString("base64url"); privateValues.push(password);
    await db.account.updateMany({ where: { userId: user.id, providerId: "credential" }, data: { password: await hashPassword(password) } });
    actors.push({ ...user, password });
  }
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3201"], { env: { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: base, AUTH_TRUST_PROXY: "false", AUTH_PROXY_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout.on("data", data => { logs += String(data); }); child.stderr.on("data", data => { logs += String(data); });
  let ready = false;
  for (let n = 0; n < 25; n++) { try { if ((await request("/schedule")).status === 200) { ready = true; break; } } catch { /* startup */ } await new Promise(done => setTimeout(done, 200)); }
  assert(ready, "Isolated production server unavailable");
  const home = await request("/"); assert.equal(home.status, 200);
  assert(home.text.includes('href="/login"') && home.text.includes('href="/schedule"'));
  assert(home.text.includes("Войти в") && home.text.includes("Новости и объявления"));
  for (const old of ["Попробовать деморежим", "МЕНЬШЕ РУТИНЫ", "Планируй свой день"]) assert(!home.text.includes(old));
  for (const path of ["/schedule?group=pi-24-1&week=2026-11-09", "/schedule?view=teacher&q=" + encodeURIComponent("белова") + "&week=2026-11-09"]) { const response = await request(path); assert.equal(response.status, 200); assert(response.text.includes("Математический анализ")); }
  const empty = await request("/schedule?group=pi-24-1&week=2026-11-09&day=7"); assert(empty.text.includes("Занятий нет")); assert(!empty.text.includes('class="public-lesson"'));
  assert((await request("/schedule?group=pi-24-1&week=2026-02-31")).text.includes("Некорректные параметры"));
  const sourceChange = { startMinute: 660, endMinute: 750 };
  await db.scheduleEntry.update({ where: { id: "demo-entry-programming-pi1" }, data: sourceChange });
  assert((await request("/schedule?group=pi-24-1&week=2026-11-09&day=1")).text.includes("11:00"));
  await db.scheduleEntry.update({ where: { id: "demo-entry-programming-pi1" }, data: { startMinute: 645, endMinute: 735 } });
  for (const actor of actors) {
    const signed = await request("/api/auth/sign-in/email", { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ email: actor.email, password: actor.password }) });
    assert.equal(signed.status, 200);
    const data = JSON.parse(signed.text); privateValues.push(data.token);
    const cookie = signed.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
    const personalHome = await request("/", { headers: { Cookie: cookie } });
    const finalCard = [...personalHome.text.matchAll(/<a[^>]+class="portal-action portal-action-cabinet"[^>]*>/g)].at(-1)?.[0] ?? "";
    assert(finalCard.includes(`href="${roleHomes[actor.role]}"`), "Home action must lead to current role workspace");
    if (["STUDENT", "TEACHER"].includes(actor.role)) {
      const personal = await request(`${roleHomes[actor.role]}/schedule?week=2026-11-09&day=all&view=teacher&teacher=anna-belova&group=it-25-1&userId=foreign`, { headers: { Cookie: cookie } });
      assert.equal(personal.status, 200); assert(personal.text.includes("Моё расписание"));
      const expected = await getPersonalScheduleData(db, query({}), { id: actor.id, role: actor.role });
      assert(personal.text.includes(expected.selected.name));
      const wrongHome = actor.role === "STUDENT" ? "/teacher/schedule" : "/dashboard/schedule";
      const wrongRole = await request(wrongHome, { headers: { Cookie: cookie } });
      assert([307, 200].includes(wrongRole.status)); assert(!wrongRole.text.includes('class="public-lesson"'));
    }
    await request("/api/auth/sign-out", { method: "POST", headers: { Origin: base, "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
  }
  pass("Production HTTP and main actions", { publicSchedule: true, searches: true, dayAndWeekNavigation: true, roleAwareCabinetLinks: actors.length, databaseEditVisibleWithoutBuild: true });
  assert(JSON.stringify(await snapshot(source)) === JSON.stringify(baseline), "Tests must not change the original DB");
  pass("Source database preservation", { unchanged: true });
} finally {
  if (child && child.exitCode === null) {
    // Use the owned process handle first; taskkill can be denied in a sandbox
    // even when spawning and terminating our own child through Node is allowed.
    child.kill("SIGTERM");
    for (let n = 0; n < 20 && child.exitCode === null && child.signalCode === null; n++) await new Promise(done => setTimeout(done, 50));
    if (child.exitCode === null && child.signalCode === null && process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
  for (const value of privateValues) logs = logs.replaceAll(value, "[REDACTED]");
  writeFileSync(resolve(root, "server.log"), logs, { mode: 0o600 });
  writeFileSync(resolve(root, "results.json"), JSON.stringify(results, null, 2));
  copy.close(); source.close(); await db.$disconnect();
  console.info(`Результаты: ${root.replaceAll("\\", "/")}/results.json`);
}
