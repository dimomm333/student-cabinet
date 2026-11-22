import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { provisionTestDatabase } from "./test-fixtures.mjs";
import { integrity } from "./database-snapshot.mjs";

mkdirSync(".local", { recursive: true });
const root = mkdtempSync(resolve(".local/portfolio-test-"));
const env = provisionTestDatabase(resolve(root, "test.db"));
process.env.DATABASE_URL = env.DATABASE_URL;
const sqlite = createClient({ url: env.DATABASE_URL });
await sqlite.execute("PRAGMA journal_mode = WAL");
const db = createPrismaClient();
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const { port } = socket.address();
await new Promise(done => socket.close(done));
const base = "http://127.0.0.1:" + port;
const endpoint = base + "/api/portfolio";
const documents = resolve(root, "files");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: {
    ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", BETTER_AUTH_URL: base,
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), AUTH_TRUST_PROXY: "false",
    AUTH_PROXY_SECRET: "", PORTFOLIO_STORAGE_DIR: documents,
  }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
const diagnostic = /Blocking Route|Instant validation|Next\.js encountered|uncached data during|unstable value|hydration/i;
let logs = "";
child.stdout.on("data", chunk => { logs += chunk; });
child.stderr.on("data", chunk => { logs += chunk; });
let browser;
const errors = [];
const studentPath = "/dashboard/portfolio";
const deanPath = "/deanery/portfolio";
const origin = { Origin: base };

async function signIn(index) {
  const identity = demoAccounts[index];
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 }, colorScheme: "light" });
  const response = await context.request.post(base + "/api/auth/sign-in/email", {
    headers: origin, data: { email: identity.email, password: env[identity.passwordEnv] },
  });
  assert.equal(response.status(), 200, identity.role);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (diagnostic.test(message.text())) errors.push(message.text()); });
  const user = await db.user.findUniqueOrThrow({ where: { email: identity.email } });
  return { context, request: context.request, page, user };
}

function card(page, title) { return page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) }); }
function action(page, name) { return page.getByRole("button", { name, exact: true }); }
async function details(page, title) {
  await action(card(page, title), "Просмотреть").click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
}
async function save(page) {
  await action(page, "Сохранить").click();
  await expect(page.getByRole("status").filter({ hasText: "Достижение сохранено." })).toBeVisible();
}
async function command(request, body, headers = origin) {
  return request.post(endpoint, { headers, data: body });
}
function claimed(operation, record, extra = {}) { return { operation, id: record.id, version: record.version, ...extra }; }
function fileUrl(id) { return endpoint + "?file=" + id; }
async function noOverflow(page, label) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Horizontal overflow at " + label);
}
const report = message => console.info("PASS: " + message);

