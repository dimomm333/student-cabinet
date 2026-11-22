import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import { hashPassword } from "better-auth/crypto";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { currentAcademicDate, formatDateInput, isoDate, mondayOf } from "../src/lib/schedule-calendar.ts";
import { verifyTouchCalendar } from "./calendar-touch-checks.mjs";

// All credentials, sessions and fixture edits belong to a SQLite copy.
mkdirSync(".local", { recursive: true });
const folder = mkdtempSync(resolve(".local/schedule-browser-test-"));
const source = createClient({ url: getDatabaseUrl() });
async function fingerprint() {
  const names = (await source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows.map(r => r.name);
  const rows = [];
  for (const name of names) rows.push([name, (await source.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows]);
  return createHash("sha256").update(JSON.stringify(rows, (_, v) => typeof v === "bigint" ? String(v) : v)).digest("hex");
}
const before = await fingerprint();
const file = resolve(folder, "test.db");
await source.execute({ sql: "VACUUM INTO ?", args: [file] });
process.env.DATABASE_URL = "file:" + file.replaceAll("\\", "/");
const db = createPrismaClient();
const password = randomBytes(24).toString("base64url");
await db.account.updateMany({ where: { providerId: "credential" }, data: { password: await hashPassword(password) } });
const otherStudent = await db.user.findUniqueOrThrow({ where: { email: "maria.volkova@example.test" } });
const otherGroup = await db.studyGroup.findUniqueOrThrow({ where: { slug: "pi-24-2" } });
await db.studentProfile.update({ where: { userId: otherStudent.id }, data: { groupId: otherGroup.id } });
const base = "http://127.0.0.1:3204", results = [], errors = [];
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3204"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), BETTER_AUTH_URL: base, AUTH_TRUST_PROXY: "false", AUTH_PROXY_SECRET: "" } });
let serverLog = "", browser;
child.stdout.on("data", data => { serverLog += data; }); child.stderr.on("data", data => { serverLog += data; });
function pass(name, details = {}) { results.push({ name, ...details }); console.info(`PASS: ${name} ${JSON.stringify(details)}`); }

async function verifyDatePicker(page, touch = false) {
  const input = page.locator('.schedule-date-input input');
  await input.scrollIntoViewIfNeeded();
  const initialUrl = page.url();
  await input.fill('');
  for (const character of '15.12.2026') {
    await input.pressSequentially(character);
    assert.equal(page.url(), initialUrl, 'Typing navigated before confirmation');
  }
  await expect(input).toHaveValue('15.12.2026');
  await input.fill('15.12.2026'); await input.press('Enter');
  await expect(input).toHaveValue('15.12.2026');
  await expect(input).toBeFocused();
  await expect(page.locator('.schedule-day-card')).toHaveCount(1);
  await expect(page.locator('.schedule-days [aria-current=page]')).toContainText('15');
  assert.equal(new URL(page.url()).searchParams.get('week'), '2026-12-14');
  assert.equal(new URL(page.url()).searchParams.get('day'), '2');
  await input.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  const scrolls = { before };
  await page.getByRole('button', {name:'Открыть календарь'}).click();
  const calendar = page.locator('.schedule-calendar');
  const heading = calendar.locator('strong');
  await expect(heading).toContainText('декабрь 2026');
  if (!touch) {
    await calendar.hover(); await page.mouse.wheel(0,120);
  } else {
    await page.getByRole('button', {name:'Следующий месяц',exact:true}).tap();
  }
  await expect(heading).toContainText('январь 2027');
  await expect(calendar.locator('[data-date="2027-01-15"]')).toBeVisible();
  await page.getByRole('button',{name:'Предыдущий месяц',exact:true}).click();
  await expect(heading).toContainText('декабрь 2026');
  await page.getByRole('button',{name:'Предыдущий месяц',exact:true}).click();
  await expect(heading).toContainText('ноябрь 2026');
  if (!touch) {
    await page.waitForTimeout(200); await calendar.hover(); await page.mouse.wheel(0,-120);
    await expect(heading).toContainText('октябрь 2026');
    await page.waitForTimeout(200); await page.mouse.wheel(0,120);
    await expect(heading).toContainText('ноябрь 2026');
  }
  await input.press('Escape');
  scrolls.escape = await page.evaluate(() => scrollY);
  const url = page.url();
  for (const value of ['1', '15.12.', '31.02.2027', '29.02.2027', '2027-12-15', '01.01.2100', '']) {
    await input.fill(value); await input.press('Enter');
    await expect(input).toHaveValue(value);
    await expect(input).toHaveAttribute('aria-invalid','true');
    assert.equal(page.url(), url, 'Invalid input navigated');
  }
  await input.fill('29.02.2028'); await input.press('Enter');
  scrolls.leap = await page.evaluate(() => scrollY);
  await expect(input).toHaveValue('29.02.2028');
  await expect(page.locator('.schedule-days [aria-current=page]')).toContainText('29');
  await page.getByRole('button',{name:'Открыть календарь'}).click();
  await expect(heading).toContainText('февраль 2028');
  await expect(calendar.locator('[data-date="2028-02-29"]')).toHaveAttribute('aria-pressed','true');
  await calendar.locator('[data-date="2028-02-29"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(heading).toContainText('март 2028');
  await expect(calendar.locator('[data-date="2028-03-01"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('01.03.2028');
  await expect(page.locator('.schedule-days [aria-current=page]')).toContainText('1');
  scrolls.end = await page.evaluate(() => scrollY);
  assert(Math.abs(scrolls.end - before) < 3, 'Date picker changed page scroll: ' + JSON.stringify(scrolls));
  await page.goBack(); await expect(input).toHaveValue('29.02.2028');
  await page.getByRole('button', {name:'Открыть календарь'}).click();
  await page.screenshot({ path: resolve(folder, 'calendar-' + (touch ? 'mobile-' : 'desktop-') + new URL(page.url()).pathname.replaceAll('/', '-') + '.png'), fullPage: true });
  await input.press('Escape');
  pass('Date picker ' + new URL(page.url()).pathname + (touch ? ' mobile' : ' desktop'), {monthWheel:!touch, yearBoundary:true, invalidDraft:true, leapDay:true, keyboard:true, scheduleSync:true, history:true, stableScroll:true});
}

try {
  let ready = false;
  for (let n = 0; n < 40; n++) {
    try { const response = await fetch(base + "/api/auth/get-session"); if (response.ok) { ready = true; break; } } catch { /* cold start */ }
    await new Promise(done => setTimeout(done, 200));
  }
  assert(ready, "Browser test server not ready");
  // Use installed Chrome, or set PLAYWRIGHT_CHANNEL=msedge; no browser download.
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
  const touch = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true,
    timezoneId: "America/Los_Angeles", reducedMotion: "reduce" });
  const phoneMatrix = await touch.newPage();
  phoneMatrix.on("pageerror", error => errors.push(error.message));
  await phoneMatrix.goto(base + "/schedule?group=pi-24-1&week=2026-11-09");
  const picker = phoneMatrix.locator(".schedule-date-picker");
  for (const theme of ["light", "dark"]) {
    await phoneMatrix.locator("html").evaluate((html, value) => html.setAttribute("data-theme", value), theme);
    for (const width of [320, 346, 360, 390, 768]) {
      await phoneMatrix.setViewportSize({ width, height: 640 });
      await verifyTouchCalendar(phoneMatrix, picker);
    }
    await phoneMatrix.setViewportSize({ width: 360, height: 250 });
    await verifyTouchCalendar(phoneMatrix, picker, { short: true });
  }
  await phoneMatrix.setViewportSize({ width: 360, height: 640 });
  await phoneMatrix.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  const trigger = picker.getByRole("button", { name: "Открыть календарь", exact: true });
  await trigger.tap();
  await picker.locator('[data-date="2026-11-11"]').tap();
  await expect(picker.locator('input[type=text]')).toHaveValue("11.11.2026");
  await expect(picker.locator(".schedule-calendar")).toBeHidden();
  await trigger.tap();
  await expect(picker.locator('[data-date="2026-11-11"]')).toHaveAttribute("aria-pressed", "true");
  const reopened = picker.locator(".schedule-calendar");
  for (const height of [280, 640]) {
    await phoneMatrix.setViewportSize({ width: 360, height });
    await expect.poll(() => reopened.evaluate(element => {
      const box = element.getBoundingClientRect();
      return Math.abs(visualViewport.height - box.bottom - 8) < 1 && box.top >= 0;
    })).toBe(true);
    await expect(reopened.locator('[aria-pressed="true"]')).toHaveAttribute("data-date", "2026-11-11");
  }
  await phoneMatrix.screenshot({ path: resolve(folder, "calendar-touch-360.png") });
  await touch.close();
  pass("Native touch scroll, month/year changes and date selection", { widths: [320, 346, 360, 390, 768], themes: 2, shortViewport: "360x250" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Vladivostok", reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  let scheduleRequests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/schedule") scheduleRequests++; });
  await page.goto(base + "/schedule?group=pi-24-1&week=2026-11-09");
  await verifyDatePicker(page);
  await page.goto(base + '/schedule?group=pi-24-1&week=2026-11-09');
  const search = page.getByRole("combobox", { name: "Поиск группы" });
  await expect(search).toBeVisible();
  const documentTime = await page.evaluate(() => performance.timeOrigin);
  const requestsBeforeTyping = scheduleRequests;
  for (const text of ["пи-24", "ПИ-24", "Пи-24", "  пИ-24  "]) {
    await search.fill(text); await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
  }
  assert.equal(scheduleRequests, requestsBeforeTyping, "Typing must not request timetable data");
  await search.press("ArrowUp"); await search.press("Enter");
  await expect(page.locator("#schedule-result-title")).toHaveText("ПИ-24-2");
  await expect(search).toBeFocused();
  await page.goBack(); await expect(page.locator("#schedule-result-title")).toHaveText("ПИ-24-1");
  await page.goForward(); await expect(page.locator("#schedule-result-title")).toHaveText("ПИ-24-2");
  await search.fill("ничего-не-существует"); await expect(page.getByText("Ничего не найдено. Измените запрос.")).toBeVisible();
  await search.press("Escape"); await expect(search).toHaveAttribute("aria-expanded", "false");
  await search.fill("пи-24-1"); await page.getByRole("option", { name: "ПИ-24-1" }).click();
  await expect(page.locator("#schedule-result-title")).toHaveText("ПИ-24-1");
  await page.getByText("Все учебные группы", { exact: true }).click();
  await expect(page.getByText("Институт цифровых технологий", { exact: true })).toBeVisible();
  await expect(page.locator(".schedule-directory").getByText("Прикладная информатика", { exact: true })).toBeVisible();
  await page.getByText("Институт цифровых технологий", { exact: true }).click();
  await expect(page.getByRole("button", { name: "ПИ-24-1", exact: true })).toBeHidden();
  await page.getByText("Все учебные группы", { exact: true }).click();
  pass("Desktop combobox", { caseAndTrim: true, keyboard: true, mouse: true, focus: true, escape: true, noResults: true, noRequestsWhileTyping: true, hierarchyCollapse: true });

  await page.locator(".schedule-days").scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.getByRole("link", { name: "Вторник, 10 ноября", exact: true }).click();
  await expect(page.locator(".schedule-day-card")).toHaveCount(1);
  assert(Math.abs(await page.evaluate(() => scrollY) - scrollBefore) < 3, "Day navigation changed scroll position");
  await page.getByRole("link", { name: "Следующая неделя" }).click();
  await expect(page.getByLabel("Дата учебной недели")).toHaveValue("17.11.2026");
  assert(Math.abs(await page.evaluate(() => scrollY) - scrollBefore) < 3, "Week navigation changed scroll position");
  await page.goBack(); await expect(page.getByLabel("Дата учебной недели")).toHaveValue("10.11.2026");
  await page.goForward(); await expect(page.getByLabel("Дата учебной недели")).toHaveValue("17.11.2026");
  await page.getByLabel("Номер учебной недели").selectOption("demo-autumn-2026:1");
  await expect(page.getByLabel("Дата учебной недели")).toHaveValue("01.09.2026");
  await page.getByLabel("Дата учебной недели").fill("09.11.2026");
  await page.locator(".schedule-date-input input").press("Enter");
  await expect(page.getByLabel("Номер учебной недели")).toHaveValue("demo-autumn-2026:11");
  await page.getByRole("link", { name: "Текущая неделя", exact: true }).click();
  await expect(page.getByLabel("Дата учебной недели")).toHaveValue(formatDateInput(isoDate(mondayOf(currentAcademicDate()))));
  await expect(page.locator(".schedule-day-today")).toHaveCount(1);
  await page.getByRole("link", { name: "Следующая неделя" }).click();
  await expect(page.locator(".schedule-day-today")).toHaveCount(0);
  assert.equal(await page.evaluate(() => performance.timeOrigin), documentTime, "Schedule navigation reloaded document");
  pass("Calendar and history", { stableDayAndWeekScroll: true, backForward: true, numberDateSynchronization: true, currentWeek: true, moscowToday: true, noDocumentReload: true });

  await page.getByRole("link", { name: "По преподавателю", exact: true }).click();
  const teacherSearch = page.getByRole("combobox", { name: "Поиск преподавателя" });
  for (const value of ["белова", "БЕЛОВА", "БеЛоВа", "  БЕЛОВА  "]) { await teacherSearch.fill(value); await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1); }
  await teacherSearch.press("ArrowDown"); await teacherSearch.press("Enter");
  await expect(page.locator("#schedule-result-title")).toHaveText("Анна Белова");
  await page.screenshot({ path: resolve(folder, "desktop.png"), fullPage: true });
  pass("Teacher combobox", { cyrillicCaseAndTrim: true, keyboardSelection: true });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, timezoneId: "America/Los_Angeles", reducedMotion: "reduce" });
  const phone = await mobile.newPage(); phone.on("pageerror", error => errors.push(error.message));
  await phone.goto(base + "/schedule?week=2026-11-09");
  await verifyDatePicker(phone, true);
  await phone.goto(base + '/schedule?group=pi-24-1&week=2026-11-09');
  await phone.getByRole("combobox", { name: "Поиск группы" }).fill("  пи-24-1  ");
  await phone.getByRole("option", { name: "ПИ-24-1" }).tap();
  await expect(phone.locator("#schedule-result-title")).toHaveText("ПИ-24-1");
  await phone.locator(".schedule-days").scrollIntoViewIfNeeded();
  const mobileScroll = await phone.evaluate(() => scrollY);
  await phone.getByRole("link", { name: "Вторник, 10 ноября", exact: true }).tap();
  await expect(phone.locator(".schedule-day-card")).toHaveCount(1);
  assert(Math.abs(await phone.evaluate(() => scrollY) - mobileScroll) < 3, "Mobile day navigation changed scroll");
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile horizontal page overflow");
  await phone.getByRole("link", { name: "Следующая неделя" }).tap();
  await expect(phone.getByLabel("Дата учебной недели")).toHaveValue("17.11.2026");
  await phone.goBack(); await expect(phone.getByLabel("Дата учебной недели")).toHaveValue("10.11.2026");
  await phone.screenshot({ path: resolve(folder, "mobile.png"), fullPage: true });
  pass("Mobile 390px", { touchSearch: true, stableScroll: true, noHorizontalOverflow: true });

  for (const [email, home, expected] of [["alexander.smirnov@example.test", "/dashboard", "ПИ-24-1"], ["maria.volkova@example.test", "/dashboard", "ПИ-24-2"], ["mikhail.sokolov@example.test", "/teacher", "Михаил Соколов"]]) {
    const privateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    const privatePage = await privateContext.newPage(); privatePage.on("pageerror", error => errors.push(error.message));
    await privatePage.goto(base + "/login");
    await privatePage.getByLabel("Университетская почта", { exact: true }).fill(email);
    await privatePage.getByLabel("Пароль", { exact: true }).fill(password);
    await privatePage.locator(".login-form button[type=submit]").click();
    await privatePage.waitForURL(base + home);
    if (home === "/dashboard") await expect(privatePage.getByRole("heading", { name: "Расписание", exact: true })).toBeVisible();
    await privatePage.goto(base + home + "/schedule?week=2026-11-09&group=it-25-1&teacher=anna-belova&userId=foreign");
    await expect(privatePage.locator("#schedule-result-title")).toHaveText(expected);
    await expect(privatePage.locator(".public-lesson").first()).toBeVisible();
    assert(await privatePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await verifyDatePicker(privatePage, true);
    await privatePage.screenshot({ path: resolve(folder, home === "/teacher" ? "teacher.png" : expected === "ПИ-24-1" ? "student.png" : "student-other.png"), fullPage: true });
    await privateContext.close();
  }
  pass("Personal cabinets", { bothStudents: true, teacher: true, spoofedUrlIgnored: true, liveUpcomingBlock: true, mobile: true });
  assert.equal(await fingerprint(), before, "Browser tests changed source database");
  assert.deepEqual(errors, [], "Browser runtime errors");
  assert(!serverLog.includes("unstable value") && !serverLog.includes("Error:"), "Server runtime errors; inspect private log");
  pass("Runtime and database", { browserErrors: 0, serverErrors: 0, sourceUnchanged: true });
} finally {
  await browser?.close(); child.kill(); await db.$disconnect(); source.close();
  writeFileSync(resolve(folder, "server.log"), serverLog.replaceAll(password, "[REDACTED]"), { mode: 0o600 });
  writeFileSync(resolve(folder, "results.json"), JSON.stringify(results, null, 2));
  console.info(`Browser results: ${folder.replaceAll("\\", "/")}/results.json`);
}
