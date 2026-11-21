import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import { hashPassword } from "better-auth/crypto";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { roleLabels, roleHomes as homes } from "../src/lib/roles.ts";
import { provisionTestDatabase } from "./test-fixtures.mjs";
import { verifyStudentProfile } from "./student-profile-checks.mjs";
import { verifyProfileSettings } from "./profile-settings-checks.mjs";

const observe = process.argv.includes("--observe"), production = process.argv.includes("--production");
mkdirSync(".local", { recursive: true });
const root = mkdtempSync(resolve(".local/cabinet-navigation-")), project = resolve(root, "project");
const source = createClient({ url: getDatabaseUrl() });
async function fingerprint() {
  const tables = (await source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows;
  const rows = [];
  for (const { name } of tables) rows.push([name, (await source.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows]);
  return createHash("sha256").update(JSON.stringify(rows, (_, v) => typeof v === "bigint" ? String(v) : v)).digest("hex");
}
const before = await fingerprint();
process.env.DATABASE_URL = provisionTestDatabase(resolve(root, "test.db")).DATABASE_URL;
// This test writes profile fixtures from a second process while Next serves
// reads. WAL is scoped to this newly provisioned SQLite database only.
const fixtureJournal = createClient({ url: process.env.DATABASE_URL });
await fixtureJournal.execute("PRAGMA journal_mode = WAL"); fixtureJournal.close();
const db = createPrismaClient(), password = randomBytes(24).toString("base64url");
await db.account.updateMany({ where: { providerId: "credential" }, data: { password: await hashPassword(password) } });
// Keep the user's running next dev and its build cache untouched as well.
if (!production) {
  mkdirSync(project);
  for (const folder of ["src", "public"]) cpSync(folder, resolve(project, folder), { recursive: true });
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "AGENTS.md", ".gitignore"]) cpSync(file, resolve(project, file));
  writeFileSync(resolve(project, "next.config.ts"), readFileSync("next.config.ts", "utf8")
    .replace("turbopack: {", `turbopack: { root: ${JSON.stringify(resolve(".").replaceAll("\\", "/"))},`)
    // The loader defaults to the parent process cwd, which includes old test
    // projects. Class candidates belong solely to this isolated source tree.
    .replace('loaders: ["@tailwindcss/turbopack"]', `loaders: [{ loader: "@tailwindcss/turbopack", options: { base: ${JSON.stringify(resolve(project,'src').replaceAll('\\','/'))} } }]`));
  symlinkSync(resolve("node_modules"), resolve(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
}
async function availablePort() {
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return String(port);
}
const port = process.env.CABINET_TEST_PORT ?? await availablePort();
const base = `http://127.0.0.1:${port}`, results = [], diagnostics = [], browserErrors = [];
let logs = "", browser;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", production ? "start" : "dev", production ? resolve(".") : project, "--hostname", "127.0.0.1", "--port", port], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: production ? "production" : "development", NEXT_TELEMETRY_DISABLED: "1", BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), AUTH_TRUST_PROXY: "false", AUTH_PROXY_SECRET: "" } });
child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
const warningPattern = /Next\.js encountered|unstable value|uncached data during|blocking-prerender|Blocking Route|Instant validation/;
function pass(name, evidence = {}) { results.push({ name, ...evidence }); console.info(`PASS: ${name} ${JSON.stringify(evidence)}`); }
async function settle(page) {
  await page.locator("main h1:visible").first().waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 60000 });
  const overlay = await page.locator("nextjs-portal").allTextContents();
  for (const text of overlay) if (warningPattern.test(text)) diagnostics.push({ url: page.url(), type: "overlay", message: text });
}
async function verifyNotificationsNavigation(page, context) {
  await page.goto(base + '/dashboard/notifications'); await settle(page);
  await expect(page.locator('main h1:visible')).toHaveText('Уведомления');
  await page.goto(base + '/dashboard'); await settle(page);
  await page.locator('.home-notifications').scrollIntoViewIfNeeded();
  // Next's installed Link explicitly disables prefetch in development.
  // Assert prefetched timing in production; dev still checks every actual
  // navigation, loading diagnostics, session/role refresh and ownership.
  await page.locator('.home-notifications').hover();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.__notificationNavClicked = false;
    document.querySelector('.home-notifications').addEventListener('click', () => { window.__notificationNavClicked = true; }, { once: true });
  });
  const network = await context.newCDPSession(page);
  await network.send('Network.enable');
  if (production) await network.send('Network.emulateNetworkConditions', { offline: false, latency: 2500, downloadThroughput: 1000000, uploadThroughput: 1000000 });
  const before = await page.evaluate(() => performance.timeOrigin);
  try {
    // Partial Prefetching may already have the non-personal inbox shell. Both
    // that shell and the Suspense fallback are valid instant UI. Require one
    // before the deliberately delayed network response could have completed.
    await Promise.all([
      page.locator('.home-notifications').click(),
      (async () => {
        await page.waitForFunction(() => window.__notificationNavClicked);
        if (production) await expect(page.locator('section[aria-busy=true][aria-label]').or(page.getByRole('heading', { name: 'Уведомления', level: 1, exact: true })).first()).toBeVisible({ timeout: 1500 });
      })(),
    ]);
  } finally {
    await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await network.detach();
  }
  await page.waitForURL(base + '/dashboard/notifications'); await settle(page);
  await expect(page.locator('main h1:visible')).toHaveText('Уведомления');
  assert.equal(await page.evaluate(() => performance.timeOrigin), before);
  await page.goto(base + '/dashboard'); await settle(page);
  await page.locator('.desktop-sidebar a[href="/dashboard/notifications"]').click(); await settle(page);
  await expect(page.locator('main h1:visible')).toHaveText('Уведомления');
  const anonymous = await browser.newContext();
  try { const denied = await anonymous.newPage(); await denied.goto(base + '/dashboard/notifications'); await denied.waitForURL(base + '/login'); } finally { await anonymous.close(); }
  assert.equal((await context.request.get(base + '/api/services?view=events')).status(), 200);
  pass('Notifications: direct URL, home widget, sidebar, inbox/loading shell and anonymous denial', { mode: production ? 'production' : 'development', slowPrefetchedNavigation: production });
}
async function verifyProfile(page, context, actor, home) {
  const user = await db.user.findUniqueOrThrow({ where: { email: actor.email } });
  const foreign = await db.user.findUniqueOrThrow({ where: { email: "maria.volkova@example.test" } });
  const field = label => page.locator('.profile-fields:visible > div').filter({ has: page.locator('dt', { hasText: new RegExp('^' + label + '$') }) }).locator('dd');
  await expect(page.locator('.header-profile')).toHaveAttribute('href', home + '/profile');
  await page.locator('.header-profile .avatar').click();
  await page.waitForURL(base + home + '/profile'); await settle(page);
  await expect(page.locator('main h1:visible')).toHaveText('Профиль');
  await expect(page.locator('.desktop-sidebar a[aria-current=page]')).toHaveAttribute('href', home + '/profile');
  if (actor.role === 'STUDENT') {
    await verifyStudentProfile({page,context,db,user,foreign,base,settle,field,password});
  } else {
  assert.equal((await context.request.get(base+'/api/student/profile/photo')).status(),403);
  await expect(field('Имя и фамилия')).toHaveText(user.name);
  await expect(field('Электронная почта')).toHaveText(user.email);
  await expect(field('Роль')).toHaveText(roleLabels[user.role]);
  await expect(field('Подтверждение почты')).toHaveText(user.emailVerified ? 'Подтверждена' : 'Не подтверждена');
  await expect(field('Дата регистрации')).toHaveText(new Intl.DateTimeFormat('ru-RU', {dateStyle:'long', timeZone:'Europe/Moscow'}).format(user.createdAt));
  assert.equal(await page.locator('.user-profile input, .user-profile select, .user-profile button').count(), 0);
  const projections = {
    TEACHER: ['teacherProfile', 'Кафедра', 'department'],
    TECHNICAL_STAFF: ['technicalStaffProfile', 'Подразделение', 'department'],
  };
  const projection = projections[actor.role];
  if (actor.role === 'DEANERY_STAFF') {
    const profile = await db.deaneryStaffProfile.findUnique({ where: {userId:user.id}, include: { departments: {include:{department:true},orderBy:{department:{name:'asc'}}} } });
    await expect(field('Должность')).toHaveText(profile?.position || 'Не заполнено');
    await expect(field('Назначенные подразделения')).toHaveText(profile?.departments.map(item=>item.department.faculty+' · '+item.department.name).join('; ') || 'Не заполнено');
  }
  if (projection) {
    const [table, label, property] = projection;
    const profile = await db[table].findUnique({ where: { userId: user.id } });
    await expect(field(label)).toHaveText(profile?.[property]?.trim() ? profile[property] : 'Не заполнено');
    const expected = actor.role === 'TEACHER' ? [
      ['Должность', profile?.position], ['Имя в публичном расписании', profile?.publicName],
      ['Публикация в расписании', profile ? profile.isSchedulePublic ? 'Включена' : 'Отключена' : null],
    ] : [['Должность', profile?.jobTitle]];
    for (const [label, value] of expected) await expect(field(label)).toHaveText(value !== null && value !== undefined && String(value).trim() ? String(value) : 'Не заполнено');
    if (profile) {
      // Missing and empty fields must not acquire invented defaults.
      for (const value of [null, '']) {
        await db[table].update({ where: { userId: user.id }, data: { [property]: value } });
        await page.reload(); await settle(page);
        await expect(field(label)).toHaveText('Не заполнено');
      }
      await db[table].update({ where: { userId: user.id }, data: { [property]: profile[property] } });
      if (actor.role === 'TECHNICAL_STAFF') {
        await db[table].delete({where:{userId:user.id}});
        await page.reload(); await settle(page);
        await expect(field(label)).toHaveText('Не заполнено');
        await expect(field('Должность')).toHaveText('Не заполнено');
        await db[table].create({data:profile});
      }
    }
  }
  }
  await page.goto(base + home + '/profile?userId=' + foreign.id + '&id=' + foreign.id + '&email=' + foreign.email);
  await settle(page);
  await expect(field(actor.role === 'STUDENT' ? 'Университетская электронная почта' : 'Электронная почта')).toHaveText(user.email);
  assert(!(await page.locator('.user-profile').innerText()).includes(foreign.email), 'Foreign profile disclosed');
  await page.screenshot({ path: resolve(root, `${actor.role.toLowerCase()}-profile.png`), fullPage: true });
  const mobile = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage();
  phone.setDefaultNavigationTimeout(120000);
  phone.on('pageerror', error => browserErrors.push(error.message));
  phone.on('console', message => { if(warningPattern.test(message.text()))diagnostics.push({url:phone.url(),type:message.type(),message:message.text()}); });
  await phone.goto(base + home); await settle(phone);
  await phone.locator('.header-profile').tap(); await phone.waitForURL(base + home + '/profile'); await settle(phone);
  await expect(phone.locator('.user-profile')).toContainText(user.email);
  await phone.getByRole('button', { name: 'Открыть меню', exact: true }).tap();
  await expect(phone.locator('.mobile-menu a[href="' + home + '/profile"]')).toHaveAttribute('aria-current', 'page');
  await phone.locator('.mobile-menu a[href="' + home + '/profile"]').tap();
  await expect(phone.locator('.mobile-menu')).not.toBeVisible();
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Profile mobile overflow');
  await phone.screenshot({ path: resolve(root, `${actor.role.toLowerCase()}-profile-mobile.png`), fullPage: true });
  await mobile.close();
  await page.goto(base + home); await settle(page);
  pass(`${actor.role}: profile links and ownership`, { avatar: true, menu: true, mobile: true, realDatabaseFields: true, missingFields: actor.role !== 'ADMIN', spoofedOwnerIgnored: true, readOnly: true });
}
try {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    assert(child.exitCode===null,'Isolated navigation server exited; see private server.log');
    try { if ((await fetch(base + "/api/auth/get-session", { signal: AbortSignal.timeout(10000) })).ok) { ready = true; break; } } catch { /* compilation */ }
    await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, "Isolated navigation server unavailable");
  if (!production) {
    const started=performance.now();
    const response=await fetch(base+'/dashboard/profile',{redirect:'manual',signal:AbortSignal.timeout(120000)});
    // Streaming HTML can carry the redirect, so verify the full response too.
    const body=await response.text();
    assert(response.status===307 || (response.status===200 && body.includes('/login')),'Cold profile request failed');
    pass('Cold profile compilation',{milliseconds:Math.round(performance.now()-started),status:response.status});
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  assert.equal((await anonymous.request.get(base+'/api/student/profile/photo')).status(),401);
  anonymousPage.setDefaultNavigationTimeout(120000);
  for (const home of Object.values(homes)) { await anonymousPage.goto(base + home + '/profile'); await anonymousPage.waitForURL(base + '/login'); }
  await anonymous.close();
  pass('Anonymous profiles', { denied: Object.keys(homes).length });
  for (const actor of demoAccounts.filter(a => a.email !== "maria.volkova@example.test")) {
    if (process.argv.includes("--student-only") && actor.role !== "STUDENT") continue;
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: "reduce" });
    const signed = await context.request.post(base + "/api/auth/sign-in/email", { headers: { Origin: base }, data: { email: actor.email, password } });
    assert.equal(signed.status(), 200);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(120000);
    page.on("console", message => { if (warningPattern.test(message.text())) diagnostics.push({ url: page.url(), type: message.type(), message: message.text() }); });
    page.on("pageerror", error => { browserErrors.push(error.message); });
    const home = homes[actor.role];
    console.info(`Checking ${actor.role} navigation in ${production ? "next start" : "next dev"}...`);
    await page.goto(base + home); await settle(page);
    const documentTime = await page.evaluate(() => performance.timeOrigin);
    const links = await page.locator(".desktop-sidebar .sidebar-nav a").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")).filter(href => href && href !== location.pathname));
    for (const href of links) {
      await page.locator(`.desktop-sidebar .sidebar-nav a[href="${href}"]`).click({ force: observe });
      await page.waitForURL(base + href); await settle(page);
      await page.locator(`.desktop-sidebar .sidebar-nav a[href="${home}"]`).click({ force: observe });
      await page.waitForURL(base + home); await settle(page);
    }
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentTime, "Menu navigation reloaded the document");
    await page.screenshot({ path: resolve(root, `${actor.role.toLowerCase()}.png`), fullPage: true });
    pass(`${actor.role}: direct visit, menu and return home`, { sections: links.length });
    if (!observe && actor.role === 'DEANERY_STAFF') {
      await page.goto(base + '/deanery/schedule'); await settle(page);
      for (const width of [1366, 360]) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('.theme-toggle').click();
        await page.getByRole('menuitemradio', { name: theme === 'light' ? 'Светлая' : 'Тёмная', exact: true }).click();
        await page.getByRole('button', { name: 'Добавить регулярную пару', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Редактор занятия' });
        await expect(dialog).toContainText('Это изменение затронет регулярное расписание всех недель учебного периода.');
        await expect(dialog).not.toContainText('Это действие относится только к конкретной дате.');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Regular lesson dialog page overflow');
        await page.screenshot({ path: resolve(root, `regular-create-${width}-${theme}.png`), fullPage: true, caret: 'initial' });
        await page.keyboard.press('Escape');
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.goto(base + home); await settle(page);
      pass('Regular lesson creation warns about all weeks, not a single date', { widths: [1366, 360], themes: ['light', 'dark'] });
    }
    if (!observe && actor.role === 'STUDENT') await verifyNotificationsNavigation(page, context);
    if (!observe) await verifyProfile(page, context, actor, home);
    if (!observe) {
      await verifyProfileSettings({ page, context, db, actor, home, base, password, root, settle });
      pass(`${actor.role}: compact settings and password security`, { widths: [346, 360, 390, 1366], themes: ['light', 'dark'] });
    }
    if (!observe) {
      for (const other of Object.values(homes).filter(path => path !== home)) {
        await page.goto(base + other); await page.waitForURL(base + home); await settle(page);
        await page.goto(base + other + '/profile'); await page.waitForURL(base + home); await settle(page);
      }
      // Role updates must take effect on the next request, without a session cache.
      const user = await db.user.findUniqueOrThrow({ where: { email: actor.email } });
      const newRole = actor.role === "ADMIN" ? "TEACHER" : "ADMIN";
      await db.user.update({ where: { id: user.id }, data: { role: newRole } });
      assert.equal((await context.request.get(base+'/api/student/profile/photo')).status(),403);
      await page.goto(base + home + '/profile'); await page.waitForURL(base + homes[newRole]); await settle(page);
      await page.goto(base + home); await page.waitForURL(base + homes[newRole]); await settle(page);
      await db.user.update({ where: { id: user.id }, data: { role: actor.role } });
      await page.goto(base + home); await settle(page);
      const cookie = (await context.cookies()).map(c => `${c.name}=${c.value}`).join("; ");
      await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).filter({ visible: true }).click();
      await page.waitForURL(base + "/login");
      assert.equal((await context.request.get(base + "/api/auth/get-session", { headers: { Cookie: cookie } })).status(), 200);
      assert.equal(await (await context.request.get(base + "/api/auth/get-session", { headers: { Cookie: cookie } })).json(), null);
      await page.goto(base + home); await page.waitForURL(base + "/login");
      pass(`${actor.role}: changed role, foreign cabinets and logout`, { secure: true });
    }
    await context.close();
  }
  assert.equal(await fingerprint(), before, "Source database changed");
  if (!observe) {
    assert.deepEqual(diagnostics, [], "Next.js warnings in browser");
    assert.deepEqual(browserErrors, [], "Browser runtime errors");
    assert(!warningPattern.test(logs), "Next.js warnings in server log");
  }
  pass("Navigation diagnostics", { mode: production ? "production" : "development", observe, browserWarnings: diagnostics.length, browserErrors: browserErrors.length, sourceUnchanged: true });
} finally {
  await browser?.close(); child.kill(); await db.$disconnect(); source.close();
  writeFileSync(resolve(root, "server.log"), logs.replaceAll(password, "[REDACTED]"), { mode: 0o600 });
  writeFileSync(resolve(root, "results.json"), JSON.stringify({ results, diagnostics, browserErrors }, null, 2));
  console.info(`Navigation report: ${root.replaceAll("\\", "/")}/results.json`);
}