try {
  for (let attempt = 0; ; attempt++) {
    if (await fetch(base + "/login").then(response => response.ok, () => false)) break;
    assert(attempt < 120 && child.exitCode === null, "Next did not start");
    await new Promise(done => setTimeout(done, 500));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
  const student = await signIn(0), other = await signIn(1), dean = await signIn(5);
  const page = student.page;
  const group = await db.studentProfile.findUniqueOrThrow({ where: { userId: student.user.id }, include: { group: true } });
  const departmentId = group.group.departmentId;
  assert(departmentId);
  await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: dean.user.id } });

  await page.goto(base + studentPath);
  await expect(page.getByRole("heading", { name: "Добавьте первое достижение" })).toBeVisible();
  await action(page, "Добавить достижение").click();
  await page.getByLabel("Название").fill("Курсовой проект");
  await page.getByLabel("Категория").selectOption("PROJECT");
  await page.getByLabel("Дата достижения").fill("29.02.2024");
  await page.getByLabel("Описание").fill("Каталог научной библиотеки.");
  await save(page);
  await expect(card(page, "Курсовой проект")).toContainText("Нет вложений");

  const image = sharp({ create: { width: 140, height: 90, channels: 3, background: "#71945d" } });
  const png = await image.clone().png().toBuffer(), jpeg = await image.clone().jpeg().toBuffer(), webp = await image.clone().webp().toBuffer();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Portfolio", { x: 72, y: 680, size: 26 });
  const pdfBytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  await action(page, "Добавить достижение").click();
  await page.getByLabel("Название").fill("Медаль олимпиады");
  await page.getByLabel("Категория").selectOption("COMPETITION");
  await page.getByLabel("Дата достижения").fill("14.03.2025");
  await page.getByLabel("Результат").fill("Первое место");
  await page.getByLabel("Ссылка").fill("https://example.test/contest");
  await page.getByLabel("Достижение отмечено наградой").check();
  await page.getByLabel("Прикрепить файлы").setInputFiles([
    { name: "Диплом.PNG", mimeType: "image/png", buffer: png },
    { name: "Документ.pdf", mimeType: "application/pdf", buffer: pdfBytes },
    { name: "Фото.jpg", mimeType: "image/jpeg", buffer: jpeg },
    { name: "Эскиз.webp", mimeType: "image/webp", buffer: webp },
  ]);
  await expect.poll(() => page.getByRole("img", { name: "Предпросмотр Диплом.PNG" }).evaluate(img => img.naturalWidth)).toBe(140);
  await save(page);
  await expect(card(page, "Медаль олимпиады")).toContainText("Вложений: 4");
  await expect(page.locator(".portfolio-stats dd")).toHaveText(["2", "1", "1"]);
  await page.getByLabel("Категория").selectOption("PROJECT");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card(page, "Курсовой проект")).toBeVisible();
  await page.getByLabel("Год").selectOption("2025");
  await expect(page.getByText("По этим фильтрам ничего не найдено")).toBeVisible();
  await page.getByLabel("Категория").selectOption("");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(card(page, "Медаль олимпиады")).toBeVisible();
  await page.getByLabel("Год").selectOption("");
  report("Создание с файлами и без, данные календаря, статистика и оба фильтра");

  await details(page, "Медаль олимпиады");
  for (const name of ["Диплом.PNG", "Фото.jpg", "Эскиз.webp"]) {
    const preview = page.getByRole("img", { name, exact: true });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(img => img.naturalWidth)).toBe(140);
  }
  const record = () => db.portfolioAchievement.findFirstOrThrow({ where: { ownerId: student.user.id, category: "COMPETITION" }, include: { attachments: true } });
  let entry = await record();
  const document = entry.attachments.find(file => file.mime === "application/pdf");
  const picture = entry.attachments.find(file => file.mime === "image/png");
  assert(document && picture);
  const pdfOpening = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Открыть PDF" }).click();
  const pdfTab = await pdfOpening;
  await pdfTab.waitForLoadState("domcontentloaded");
  assert.equal(pdfTab.url(), fileUrl(document.id));
  // The Chromium PDF viewer paints after the outer document has loaded.
  await expect.poll(async () => {
    const screenshot = await pdfTab.screenshot();
    const { data } = await sharp(screenshot).extract({ left: 800, top: 220, width: 40, height: 40 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return data.some(channel => channel > 245);
  }).toBe(true);
  await pdfTab.screenshot({ path: resolve(root, "pdf-preview.png") });
  await pdfTab.close();
  const pdfResponse = await student.request.get(fileUrl(document.id));
  assert.equal(pdfResponse.headers()["content-type"], "application/pdf");
  assert.match(pdfResponse.headers()["content-disposition"], /^inline/);
  assert.deepEqual(await pdfResponse.body(), pdfBytes);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать Диплом.PNG" }).click();
  assert.equal((await download).suggestedFilename(), "Диплом.PNG");
  report("Предпросмотр JPEG/PNG/WebP, открытие PDF и скачивание с исходным именем");

  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(fileUrl(picture.id))).status(), 401);
  const anonymousPage = await anonymous.newPage();
  for (const path of [studentPath, deanPath]) {
    await anonymousPage.goto(base + path);
    await expect(anonymousPage).toHaveURL(/\/login/);
  }
  await anonymous.close();
  await other.page.goto(base + studentPath);
  await expect(other.page.getByText("Добавьте первое достижение")).toBeVisible();
  assert.equal((await other.request.get(fileUrl(picture.id))).status(), 404);
  assert.equal((await command(other.request, claimed("delete", entry))).status(), 404);
  assert.equal((await other.request.post(endpoint, { headers: origin, multipart: {
    title: "Чужое изменение", category: "COMPETITION", id: entry.id, version: String(entry.version),
  } })).status(), 404);
  assert.equal((await command(student.request, claimed("delete", entry), { Origin: "https://example.test" })).status(), 403);
  for (const index of [2, 3, 4]) {
    const role = await signIn(index);
    for (const path of [studentPath, deanPath]) {
      await role.page.goto(base + path);
      await expect(role.page).not.toHaveURL(base + path);
    }
    assert.equal((await role.request.get(fileUrl(picture.id))).status(), 403);
    assert.equal((await command(role.request, claimed("delete", entry))).status(), 403);
    await role.context.close();
  }
  const bad = await student.request.post(endpoint, { headers: origin, multipart: {
    title: "Повреждённый файл", category: "PROJECT",
    files: { name: "file.png", mimeType: "image/png", buffer: Buffer.from("<svg/>") },
  } });
  assert.equal(bad.status(), 400);
  const svg = await student.request.post(endpoint, { headers: origin, multipart: {
    title: "SVG", category: "PROJECT", files: { name: "file.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") },
  } });
  assert.equal(svg.status(), 415);
  const tooLarge = await student.request.post(endpoint, { headers: origin, multipart: {
    title: "Большой файл", category: "PROJECT", files: { name: "oversize.png", mimeType: "image/png", buffer: Buffer.alloc(8 * 1024 * 1024 + 1) },
  } });
  assert.equal(tooLarge.status(), 413);
  assert.equal(await db.portfolioAchievement.count(), 2);
  assert.equal(readdirSync(documents).length, 4);
  report("Изоляция владельцев, ограничения всех ролей, origin и серверная валидация файлов");

  const assignment = { userId: dean.user.id, departmentId };
  const outsider = await db.academicDepartment.create({ data: { faculty: "Проверка", name: "Чужое подразделение" } });
  await db.deaneryDepartmentAssignment.create({ data: { ...assignment, departmentId: outsider.id } });
  await db.deaneryDepartmentAssignment.create({ data: assignment });
  assert.equal((await dean.request.get(fileUrl(picture.id))).status(), 404);
  await action(page, "Отправить на проверку").click();
  await expect(page.getByText("На проверке", { exact: true })).toBeVisible();
  entry = await record();
  await db.deaneryDepartmentAssignment.delete({ where: { userId_departmentId: assignment } });
  await dean.page.goto(base + deanPath);
  await expect(dean.page.getByText("Нет достижений на проверке")).toBeVisible();
  assert.equal((await command(dean.request, claimed("review", entry, { verdict: "CONFIRMED" }))).status(), 404);
  await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: dean.user.id } });
  assert.equal((await dean.request.get(fileUrl(picture.id))).status(), 404);
  await db.deaneryDepartmentAssignment.create({ data: assignment });
  await dean.page.reload();
  await details(dean.page, "Медаль олимпиады");
  await expect(dean.page.getByText(student.user.name, { exact: false }).last()).toBeVisible();
  assert.equal((await dean.request.get(fileUrl(picture.id))).status(), 200);
  await db.deaneryDepartmentAssignment.delete({ where: { userId_departmentId: assignment } });
  assert.equal((await dean.request.get(fileUrl(picture.id))).status(), 404);
  assert.equal((await command(dean.request, claimed("review", entry, { verdict: "CONFIRMED" }))).status(), 404);
  await db.deaneryDepartmentAssignment.create({ data: assignment });
  assert.equal((await command(dean.request, claimed("review", entry, { verdict: "REJECTED" }))).status(), 400);
  await action(dean.page, "Отклонить").click();
  await dean.page.getByLabel("Причина отклонения").fill("Нужно уточнить название олимпиады.");
  await action(dean.page, "Отклонить достижение").click();
  await expect(dean.page.getByText("Решение сохранено.")).toBeVisible();
  assert.equal((await dean.request.get(fileUrl(picture.id))).status(), 404);

  await page.reload();
  await details(page, "Медаль олимпиады");
  await expect(page.getByText(/Нужно уточнить название олимпиады/)).toBeVisible();
  await action(page, "Отправить на проверку").click();
  await expect(page.getByText("На проверке", { exact: true })).toBeVisible();
  await dean.page.reload();
  await details(dean.page, "Медаль олимпиады");
  await action(dean.page, "Подтвердить").click();
  await expect(dean.page.getByText("Решение сохранено.")).toBeVisible();

  await page.reload();
  await expect(card(page, "Медаль олимпиады")).toContainText("Подтверждено");
  await action(card(page, "Медаль олимпиады"), "Редактировать").click();
  await save(page);
  await expect(card(page, "Медаль олимпиады")).toContainText("Подтверждено");
  const confirmed = await record();
  assert.equal(await db.portfolioDecision.count({ where: { achievementId: confirmed.id } }), 2);
  await action(card(page, "Медаль олимпиады"), "Редактировать").click();
  await action(page, "Удалить файл Диплом.PNG").click();
  await save(page);
  await expect(card(page, "Медаль олимпиады")).toContainText("Вложений: 3");
  await expect(card(page, "Медаль олимпиады").getByText("Подтверждено")).toHaveCount(0);
  assert.equal((await student.request.get(fileUrl(picture.id))).status(), 404);
  assert.equal(readdirSync(documents).length, 3);
  assert.equal((await command(student.request, claimed("submit", confirmed))).status(), 409);

  entry = await record();
  const queued = await command(student.request, claimed("submit", entry));
  assert.equal(queued.status(), 200);
  const pending = (await queued.json()).item;
  assert.equal((await command(dean.request, claimed("review", pending, { verdict: "CONFIRMED" }))).status(), 200);
  await page.reload();
  await action(card(page, "Медаль олимпиады"), "Редактировать").click();
  await page.getByLabel("Результат").fill("Первое место в финале");
  await save(page);
  await expect(card(page, "Медаль олимпиады")).toContainText("Первое место в финале");
  await expect(card(page, "Медаль олимпиады").getByText("Подтверждено")).toHaveCount(0);
  await action(card(page, "Медаль олимпиады"), "Редактировать").click();
  await page.getByLabel("Прикрепить файлы").setInputFiles({ name: "Новый диплом.png", mimeType: "image/png", buffer: png });
  await save(page);
  await expect(card(page, "Медаль олимпиады")).toContainText("Вложений: 4");
  assert.equal(readdirSync(documents).length, 4);
  report("Отправка, границы деканата и отзыв назначения, отклонение, история, сброс подтверждения и добавление файла при правке");

  for (const width of [346, 360, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 850 });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await noOverflow(page, width + " " + colorScheme + " list");
      if (width === 346 || width === 1366) {
        await page.screenshot({ path: resolve(root, "portfolio-" + width + "-" + colorScheme + ".png"), fullPage: true, animations: "disabled" });
      }
      await action(card(page, "Медаль олимпиады"), "Редактировать").click();
      await expect(page.getByLabel("Дата достижения")).toBeVisible();
      await page.getByLabel("Дата достижения").press("ArrowDown");
      await expect(page.locator(".schedule-calendar")).toBeVisible();
      await noOverflow(page, width + " " + colorScheme + " calendar");
      await page.keyboard.press("Escape");
      await action(page, "К портфолио").click();
    }
  }
  report("Светлая и тёмная темы при 346, 360, 390, 768 и 1366 px");

  await action(card(page, "Медаль олимпиады"), "Удалить").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await action(page, "Отмена").click();
  await expect(card(page, "Медаль олимпиады")).toBeVisible();
  await action(card(page, "Медаль олимпиады"), "Удалить").click();
  await action(page, "Удалить достижение").click();
  await expect(page.getByText("Достижение удалено.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  assert.equal((await student.request.get(fileUrl(document.id))).status(), 404);
  assert.equal(await db.portfolioAttachment.count(), 0);
  assert.equal(await db.portfolioDecision.count(), 0);
  assert.equal(readdirSync(documents).length, 0);
  await integrity(sqlite);
  assert.deepEqual(errors, []);
  assert.doesNotMatch(logs, diagnostic);
  report("Подтверждение удаления, очистка вложений и целостность изолированной SQLite");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  child.kill();
  sqlite.close();
  await db.$disconnect();
}
