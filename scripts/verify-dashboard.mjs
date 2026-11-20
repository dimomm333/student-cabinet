import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@libsql/client';
import { hashPassword } from 'better-auth/crypto';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { demoAccounts } from '../src/lib/demo-accounts.ts';
import { seedBrsDemo } from '../prisma/brs-demo.ts';
import { getStudentHomeData, studentAcademicSummary } from '../src/lib/student-home.ts';
import { getStudentScheduleOverviewData } from '../src/lib/schedule-repository.ts';
import { dashboardActor, saveDashboardLayout } from '../src/lib/dashboard-settings.ts';
import { defaultDashboardLayout, parseDashboardLayout, storedDashboardLayout } from '../src/lib/dashboard-layout.ts';
import { provisionTestDatabase } from './test-fixtures.mjs';
import { fingerprint, integrity } from './database-snapshot.mjs';

// Dates and records below are isolated fixtures, never application defaults.
const development = process.argv.includes('--development');
mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/dashboard-test-'));
const source = createClient({ url: getDatabaseUrl() }), before = await fingerprint(source);
process.env.DATABASE_URL = provisionTestDatabase(resolve(root, 'test.db')).DATABASE_URL;
const db = createPrismaClient(), password = randomBytes(24).toString('base64url');
const results = [], diagnostics = [], models = {}, warning = /hydration|Next\.js encountered|Blocking Route|Instant validation|uncached data during|unstable value/i;
let child, browser, logs = '';
const pass = name => { results.push(name); console.info('PASS: ' + name); };
const date = value => new Date(value);
const overview = (id, value) => getStudentScheduleOverviewData(db, id, date(value));
async function settle(page) {
  await page.locator('.student-home').waitFor();
  await expect(page.locator('.home-notifications')).toHaveAttribute('data-unread', /\d+/);
  await page.waitForLoadState('networkidle');
}
async function session(user) {
  const row = await db.session.create({ data: { userId: user.id, token: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 3600000) } });
  return { id: user.id, sessionId: row.id, role: user.role };
}
async function checkOrder(page, order) {
  assert.deepEqual(await page.locator('.home-layout > [data-home-block]').evaluateAll(nodes => nodes.map(node => node.dataset.homeBlock)), order);
  const visual = await page.locator('.home-layout > [data-home-block]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.homeBlock, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })).sort((a,b) => Math.abs(a.y-b.y) < 1 ? a.x-b.x : a.y-b.y).map(node => node.id));
  assert.deepEqual(visual, order, 'Rendered order differs from saved order');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
}
async function compactSchedule(page, model) {
  const text = await page.locator('.home-schedule').innerText();
  for (const lesson of model.schedule.lessons) {
    for (const teacher of lesson.teachers) assert(!text.includes(teacher.name), 'Teacher leaked into compact presentation');
    for (const group of lesson.groups) assert(!text.includes(group.name), 'Group leaked into compact presentation');
  }
  if (model.schedule.next) {
    await expect(page.locator('.home-next')).toContainText(model.schedule.next.start);
    await expect(page.locator('.home-next')).toContainText(model.schedule.next.end);
    await expect(page.locator('.home-next')).toContainText(model.schedule.next.room);
  }
}
try {
  await seedBrsDemo(db);
  await db.account.updateMany({ where: { providerId: 'credential' }, data: { password: await hashPassword(password) } });
  const student = await db.user.findUniqueOrThrow({ where: { email: 'alexander.smirnov@example.test' } });
  const other = await db.user.findUniqueOrThrow({ where: { email: 'maria.volkova@example.test' } });
  const actor = await session(student);
  const now = date('2026-11-16T05:00:00Z');
  let s = await overview(student.id, now);
  assert.equal(s.today, '2026-11-16');assert.equal(s.next.start, '09:00');assert.equal(s.lessons.length, 2);assert.equal(s.reason, 'today');
  assert(s.nextHref.includes('week=2026-11-16'));assert(s.nextHref.includes('day=1'));
  assert(s.next.teachers.length && s.next.room && s.next.kind);
  assert.equal((await overview(student.id, '2026-11-16T07:00:00Z')).next.start, '09:00');
  s = await overview(student.id, '2026-11-16T18:00:00Z');
  assert.equal(s.reason, 'finished');assert.equal(s.selectedDate, '2026-11-17');assert(s.lessons.length);
  s = await overview(student.id, '2026-11-19T05:00:00Z');assert.equal(s.reason, 'empty');assert.equal(s.selectedDate, '2026-11-20');
  const sunday = await overview(student.id, '2026-11-22T17:00:00Z'), monday = await overview(student.id, '2026-11-23T05:00:00Z');
  assert.equal(sunday.selectedDate, monday.selectedDate);assert.notEqual(sunday.parity, monday.parity);
  assert.equal((await overview(student.id, '2026-11-22T20:59:59Z')).today, '2026-11-22');
  assert.equal((await overview(student.id, '2026-11-22T21:00:00Z')).today, '2026-11-23');
  await db.academicTerm.update({ where: { id: 'demo-term-autumn-2026' }, data: { timeZone: 'Asia/Vladivostok' } });
  s = await overview(student.id, '2026-11-22T14:00:00Z');assert.equal(s.today, '2026-11-23');assert.equal(s.time, '00:00');assert.equal(s.timeZone, 'Asia/Vladivostok');
  await db.academicTerm.update({ where: { id: 'demo-term-autumn-2026' }, data: { timeZone: 'Europe/Moscow' } });
  pass('Today, ongoing/ended lessons, empty day, next teaching day, parity, midnight/week boundary and academic timezone');

  const entry = await db.scheduleEntry.findUniqueOrThrow({ where: { id: 'demo-entry-math-shared' } });
  const exception = await db.scheduleException.create({ data: { entryId: entry.id, sourceDate: date('2026-11-16'), date: date('2026-11-16'), lessonId: entry.lessonId, termId: entry.termId, roomId: entry.roomId, startMinute: entry.startMinute, endMinute: entry.endMinute, isPublished: true, isCancelled: true } });
  s = await overview(student.id, now);assert.equal(s.next.start, '10:45');assert(s.lessons.some(row => row.change?.cancelled));
  models.cancelled = await getStudentHomeData(db, actor, now);
  const secondEntry = await db.scheduleEntry.findUniqueOrThrow({ where: { id: 'demo-entry-programming-pi1' } });
  const secondCancel = await db.scheduleException.create({ data: { entryId: secondEntry.id, sourceDate: date('2026-11-16'), date: date('2026-11-16'), lessonId: secondEntry.lessonId, termId: secondEntry.termId, roomId: secondEntry.roomId, startMinute: secondEntry.startMinute, endMinute: secondEntry.endMinute, isPublished: true, isCancelled: true } });
  assert.equal((await overview(student.id, now)).reason, 'cancelled');
  await db.scheduleException.delete({ where: { id: secondCancel.id } });
  await db.scheduleException.update({ where: { id: exception.id }, data: { isCancelled: false, date: date('2026-11-19'), roomId: 'demo-room-b108' } });
  s = await overview(student.id, '2026-11-19T05:00:00Z');assert.equal(s.next.room, '108');assert.equal(s.next.change.type, 'MOVED');
  models.moved = await getStudentHomeData(db, actor, date('2026-11-19T05:00:00Z'));
  await db.scheduleException.update({ where: { id: exception.id }, data: { date: date('2026-11-16') } });
  models.replaced = await getStudentHomeData(db, actor, now);
  await db.scheduleException.delete({ where: { id: exception.id } });
  const profile = await db.studentProfile.findUniqueOrThrow({ where: { userId: student.id } });
  await db.studyGroup.create({ data: { id: 'home-subgroup', slug: 'home-subgroup', code: 'ПИ-24-1 / 1', programme: 'Fixture', course: 2, parentId: profile.groupId } });
  await db.lesson.create({ data: { id: 'home-subgroup-lesson', disciplineId: 'demo-discipline-programming', kind: 'LAB', groups: { create: { groupId: 'home-subgroup' } } } });
  await db.scheduleEntry.create({ data: { id: 'home-subgroup-entry', lessonId: 'home-subgroup-lesson', termId: entry.termId, roomId: entry.roomId, dayOfWeek: 1, startMinute: 840, endMinute: 930, isPublished: true } });
  assert((await overview(student.id, now)).lessons.some(row => row.groups.some(group => group.slug === 'home-subgroup')));
  await db.studentProfile.update({ where: { userId: student.id }, data: { groupId: 'home-subgroup' } });
  assert((await overview(student.id, now)).lessons.some(row => row.groups.some(group => group.slug === 'pi-24-1')));
  await db.studentProfile.update({ where: { userId: student.id }, data: { groupId: null } });
  assert.equal((await overview(student.id, now)).reason, 'unlinked');
  await db.studentProfile.update({ where: { userId: student.id }, data: { groupId: profile.groupId } });
  await db.scheduleEntry.delete({ where: { id: 'home-subgroup-entry' } });
  pass('Cancellations, moved date/room, shared group/subgroup audience, unlinked profile');

  const published = await db.brsPlan.findMany({ where: { publishedAt: { not: null } }, select: { id: true, publishedAt: true } });
  await db.brsPlan.updateMany({ data: { publishedAt: null } });
  let study = await studentAcademicSummary(db, actor, now);assert.deepEqual(study, { recent: [], upcoming: null, undatedHref: '' });
  models.empty = await getStudentHomeData(db, actor, now);
  for (const plan of published) await db.brsPlan.update({ where: { id: plan.id }, data: { publishedAt: date('2026-09-01') } });
  await db.brsResult.updateMany({ data: { updatedAt: date('2026-11-15T10:00:00Z') } });
  const rk = await db.brsEvent.findFirstOrThrow({ where: { kind: 'INTERIM', module: { plan: { publishedAt: { not: null } } } }, include: { module: true } });
  await db.brsEvent.update({ where: { id: rk.id }, data: { occurrenceId: null, plannedOn: date('2026-11-17') } });
  await db.brsResult.updateMany({ where: { eventId: rk.id, studentId: student.id }, data: { deleted: true } });
  study = await studentAcademicSummary(db, actor, now);assert(study.recent.length);assert.equal(study.upcoming.id, rk.id);assert.equal(study.upcoming.date, '2026-11-17');
  assert(study.recent.every(row => row.href.startsWith('/dashboard/')));assert(!JSON.stringify(study).includes('comment'));
  const ownIds = new Set((await db.brsResult.findMany({ where: { studentId: student.id }, select: { id: true } })).map(row => row.id));
  assert(study.recent.every(row => ownIds.has(row.id)));
  await db.brsPlan.update({ where: { id: rk.module.planId }, data: { examOn: date('2026-11-16') } });
  study = await studentAcademicSummary(db, actor, now);assert.equal(study.upcoming.id, rk.module.planId);assert(study.upcoming.href.includes('/session?'));
  models.exam = await getStudentHomeData(db, actor, now);
  await db.brsPlan.update({ where: { id: rk.module.planId }, data: { examOn: date('2026-12-30') } });
  const recent = await db.brsResult.findFirstOrThrow({ where: { studentId: student.id, deleted: false, score: { not: null } } });
  await db.brsResult.update({ where: { id: recent.id }, data: { updatedAt: date('2026-11-16T04:00:00Z') } });
  models.normal = await getStudentHomeData(db, actor, now);
  assert.equal(models.normal.study.recent[0].id, recent.id);
  await db.brsResult.update({ where: { id: recent.id }, data: { updatedAt: date('2026-11-18') } });
  assert(!(await studentAcademicSummary(db, actor, now)).recent.some(row => row.id === recent.id));
  await db.brsResult.update({ where: { id: recent.id }, data: { updatedAt: date('2026-11-16T04:00:00Z') } });
  pass('Empty academic data, own published latest grades, private/future result exclusion, dated RK and exam priority');

  const ownDepartment = (await db.studyGroup.findUniqueOrThrow({ where: { id: profile.groupId } })).departmentId;
  const foreign = await db.academicDepartment.create({ data: { faculty: 'Fixture', name: 'Foreign home department' } });
  for (const [id, departmentId, publishedAt, isDemo] of [['home-news-global', null, '2026-11-14', false], ['home-news-own', ownDepartment, '2026-11-15', false], ['home-news-foreign', foreign.id, '2026-11-15', false], ['home-news-future', null, '2030-11-15', false], ['home-news-demo', null, '2026-11-15', true]]) {
    await db.news.create({ data: { id, title: id === 'home-news-own' ? 'Изменение времени консультации' : 'Открыта запись на научный семинар', content: 'Private full publication content', departmentId, publishedAt: date(publishedAt), isDemo } });
  }
  models.normal = await getStudentHomeData(db, actor, now);
  assert.deepEqual(models.normal.announcements.map(row => row.id), ['home-news-own', 'home-news-global']);assert(!JSON.stringify(models.normal.announcements).includes('content'));
  models.finished = await getStudentHomeData(db, actor, date('2026-11-16T18:00:00Z'));
  models.noClasses = await getStudentHomeData(db, actor, date('2026-11-19T05:00:00Z'));
  models.noSchedule = await getStudentHomeData(db, actor, date('2027-01-15T05:00:00Z'));
  assert.equal(models.noSchedule.schedule.next, null);
  for (let position = 0; position < 4; position++) {
    const order = ['notifications', 'study', 'announcements'];order.splice(position, 0, 'schedule');
    assert.deepEqual(parseDashboardLayout({ order, hidden: [] }), { order, hidden: [] });
  }
  for (const invalid of [
    { order: ['schedule', 'study', 'study', 'announcements'], hidden: [] },
    { order: ['schedule', 'study', 'notifications', 'unknown'], hidden: [] },
    { order: ['schedule'], hidden: [] },
    { ...defaultDashboardLayout(), hidden: ['study', 'study'] },
    { ...defaultDashboardLayout(), hidden: ['unknown'] },
    { ...defaultDashboardLayout(), extra: true },
  ]) assert.throws(() => parseDashboardLayout(invalid));
  assert.throws(() => parseDashboardLayout({ ...defaultDashboardLayout(), hidden: ['schedule'] }));
  assert.deepEqual(storedDashboardLayout('corrupt'), defaultDashboardLayout());
  const preference = { order: ['schedule', 'study', 'notifications', 'announcements'], hidden: ['announcements'] };
  assert.deepEqual(storedDashboardLayout(JSON.stringify(preference)), preference, 'Legacy layout must remain compatible');
  assert.equal((await saveDashboardLayout(db, actor, { layout: preference, version: 0 })).layoutVersion, 1);
  await assert.rejects(() => saveDashboardLayout(db, actor, { layout: preference, version: 0 }), error => error.status === 409);
  await assert.rejects(() => saveDashboardLayout(db, actor, { layout: preference, version: 1, userId: other.id }), error => error.status === 400);
  assert.equal(await db.userPreferences.count({ where: { userId: other.id } }), 0);
  await db.userPreferences.delete({ where: { userId: student.id } });
  // A pre-existing row in the original format/version needs no migration.
  await db.userPreferences.create({ data: { userId: student.id, dashboardLayoutJson: JSON.stringify(defaultDashboardLayout()), version: 7 } });
  const expired = await session(other);await db.session.update({ where: { id: expired.sessionId }, data: { expiresAt: new Date(0) } });
  await assert.rejects(() => dashboardActor(db, expired), error => error.status === 401);
  pass('Published audience-filtered announcements, strict layout validation, account ownership, stale writes and expired sessions');

  const net = createServer();await new Promise(done => net.listen(0, '127.0.0.1', done));const port = net.address().port;await new Promise(done => net.close(done));
  const base = 'http://127.0.0.1:' + port;
  let project = resolve('.');
  if (development) {
    project = resolve(root, 'project');mkdirSync(project);
    for (const folder of ['src', 'public']) cpSync(folder, resolve(project, folder), { recursive: true });
    for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'AGENTS.md', '.gitignore']) cpSync(file, resolve(project, file));
    writeFileSync(resolve(project, 'next.config.ts'), readFileSync('next.config.ts', 'utf8').replace('turbopack: {', `turbopack: { root: ${JSON.stringify(resolve('.').replaceAll('\\', '/'))},`).replace('loaders: ["@tailwindcss/turbopack"]', `loaders: [{ loader: "@tailwindcss/turbopack", options: { base: ${JSON.stringify(resolve(project, 'src').replaceAll('\\', '/'))} } }]`));
    symlinkSync(resolve('node_modules'), resolve(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', development ? 'dev' : 'start', project, '--hostname', '127.0.0.1', '--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_TRUST_PROXY: 'false', AUTH_PROXY_SECRET: '', NEXT_TELEMETRY_DISABLED: '1' } });
  child.stdout.on('data', data => { logs += data; });child.stderr.on('data', data => { logs += data; });
  for (let i = 0; i < 120; i++) { assert.equal(child.exitCode, null);try { if ((await fetch(base + '/api/auth/get-session')).ok) break; } catch {}await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: 'light' });
  const login = async (ctx, email) => assert.equal((await ctx.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email, password } })).status(), 200);
  assert.equal((await context.request.get(base + '/api/dashboard')).status(), 401);
  await login(context, student.email);
  let response = await context.request.get(base + '/api/dashboard');assert.equal(response.status(), 200);assert.match(response.headers()['cache-control'], /no-store/);
  assert.deepEqual((await response.json()).layout, defaultDashboardLayout());
  assert.equal((await (await context.request.get(base + '/api/dashboard')).json()).layoutVersion, 7);
  for (const input of [{ layout: { ...defaultDashboardLayout(), hidden: ['schedule'] }, version: 7 }, { layout: defaultDashboardLayout(), version: -1 }, { layout: defaultDashboardLayout(), version: 1.5 }, { layout: defaultDashboardLayout(), version: 2147483647 }]) {
    assert.equal((await context.request.post(base + '/api/dashboard', { headers: { Origin: base }, data: input })).status(), 400);
  }
  assert.equal((await context.request.get(base + '/api/dashboard?userId=' + other.id)).status(), 400);
  for (const [body, origin, status] of [[{ layout: preference, version: 0 }, 'https://foreign.test', 403], [{ layout: preference, version: 0, userId: other.id }, base, 400], [{ padding: 'x'.repeat(3000) }, base, 413]]) {
    assert.equal((await context.request.post(base + '/api/dashboard', { headers: { Origin: origin }, data: body })).status(), status);
  }
  for (const account of demoAccounts.filter(row => row.role !== 'STUDENT')) {
    const ctx = await browser.newContext();await login(ctx, account.email);
    assert.equal((await ctx.request.get(base + '/api/dashboard')).status(), 403);
    assert.equal((await ctx.request.post(base + '/api/dashboard', { headers: { Origin: base }, data: { layout: preference, version: 0 } })).status(), 403);
    if (account.role === 'DEANERY_STAFF') {
      const user = await db.user.findUniqueOrThrow({ where: { email: account.email } });
      await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: user.id } });
      assert.equal((await ctx.request.get(base + '/api/dashboard')).status(), 403);
    }
    await ctx.close();
  }
  pass('HTTP anonymous/foreign-role denial, deanery after assignment revocation, CSRF, body limits, parameter tampering and no-store');

  const page = await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror', error => diagnostics.push(error.message));page.on('console', message => { if (warning.test(message.text())) diagnostics.push(message.text()); });
  await page.goto(base + '/dashboard');await settle(page);
  assert.equal(await page.locator('.notification-list').count(), 0);assert.equal(await page.locator('.welcome-banner').count(), 0);
  await page.locator('.home-settings-trigger').click();
  await expect(page.getByRole('checkbox', { name: 'Расписание', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Объявления', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Выше: Учёба и контроль', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();await expect(page.locator('.home-customize')).not.toBeVisible();
  await checkOrder(page, ['schedule', 'study', 'notifications']);
  await page.reload();await settle(page);assert.equal(await page.locator('.home-announcements').count(), 0);
  assert.equal((await context.request.post(base + '/api/auth/sign-out', { headers: { Origin: base }, data: {} })).status(), 200);
  await login(context, student.email);await page.goto(base + '/dashboard');await settle(page);assert.equal(await page.locator('.home-announcements').count(), 0);
  const second = await browser.newContext();await login(second, other.email);assert.deepEqual((await (await second.request.get(base + '/api/dashboard')).json()).layout, defaultDashboardLayout());await second.close();
  await page.locator('.home-settings-trigger').click();await page.getByRole('button', { name: 'Сбросить к стандартному' }).click();await page.getByRole('button', { name: 'Отмена', exact: true }).click();assert.equal(await page.locator('.home-announcements').count(), 0);
  await page.locator('.home-settings-trigger').click();await page.getByRole('button', { name: 'Сбросить к стандартному' }).click();await page.getByRole('button', { name: 'Сохранить', exact: true }).click();await expect(page.locator('.home-announcements')).toBeVisible();
  const order = [...defaultDashboardLayout().order];
  for (let position = 1; position <= 3; position++) {
    await page.locator('.home-settings-trigger').click();
    await expect(page.getByText('Закреплено', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ниже: Расписание', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();await expect(page.locator('.home-customize')).not.toBeVisible();
    [order[position - 1], order[position]] = [order[position], order[position - 1]];
    await page.reload();await settle(page);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => localStorage.setItem('lks-theme', theme), theme);
      await page.reload();await settle(page);await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const width of [346, 360, 1366]) {
        await page.setViewportSize({ width, height: 900 });await checkOrder(page, order);
        await page.screenshot({ path: resolve(root, `order-${position + 1}-${theme}-${width}.png`), fullPage: true, caret: 'initial' });
      }
    }
    assert.deepEqual((await (await context.request.get(base + '/api/dashboard')).json()).layout.order, order);
  }
  assert.equal((await context.request.post(base + '/api/auth/sign-out', { headers: { Origin: base }, data: {} })).status(), 200);
  await login(context, student.email);await page.goto(base + '/dashboard');await settle(page);await checkOrder(page, order);
  const saved = await (await context.request.get(base + '/api/dashboard')).json();
  assert.equal((await context.request.post(base + '/api/dashboard', { headers: { Origin: base }, data: { layout: saved.layout, version: saved.layoutVersion - 1 } })).status(), 409);
  await page.locator('.home-settings-trigger').click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Выше: Расписание', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выше: Расписание', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Сбросить к стандартному' }).click();await page.getByRole('button', { name: 'Сохранить', exact: true }).click();await expect(page.locator('.home-customize')).not.toBeVisible();
  await checkOrder(page, defaultDashboardLayout().order);
  pass('Legacy settings, mandatory movable schedule at positions 2/3/4 in both themes and mobile/desktop visual order, F5/relogin, reset/cancel, version conflicts and account isolation');

  // Browser variants use real DTOs from this same isolated database and real
  // destination IDs. Only GET home data and the existing notification feed are mocked.
  let model = models.normal, unread = 0;
  await page.route('**/api/dashboard', route => route.request().method() === 'GET' ? route.fulfill({ json: model }) : route.continue());
  await page.route('**/api/notifications', route => route.fulfill({ json: { items: [], unread, boundary: 0, nextCursor: null } }));
  const refresh = async () => { await page.evaluate(() => dispatchEvent(new Event('focus')));await expect(page.locator('.home-calendar time')).toHaveAttribute('datetime', model.schedule.today); };
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { localStorage.setItem('lks-theme', theme);document.documentElement.dataset.theme = theme; }, theme);
    await page.reload();await settle(page);await refresh();
    for (const width of [346, 360, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow at ' + width);
      assert.equal(await page.locator('.home-heading time').count(), 0);
      await compactSchedule(page, model);await checkOrder(page, defaultDashboardLayout().order);
      const colors = await page.locator('.home-lesson-body').first().evaluate(node => ({ marker: getComputedStyle(node).borderLeftColor, text: getComputedStyle(node).color }));
      const rgb = colors.marker.match(/\d+/g).map(Number);assert(rgb[1] > rgb[0] && rgb[1] > rgb[2], 'Schedule lost green identity');
      await page.screenshot({ path: resolve(root, `home-${theme}-${width}.png`), fullPage: true, caret: 'initial' });
      if (width <= 360) {
        await page.locator('.home-settings-trigger').click();await page.screenshot({ path: resolve(root, `settings-${theme}-${width}.png`), caret: 'initial' });
        assert(await page.locator('.home-customize').evaluate(node => { const r = node.getBoundingClientRect();return r.left >= 0 && r.right <= innerWidth && r.height <= innerHeight && Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2 && Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 2; }));
        await page.keyboard.press('Escape');
      }
    }
  }
  for (const [name, value] of Object.entries(models)) {
    model = value;await refresh();await expect(page.locator('.home-lessons li')).toHaveCount(value.schedule.lessons.length);
    if (name === 'empty') await expect(page.locator('.home-study')).toContainText('Оценок пока нет.');
    if (name === 'cancelled') await expect(page.locator('.home-lessons')).toContainText('Отменено');
    if (name === 'moved') { await expect(page.locator('.home-next')).toContainText('Перенос');await expect(page.locator('.home-lessons')).toContainText('Перенос'); }
    if (name === 'replaced') { await expect(page.locator('.home-next')).toContainText('Замена');await expect(page.locator('.home-lessons')).toContainText('Замена'); }
    await compactSchedule(page, value);
    await page.setViewportSize({ width: 360, height: 900 });await page.screenshot({ path: resolve(root, `scenario-${name}.png`), fullPage: true, caret: 'initial' });
  }
  model = models.normal;await refresh();
  unread = 4;await page.evaluate(() => dispatchEvent(new Event('notifications-updated')));await expect(page.locator('.home-notifications')).toHaveAttribute('data-unread', '4');
  unread = 0;await page.evaluate(() => dispatchEvent(new Event('notifications-updated')));await expect(page.locator('.home-notifications')).toContainText('Новых уведомлений нет');
  assert.equal(await page.locator('.notification-list').count(), 0);
  const links = await page.locator('.home-next,.home-results a,.home-control a,.home-news a,.home-notifications').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('href')))]);
  for (const href of links) {
    assert.equal((await context.request.get(base + href)).status(), 200, 'Broken link: ' + href);
  }
  await page.locator('.home-results a').first().click();await page.waitForURL(url => url.pathname === '/dashboard/grades');await expect(page.locator('.brs-dialog')).toBeVisible();
  await page.goto(base + '/dashboard');await settle(page);await refresh();
  await page.locator('.home-news a').first().click();await page.waitForURL(url => url.pathname === '/dashboard/news');await expect(page.locator('main h1:visible')).toHaveText('Изменение времени консультации');
  await page.goto(base + '/dashboard');await settle(page);model = models.exam;await refresh();await expect(page.locator('.home-control a')).toHaveAttribute('href', /\/session\?/);
  await page.locator('.home-control a').click();await page.waitForURL(url => url.pathname === '/dashboard/session');await expect(page.locator('main h1:visible')).toBeVisible();
  await page.goto(base + '/dashboard');await settle(page);model = models.normal;await refresh();
  await page.locator('.home-next').click();await page.waitForURL(url => url.pathname === '/dashboard/schedule');await page.locator('.schedule-day-card').first().waitFor();
  await expect(page.locator('main:visible')).toContainText(models.normal.schedule.next.teachers[0].name);
  await expect(page.locator('main:visible')).toContainText('ПИ-24-2');
  await page.clock.install();await page.goto(base + '/dashboard');await settle(page);await refresh();
  model = models.noClasses;await page.clock.fastForward(61000);await expect(page.locator('.home-calendar time')).toHaveAttribute('datetime', model.schedule.today);
  pass('Latest grade opens its actual BRS dialog, announcement opens publication, exam opens session, minute refresh changes academic day');
  assert.deepEqual(diagnostics, []);assert(!warning.test(logs), 'Server diagnostics');
  pass('Light/dark at 346/360/768/1366px, no overflow, semantic green, mobile settings, all data scenarios, provider 0/4 unread, real links and navigation');
  assert.equal(await fingerprint(source), before, 'Working database changed');
  const testClient = createClient({ url: process.env.DATABASE_URL });await integrity(testClient);testClient.close();
  pass('No hydration/Blocking Route/Instant/runtime diagnostics; isolated DB integrity and working DB fingerprint preserved');
} finally {
  await browser?.close();child?.kill();await db.$disconnect();source.close();
  writeFileSync(resolve(root, 'results.json'), JSON.stringify({ mode: development ? 'development' : 'production', results, diagnostics }, null, 2));
  writeFileSync(resolve(root, 'server.log'), logs.replaceAll(password, '[REDACTED]'), { mode: 0o600 });
  console.info('Dashboard report: ' + root.replaceAll('\\', '/') + '/results.json');
}
