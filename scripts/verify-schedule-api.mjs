import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { getPublicScheduleData } from "../src/lib/schedule-repository.ts";
import { parseScheduleQuery } from "../src/lib/schedule-calendar.ts";
import { parseScheduleApiParameters } from "../src/lib/schedule-api-parameters.ts";
import { cachedScheduleApiValue, invalidateScheduleApiCache } from "../src/lib/schedule-api-runtime.ts";

mkdirSync(".local", { recursive: true });
const folder = mkdtempSync(resolve(".local/schedule-api-test-"));
const source = createClient({ url: getDatabaseUrl() });
async function fingerprint(client) {
  const names = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows.map(row => row.name);
  const rows = [];
  for (const name of names) rows.push([name, (await client.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows]);
  return createHash("sha256").update(JSON.stringify(rows, (_, value) => typeof value === "bigint" ? String(value) : value)).digest("hex");
}
const original = await fingerprint(source), file = resolve(folder, "test.db");
await source.execute({ sql: "VACUUM INTO ?", args: [file] });
process.env.DATABASE_URL = "file:" + file.replaceAll("\\", "/");
const copy = createClient({ url: process.env.DATABASE_URL }), db = createPrismaClient();
const base = "http://127.0.0.1:3220", results = [];
const secret = randomBytes(48).toString("base64url"), proxySecret = randomBytes(48).toString("base64url");
let child, logs = "", proxy = false;
function pass(name, evidence = {}) { results.push({ name, ...evidence }); console.info(`PASS: ${name} ${JSON.stringify(evidence)}`); }
async function stop() {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(done => { child.once("exit", done); setTimeout(done, 1500).unref(); });
  }
  child = undefined;
}
async function start({ trusted = false, cache = "0", perClient = "1000", global = "10000" } = {}) {
  await stop(); proxy = trusted;
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3220"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: trusted ? "https://api.example.test" : base, BETTER_AUTH_SECRET: secret, AUTH_TRUST_PROXY: String(trusted), AUTH_PROXY_SECRET: trusted ? proxySecret : "", SCHEDULE_API_RATE_LIMIT: perClient, SCHEDULE_API_GLOBAL_LIMIT: global, SCHEDULE_API_CACHE_SECONDS: cache, SCHEDULE_API_CONCURRENCY: "4" } });
  child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
  let ready = false;
  for (let n = 0; n < 30; n++) {
    try { if ((await fetch(base + "/icon.svg", { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* startup */ }
    await new Promise(done => setTimeout(done, 150));
  }
  assert(ready, "API test server not ready");
}
async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...(proxy ? { "x-lks-proxy-key": proxySecret, "x-lks-client-ip": "192.0.2.1" } : {}), ...options.headers }, signal: AbortSignal.timeout(15000), redirect: "manual" });
  const text = await response.text(); let json;
  try { json = JSON.parse(text); } catch { /* HEAD, HTML, 304 */ }
  return { status: response.status, headers: response.headers, text, json };
}
const groupPath = "/api/v1/schedule?group=pi-24-1&week=2026-11-09";
function lessons(response) { return response.json.data.days.flatMap(day => day.lessons); }
try {
  // Real publication fixtures only in the copied DB.
  const privateTeacher = await db.user.create({ data: { email: "api-private@example.test", name: "API_PRIVATE_NAME", role: "TEACHER", teacherProfile: { create: { scheduleSlug: "api-private", publicName: "API_PRIVATE_NAME", isSchedulePublic: false } } } });
  await db.studyGroup.create({ data: { slug: "api-private", code: "API_PRIVATE_GROUP", programme: "Private", course: 1, isPublic: false } });
  const department = await db.academicDepartment.create({ data: { faculty: "Тестовый факультет", name: "Тестовая кафедра" } });
  const parent = await db.studyGroup.findUniqueOrThrow({ where: { slug: "pi-24-1" } });
  await db.studyGroup.create({ data: { slug: "api-subgroup", code: "СМ7", programme: parent.programme, course: 2, parentId: parent.id, departmentId: department.id, isPublic: true } });
  const privateValues = (await db.user.findMany({ select: { id: true, email: true } })).flatMap(user => [user.id, user.email]);
  const readonlyBaseline = await fingerprint(copy);
  await start();
  const group = await request(groupPath);
  assert.equal(group.status, 200); assert.equal(lessons(group).length, 5);
  assert.equal(group.json.data.week.periods[0].parity, "NUMERATOR");
  assert.equal(group.json.data.week.periods[0].weekNumber, 11);
  const website = await getPublicScheduleData(db, parseScheduleQuery({ group: "pi-24-1", week: "2026-11-09" }));
  assert.deepEqual(group.json.data.days, website.days.map(day => ({ date: day.date, dayOfWeek: day.dayOfWeek, lessons: day.lessons.map(lesson => ({ discipline: lesson.discipline, kind: lesson.kindCode, start: lesson.start, end: lesson.end, weekPattern: lesson.weekPatternCode, term: lesson.termCode, teachers: lesson.teachers, groups: lesson.groups, room: lesson.room, building: lesson.building, timeZone: "Europe/Moscow" })) })));
  const html = await request("/schedule?group=pi-24-1&week=2026-11-09");
  assert.equal(html.status, 200); assert(html.text.includes("Математический анализ") && html.text.includes("09:00"));
  const teacher = await request("/api/v1/schedule?teacher=mikhail-sokolov&week=2026-11-09");
  assert.equal(teacher.status, 200); assert.equal(lessons(teacher).length, 4);
  assert.equal(new Set(lessons(teacher).flatMap(lesson => lesson.groups.map(g => g.slug))).size, 3);
  const denominator = await request("/api/v1/schedule?group=pi-24-1&week=2026-11-16");
  assert.equal(denominator.json.data.week.periods[0].parity, "DENOMINATOR");
  assert.equal(denominator.json.data.days[1].lessons[0].discipline, "Базы данных");
  const numbered = await request("/api/v1/schedule?group=pi-24-1&term=demo-autumn-2026&weekNumber=11");
  assert.deepEqual(numbered.json.data.days, group.json.data.days);
  const first = await request("/api/v1/schedule?group=pi-24-1&term=demo-autumn-2026&weekNumber=1");
  assert.equal(first.json.data.week.startsOn, "2026-08-31"); assert.equal(first.json.data.days[0].lessons.length, 0);
  const empty = await request("/api/v1/schedule?group=pi-24-1&week=2027-01-11"); assert.equal(empty.status, 200); assert.equal(lessons(empty).length, 0);
  pass("Schedule parity, academic weeks and website equality", { group: 5, teacher: 4, teacherGroups: 3, numberedWeek: true, outsideTermEmpty: true });

  const demoDepartment = await db.studyGroup.findUniqueOrThrow({ where: { slug: "pi-24-1" }, select: { department: { select: { faculty: true, name: true } } } });
  for (const q of ["пи-24", "ПИ-24", "  Пи-24  "]) {
    const list = await request("/api/v1/groups?q=" + encodeURIComponent(q)); assert.equal(list.status, 200); assert.equal(list.json.data.length, 2);
    assert.equal(list.json.data[0].programme, "Прикладная информатика"); assert.equal(list.json.data[0].faculty, demoDepartment.department?.faculty ?? null); assert.equal(list.json.data[0].department, demoDepartment.department?.name ?? null);
  }
  for (const q of ["белова", "БЕЛОВА", "  БеЛоВа  "]) {
    const list = await request("/api/v1/teachers?q=" + encodeURIComponent(q)); assert.equal(list.json.data.length, 1); assert.equal(list.json.data[0].name, "Анна Белова");
  }
  const page1 = await request("/api/v1/groups?limit=1"), page2 = await request("/api/v1/groups?limit=1&offset=1");
  assert.equal(page1.json.pagination.nextOffset, 1); assert.notEqual(page1.json.data[0].slug, page2.json.data[0].slug);
  assert.equal((await request("/api/v1/groups?offset=5000")).json.data.length, 0);
  assert.equal((await request("/api/v1/teachers?q=nothing-matches")).json.data.length, 0);
  for (const q of ["см7", "СМ7", "  См7  "]) {
    const hierarchy = (await request("/api/v1/groups?q=" + encodeURIComponent(q))).json.data[0];
    assert.equal(hierarchy.faculty, "Тестовый факультет"); assert.equal(hierarchy.department, "Тестовая кафедра"); assert.equal(hierarchy.parentSlug, "pi-24-1");
  }
  assert.equal(lessons(await request("/api/v1/schedule?group=api-subgroup&week=2026-11-09")).length, 5);
  pass("Search, hierarchy fields and pagination", { caseInsensitive: true, trim: true, boundedPages: true, empty200: true });

  for (const path of ["/api/v1/schedule", "/api/v1/schedule?group=x&teacher=y", "/api/v1/schedule?group=", "/api/v1/schedule?group=pi-24-1&week=2026-02-31", "/api/v1/schedule?group=pi-24-1&week=2025-02-29", "/api/v1/schedule?group=pi-24-1&weekNumber=2", "/api/v1/schedule?group=pi-24-1&weekNumber=0&term=demo-autumn-2026", "/api/v1/schedule?group=pi-24-1&weekNumber=1.5&term=demo-autumn-2026", "/api/v1/schedule?group=pi-24-1&weekNumber=99&term=demo-autumn-2026", "/api/v1/schedule?group=pi-24-1&week=2027-02-01&term=demo-autumn-2026", "/api/v1/schedule?group=pi-24-1&week=2026-11-09&weekNumber=11&term=demo-autumn-2026", "/api/v1/groups?limit=-1", "/api/v1/groups?limit=101", "/api/v1/groups?offset=1.5", "/api/v1/groups?q=a&q=b", "/api/v1/groups?q=" + "x".repeat(81), "/api/v1/teachers?userId=probe", "/api/v1/groups?limit=1&limit=2"]) {
    const bad = await request(path); assert.equal(bad.status, 400, path); assert.equal(typeof bad.json.error.message, "string"); assert.equal(bad.headers.get("cache-control"), "no-store");
  }
  for (const path of ["/api/v1/schedule?group=missing", "/api/v1/schedule?teacher=missing", "/api/v1/schedule?group=api-private", "/api/v1/schedule?teacher=api-private", "/api/v1/schedule?group=pi-24-1&weekNumber=1&term=missing"]) assert.equal((await request(path)).status, 404);
  for (const path of [groupPath, "/api/v1/groups", "/api/v1/teachers"]) {
    const response = await request(path);
    for (const value of [...privateValues, "API_PRIVATE_NAME", "API_PRIVATE_GROUP"]) assert(!response.text.includes(value));
    for (const key of ["email", "userId", "teacherId", "studentNumber", "password", "token", "session", "accounts", "students", "id"]) assert(!response.text.includes(`"${key}":`));
    assert.equal(response.headers.get("access-control-allow-origin"), null); assert.equal(response.headers.get("set-cookie"), null);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) { const denied = await request(path, { method, body: "{}" }); assert.equal(denied.status, 405); assert.equal(denied.json.error.code, "METHOD_NOT_ALLOWED"); }
    assert.equal((await request(path, { method: "OPTIONS", headers: { Origin: "https://untrusted.example" } })).headers.get("access-control-allow-origin"), null);
  }
  assert.equal(await fingerprint(copy), readonlyBaseline, "Public API must perform no DB writes");
  pass("Strict validation, privacy and read-only methods", { invalid400: true, missingAndPrivate404: true, noPrivateFields: true, writes405: true, noWildcardCors: true, databaseUnchanged: true });

  await db.lessonTeacher.create({ data: { lessonId: "demo-lesson-math-shared", teacherId: privateTeacher.id } });
  assert(!lessons(await request(groupPath)).some(l => l.discipline === "Математический анализ" && l.start === "09:00"));
  await db.lessonTeacher.delete({ where: { lessonId_teacherId: { lessonId: "demo-lesson-math-shared", teacherId: privateTeacher.id } } });
  for (const [model, where, hide] of [["studyGroup", { slug: "pi-24-2" }, { isPublic: false }], ["room", { id: "demo-room-a201" }, { isPublic: false }], ["building", { code: "a" }, { isPublic: false }], ["academicTerm", { code: "demo-autumn-2026" }, { isPublished: false }], ["scheduleEntry", { id: "demo-entry-math-shared" }, { isPublished: false }]]) {
    await db[model].update({ where, data: hide });
    assert(!lessons(await request(groupPath)).some(l => l.start === "09:00" && l.discipline === "Математический анализ"));
    await db[model].update({ where, data: Object.fromEntries(Object.keys(hide).map(key => [key, true])) });
  }
  await db.academicTerm.update({ where: { code: "demo-autumn-2026" }, data: { timeZone: "Asia/Vladivostok" } });
  assert.equal((await request(groupPath)).json.error.code, "UNSUPPORTED_TIME_ZONE");
  await db.academicTerm.update({ where: { code: "demo-autumn-2026" }, data: { timeZone: "Europe/Moscow" } });
  pass("API publication boundary", { privateCoTeacher: true, privateGroup: true, room: true, building: true, term: true, entry: true });

  await start({ cache: "1" });
  const cached = await request(groupPath), etag = cached.headers.get("etag");
  assert.equal((await request(groupPath, { headers: { "If-None-Match": etag } })).status, 304);
  assert.equal((await request(groupPath, { method: "HEAD" })).text, "");
  await db.scheduleEntry.update({ where: { id: "demo-entry-programming-pi1" }, data: { startMinute: 660, endMinute: 750 } });
  assert.equal((await request(groupPath)).headers.get("etag"), etag);
  await new Promise(done => setTimeout(done, 1100));
  const fresh = await request(groupPath); assert.notEqual(fresh.headers.get("etag"), etag); assert(lessons(fresh).some(l => l.start === "11:00"));
  pass("Bounded cache and refresh", { conditional304: true, head: true, ttlRefresh: true, databaseUpdateVisible: true });

  // Exercise real simultaneous load admission and single-flight coalescing.
  process.env.SCHEDULE_API_CONCURRENCY = "4";
  const releases = [];
  const held = Array.from({ length: 4 }, (_, i) => cachedScheduleApiValue(`held:${i}`, () => new Promise(done => releases.push(done)), 0));
  await assert.rejects(cachedScheduleApiValue("fifth", async () => 1, 0), error => error.status === 503);
  releases.forEach(done => done(1)); await Promise.all(held);
  let loads = 0;
  await Promise.all(Array.from({ length: 8 }, () => cachedScheduleApiValue("coalesced", async () => { loads++; await new Promise(done => setTimeout(done, 10)); return 1; }, 1000)));
  assert.equal(loads, 1); invalidateScheduleApiCache();
  await cachedScheduleApiValue("coalesced", async () => { loads++; return 2; }, 1000); assert.equal(loads, 2);
  await assert.rejects(cachedScheduleApiValue("failure", () => { throw new Error("fixture"); }, 1000));
  assert.equal(await cachedScheduleApiValue("failure", async () => 3, 1000), 3);
  let releaseOld;
  const oldLoad = cachedScheduleApiValue("invalidated-flight", () => new Promise(done => { releaseOld = done; }), 1000);
  await Promise.resolve();
  invalidateScheduleApiCache();
  assert.equal(await cachedScheduleApiValue("invalidated-flight", async () => "fresh", 1000), "fresh");
  releaseOld("old"); await oldLoad;
  assert.equal(await cachedScheduleApiValue("invalidated-flight", async () => "unexpected", 1000), "fresh");
  pass("Concurrent load bounds", { maxLoads: 4, overflow503: true, coalescedMisses: true, internalInvalidation: true });

  await start({ perClient: "3" });
  const limitBefore = await fingerprint(copy);
  for (let n = 0; n < 3; n++) assert.equal((await request("/api/v1/groups", { headers: { "x-forwarded-for": `192.0.2.${n}`, "x-real-ip": `192.0.2.${n}`, "x-lks-verified-ip": `192.0.2.${n}` } })).status, 200);
  const limited = await request("/api/v1/teachers", { headers: { "x-forwarded-for": "203.0.113.1" } }); assert.equal(limited.status, 429); assert(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(await fingerprint(copy), limitBefore);
  await start({ trusted: true, perClient: "2", global: "3" });
  for (const headers of [{ "x-lks-proxy-key": "invalid" }, { "x-lks-client-ip": "192.0.2.1,192.0.2.2" }]) assert.equal((await request("/api/v1/groups", { headers })).status, 403);
  assert.equal((await request("/api/v1/groups")).status, 200);
  assert.equal((await request("/api/v1/groups", { headers: { "x-forwarded-for": "203.0.113.2" } })).status, 200);
  assert.equal((await request("/api/v1/groups", { headers: { "x-forwarded-for": "203.0.113.3" } })).status, 429);
  assert.equal((await request("/api/v1/groups", { headers: { "x-lks-client-ip": "192.0.2.2" } })).status, 200);
  assert.equal((await request("/api/v1/groups", { headers: { "x-lks-client-ip": "192.0.2.3" } })).status, 429);
  pass("Rate limits and trusted proxy", { forgedIpCannotRotateQuota: true, verifiedIpIsolation: true, aggregateBudget: true, retryAfter: true, noLimiterDatabaseWrites: true });
  assert.throws(() => parseScheduleApiParameters("groups", new URL(base + "/?q=" + "x".repeat(2049))), error => error.status === 400);
  assert.equal(await fingerprint(source), original);
  pass("Source database preservation", { unchanged: true });
} finally {
  await stop(); await db.$disconnect(); copy.close(); source.close();
  writeFileSync(resolve(folder, "server.log"), logs.replaceAll(secret, "[REDACTED]").replaceAll(proxySecret, "[REDACTED]"), { mode: 0o600 });
  writeFileSync(resolve(folder, "results.json"), JSON.stringify(results, null, 2));
  console.info(`API report: ${folder.replaceAll("\\", "/")}/results.json`);
}
