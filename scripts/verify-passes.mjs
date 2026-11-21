import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import jsQR from "jsqr";
import sharp from "sharp";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { executeServiceCommand, getServiceRequest, seedServices } from "../src/lib/services-repository.ts";
import { fingerprint, integrity } from "./database-snapshot.mjs";
import { provisionTestDatabase } from "./test-fixtures.mjs";

mkdirSync(".local", { recursive: true });
const root = mkdtempSync(resolve(".local/passes-test-"));
const development = process.argv.includes("--development");
const source = createClient({ url: getDatabaseUrl() });
const before = await fingerprint(source);
const env = provisionTestDatabase(resolve(root, "test.db"));
process.env.DATABASE_URL = env.DATABASE_URL;
const db = createPrismaClient();
const results = [], diagnostics = [], observedUrls = [];
const pass = name => { results.push(name); console.info("PASS: " + name); };
let server, browser, logs = "";
const net = createServer();
await new Promise(done => net.listen(0, "127.0.0.1", done));
const base = "http://127.0.0.1:" + net.address().port;
await new Promise(done => net.close(done));
const api = "/api/passes";
const post = (ctx, data, origin = base) => ctx.request.post(base + api, { headers: { Origin: origin }, data });
const get = (ctx, url = api) => ctx.request.get(base + url);
const record = (ctx) => {
  ctx.on("request", request => observedUrls.push([request.url(), request.headers().referer]));
  ctx.on("page", page => {
    page.on("pageerror", error => diagnostics.push(error.message));
    page.on("console", message => {
      if (/Blocking Route|Instant validation|uncached data during|hydration/i.test(message.text())) diagnostics.push(message.text());
    });
  });
  return ctx;
};
const heading = (page, name) => page.getByRole("heading", { name, exact: true });
async function scan(locator) {
  await expect(locator).toBeVisible();
  const png = await locator.screenshot();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert(code, "Displayed QR must decode");
  assert.match(code.data, /^LKS1-[\w-]{43}$/);
  return { token: code.data, png };
}
const state = async (ctx, token) => {
  const response = await post(ctx, { action: "verify", token });
  assert.equal(response.status(), 200);
  assert.match(response.headers()["cache-control"], /private.*no-store/);
  assert.equal(response.headers()["referrer-policy"], "no-referrer");
  return response.json();
};
const login = async (ctx, account) => {
  const response = await ctx.request.post(base + "/api/auth/sign-in/email", {
    headers: { Origin: base }, data: { email: account.email, password: env[account.passwordEnv] },
  });
  assert.equal(response.status(), 200);
};
const warning = /Blocking Route|Instant validation|uncached data during/i;
try {
  await seedServices(db);
  const [student, other, admin, , staff, dean] = await Promise.all(demoAccounts.map(a => db.user.findUniqueOrThrow({ where: { email: a.email } })));
  const detail = await db.studentProfile.findUniqueOrThrow({ where: { userId: student.id }, include: { group: true } });
  const departmentId = detail.group.departmentId;
  const grant = (user, canManage, canVerify) => db.passGrant.create({ data: { userId: user.id, role: user.role, canManage, canVerify } });
  let project = resolve(".");
  if (development) {
    project = resolve(root, "project");
    mkdirSync(project);
    for (const folder of ["src", "public"]) cpSync(folder, resolve(project, folder), { recursive: true });
    for (const file of ["package.json", "package-lock.json", "tsconfig.json", "AGENTS.md", ".gitignore"]) cpSync(file, resolve(project, file));
    const config = readFileSync("next.config.ts", "utf8")
      .replace("turbopack: {", `turbopack: { root: ${JSON.stringify(resolve(".").replaceAll("\\", "/"))},`)
      .replace('loaders: ["@tailwindcss/turbopack"]', `loaders: [{ loader: "@tailwindcss/turbopack", options: { base: ${JSON.stringify(resolve(project, "src").replaceAll("\\", "/"))} } }]`);
    writeFileSync(resolve(project, "next.config.ts"), config);
    symlinkSync(resolve("node_modules"), resolve(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  }
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", development ? "dev" : "start", project, "--hostname", "127.0.0.1", "--port", new URL(base).port], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...env, BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      PASS_TOKEN_KEY: randomBytes(48).toString("base64url"), AUTH_TRUST_PROXY: "false", AUTH_PROXY_SECRET: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { logs += data; });
  let ready = false;
  for (let i = 0; i < 60 && server.exitCode === null; i++) {
    try { ready = (await fetch(base + "/api/auth/get-session")).ok; } catch {}
    if (ready) break;
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, "Isolated Next server did not start");
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
  const anonymous = record(await browser.newContext());
  const contexts = [];
  for (const account of demoAccounts) {
    const ctx = record(await browser.newContext({ viewport: { width: 1366, height: 900 } }));
    await login(ctx, account);
    contexts.push(ctx);
  }
  const [owner, stranger, manager, teacherCtx, verifier, deanCtx] = contexts;
  const verify = { action: "verify", token: "bad" };
  const history = { action: "history", email: student.email };
  const issue = { action: "issue", email: student.email, expected: null };
  for (const operation of [verify, history, issue]) assert.equal((await post(anonymous, operation)).status(), 401);
  assert.equal((await get(anonymous)).status(), 401);
  for (const ctx of contexts) {
    assert.equal((await post(ctx, verify)).status(), 403);
    assert.equal((await post(ctx, history)).status(), 403);
    assert.equal((await post(ctx, issue)).status(), 403);
  }
  assert.equal((await get(stranger, api + "?email=" + student.email)).status(), 400);
  for (const ctx of [manager, teacherCtx, verifier, deanCtx]) assert.equal((await get(ctx)).status(), 403);
  const staffPage = await verifier.newPage();
  await staffPage.goto(base + "/staff/passes");
  await expect(heading(staffPage, "Электронные пропуска")).toHaveCount(0);
  await staffPage.goto(base + "/staff");
  await expect(staffPage.getByRole("link", { name: "Электронные пропуска" })).toHaveCount(0);
  await grant(admin, true, false);
  await grant(staff, false, true);
  assert.equal((await post(manager, verify)).status(), 403);
  assert.equal((await post(verifier, history)).status(), 403);
  assert.equal((await post(verifier, issue)).status(), 403);
  assert.equal((await post(verifier, verify, "https://foreign.example")).status(), 403);
  assert.equal((await post(verifier, { ...verify, token: "a".repeat(4500) })).status(), 413);
  assert.equal((await post(verifier, { ...verify, studentId: student.id })).status(), 400);
  pass("Анонимный доступ, пять ролей, раздельные назначения, Origin, лимит тела и подмена параметров");

  const page = await owner.newPage();
  await page.goto(base + "/dashboard/profile");
  await expect(page.getByText("Пропуск не выдан", { exact: true })).toBeVisible();
  await expect(page.locator(".pass-qr")).toHaveCount(0);
  const office = await manager.newPage();
  await office.goto(base + "/admin");
  await office.getByRole("navigation").getByRole("link", { name: "Электронные пропуска" }).first().click();
  await expect(heading(office, "Выдача и история")).toBeVisible();
  await expect(heading(office, "Проверка QR")).toHaveCount(0);
  await office.getByLabel("Университетская почта студента").fill(student.email);
  await office.getByRole("button", { name: "Найти студента" }).click();
  await office.getByRole("button", { name: "Выдать пропуск" }).click();
  await expect(office.getByText("Пропуск выдан.", { exact: true })).toBeVisible();
  assert.equal((await post(manager, issue)).status(), 409);
  const parallel = await Promise.all(Array.from({ length: 6 }, () => post(manager, { ...issue, email: other.email })));
  assert.equal(parallel.filter(response => response.status() === 200).length, 1);
  assert(parallel.every(response => [200, 409].includes(response.status())), parallel.map(r => r.status()).join(","));
  for (const user of [student, other]) assert.equal(await db.studentPass.count({ where: { studentId: user.id, status: "ACTIVE" } }), 1);
  const sparse = await db.user.create({ data: { name: "Студент без сведений", email: "sparse@example.test", role: "STUDENT" } });
  assert.equal((await post(manager, { ...issue, email: sparse.email })).status(), 200);
  const sparseHistory = await (await post(manager, { ...history, email: sparse.email })).json();
  assert.equal(sparseHistory.person.name, sparse.name);
  assert.equal(sparseHistory.person.group, null);
  assert.equal(sparseHistory.passes[0].status, "ACTIVE");
  pass("Первая выдача в кабинете, отказ повторной выдачи и шесть параллельных запросов");

  await page.reload();
  const first = await scan(page.locator(".pass-qr"));
  await expect(page.locator(".pass-panel")).toContainText("Образец");
  await expect(page.locator(".pass-panel .pass-identity img")).toBeVisible();
  const dbPass = await db.studentPass.findFirstOrThrow({ where: { studentId: student.id } });
  assert.equal(dbPass.tokenHash, createHash("sha256").update(first.token).digest("hex"));
  assert(!JSON.stringify(dbPass).includes(first.token));
  assert(!(await (await post(manager, history)).text()).includes(dbPass.tokenHash));
  assert(!(await (await get(owner, "/dashboard/profile")).text()).includes(first.token));
  assert(!(await (await get(owner, "/dashboard")).text()).includes(first.token));
  assert.equal((await (await get(stranger)).json()).person.name === (await (await get(owner)).json()).person.name, false);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => localStorage.setItem("lks-theme", value), theme);
    for (const width of [346, 360, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto(base + "/dashboard");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const trigger = page.getByRole("button", { name: "Пропуск", exact: true });
      await expect(page.locator(".pass-qr")).toHaveCount(0);
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Электронный пропуск" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Закрыть пропуск" })).toBeFocused();
      const qr = dialog.locator(".pass-qr");
      assert.equal((await scan(qr)).token, first.token);
      assert((await qr.boundingBox()).width >= 225);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      if ((width === 346 || width === 1366) && !development) await page.screenshot({ path: resolve(root, `modal-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await page.goto(base + "/dashboard/profile");
      assert.equal((await scan(page.locator(".pass-qr"))).token, first.token);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
  }
  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await expect(page).toHaveURL(/\/login/);
  assert.equal((await get(owner)).status(), 401);
  await login(owner, demoAccounts[0]);
  await page.goto(base + "/dashboard/profile");
  assert.equal((await scan(page.locator(".pass-qr"))).token, first.token);
  pass("Совпадение QR в профиле и на главной, F5, повторный вход, обе темы, 346/360/390/768/1366 px, Escape и фокус");

  await staffPage.goto(base + "/staff/passes");
  await expect(heading(staffPage, "Проверка QR")).toBeVisible();
  await expect(heading(staffPage, "Выдача и история")).toHaveCount(0);
  await expect(staffPage.locator("form").filter({ has: staffPage.getByLabel("Код со сканера") })).toHaveAttribute("method", "post");
  await staffPage.getByLabel("Снимок QR-кода").setInputFiles({ name: "capture.png", mimeType: "image/png", buffer: first.png });
  await expect(staffPage.getByText("Пропуск действителен")).toBeVisible();
  await expect(staffPage.getByAltText("Официальное фото для сверки")).toBeVisible();
  const result = await state(verifier, first.token);
  assert.deepEqual(Object.keys(result.person).sort(), ["group", "name", "photo", "sample"]);
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.person.group, detail.group.code);
  assert.match(result.person.photo, /^data:image\/jpeg;base64,/);
  assert.deepEqual(await state(verifier, "LKS1-" + randomBytes(32).toString("base64url")), { status: "NOT_FOUND" });
  assert(!JSON.stringify(result).includes(first.token));
  assert(!JSON.stringify(observedUrls).includes(first.token));
  pass("Считывание изображения в браузере, проверка QR, официальная фотография и отсутствие токена в URL, Referer и ответах проверки");

  const serviceActor = async user => ({ id: user.id, sessionId: (await db.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "desc" } })).id });
  const s = await serviceActor(student), d = await serviceActor(dean);
  const service = (actor, data) => executeServiceCommand(db, actor, { requestId: randomUUID(), ...data });
  await db.deaneryDepartmentAssignment.upsert({ where: { userId_departmentId: { userId: dean.id, departmentId } },
    create: { userId: dean.id, departmentId }, update: {} });
  await db.serviceRoute.create({ data: { serviceCode: "pass-reissue", sourceDepartmentId: departmentId, departmentId } });
  await db.serviceGrant.create({ data: { userId: dean.id, departmentId, serviceCode: "pass-reissue" } });
  assert.equal((await post(deanCtx, verify)).status(), 403);
  assert.equal((await post(deanCtx, history)).status(), 403);
  let request = await service(s, { operation: "CREATE", code: "pass-reissue", fields: { reason: "Утрата", photo: "KEEP" } });
  const replace = { action: "replace", email: student.email, expected: dbPass.id, requestId: request.id, reason: "Утрата" };
  const preview = await getServiceRequest(db, s, request.id);
  request = await service(s, { operation: "SUBMIT", ...request, confirmed: true, confirmationHash: preview.profilePreview.confirmationHash });
  assert.equal((await post(manager, replace)).status(), 409);
  assert.equal((await state(verifier, first.token)).status, "ACTIVE");
  for (const status of ["IN_REVIEW", "IN_PROGRESS", "COMPLETED"]) request = await service(d, { operation: "TRANSITION", ...request, status, text: "Проверено" });
  assert.equal((await state(verifier, first.token)).status, "ACTIVE");
  assert.equal((await post(manager, { ...replace, email: other.email, expected: (await db.studentPass.findFirstOrThrow({ where: { studentId: other.id } })).id })).status(), 409);
  await office.getByRole("button", { name: "Найти студента" }).click();
  await expect(office.getByText(request.id, { exact: false })).toBeAttached();
  await office.getByLabel("Исполненное заявление на перевыпуск").selectOption(request.id);
  await office.getByLabel("Причина отзыва или замены").fill("Утрата");
  await office.getByRole("button", { name: "Перевыпустить пропуск" }).click();
  await expect(office.getByText("Пропуск перевыпущен.", { exact: true })).toBeVisible();
  assert.deepEqual(await state(verifier, first.token), { status: "REPLACED" });
  assert.equal((await post(manager, replace)).status(), 409);
  await page.reload();
  const second = await scan(page.locator(".pass-qr"));
  assert.notEqual(second.token, first.token);
  assert.equal((await state(verifier, second.token)).status, "ACTIVE");
  await office.getByLabel("Причина отзыва или замены").fill("Доступ прекращён");
  await office.getByRole("button", { name: "Отозвать пропуск" }).click();
  await expect(office.getByText("Пропуск отозван.", { exact: true })).toBeVisible();
  assert.deepEqual(await state(verifier, second.token), { status: "REVOKED" });
  await page.reload();
  await expect(page.locator(".pass-card")).toHaveAttribute("data-status", "REVOKED");
  await expect(page.locator(".pass-qr")).toHaveCount(0);
  const rows = (await (await post(manager, history)).json()).passes;
  assert.deepEqual(rows.map(p => p.status), ["REVOKED", "REPLACED"]);
  assert.deepEqual(rows.map(p => p.reason), ["Доступ прекращён", "Утрата"]);
  assert(rows.every(p => p.closedAt && p.issuedAt && p.closer.name === admin.name));
  assert.equal(rows[0].requestId, request.id);
  pass("Существующее заявление, явный перевыпуск, отказ чужого заявления, отзыв, повтор старого QR и история");

  await db.passGrant.update({ where: { userId: staff.id }, data: { windowStart: null } });
  for (let i = 0; i < 30; i++) assert.equal((await post(verifier, verify)).status(), 200);
  assert.equal((await post(verifier, { ...verify, token: second.token })).status(), 429);
  await db.passGrant.update({ where: { userId: staff.id }, data: { windowStart: new Date(Date.now() - 65_000) } });
  assert.deepEqual(await state(verifier, second.token), { status: "REVOKED" });
  await db.user.update({ where: { id: staff.id }, data: { role: "TEACHER" } });
  assert.equal((await post(verifier, verify)).status(), 403);
  await db.passGrant.delete({ where: { userId: admin.id } });
  assert.equal((await post(manager, history)).status(), 403);
  await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: dean.id } });
  assert.equal((await post(deanCtx, verify)).status(), 403);
  assert.equal((await post(deanCtx, history)).status(), 403);
  assert.equal((await post(teacherCtx, verify)).status(), 403);
  assert(!logs.includes(first.token) && !logs.includes(second.token));
  assert(!JSON.stringify(observedUrls).includes(second.token));
  assert.deepEqual(diagnostics, []);
  assert(!warning.test(logs));
  const testSqlite = createClient({ url: env.DATABASE_URL });
  try { await integrity(testSqlite); } finally { testSqlite.close(); }
  assert.equal(await fingerprint(source), before);
  pass("Лимит подбора, отзыв полномочий, смена роли, диагностические предупреждения и неизменность рабочей БД");
  writeFileSync(resolve(root, "results.json"), JSON.stringify({ mode: development ? "development" : "production", results }, null, 2));
} finally {
  await browser?.close();
  server?.kill();
  await db.$disconnect();
  source.close();
  writeFileSync(resolve(root, "server.log"), logs, { mode: 0o600 });
  console.info("Результаты проверки: " + root);
}
