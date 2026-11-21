import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createClient } from '@libsql/client';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { provisionTestDatabase } from './test-fixtures.mjs';
import { fingerprint, integrity } from './database-snapshot.mjs';
import { seedBrsDemo } from '../prisma/brs-demo.ts';
import { seedServices, executeServiceCommand, getServiceRequest } from '../src/lib/services-repository.ts';
import { executeBrsCommand } from '../src/lib/brs-commands.ts';
import { planInclude } from '../src/lib/brs-repository.ts';
import { executeScheduleCommand } from '../src/lib/schedule-editor-repository.ts';
import { emitNotification, listNotifications, markNotifications, savePreferences } from '../src/lib/notifications-repository.ts';
import { deliverNotificationEmails, emailCapability } from '../src/lib/notifications-email.ts';
import { publishAnnouncement } from '../src/lib/announcements.ts';
import { safeNotificationHref, allNotificationCategories } from '../src/lib/notifications-shared.ts';

mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/notifications-test-')), source = createClient({ url: getDatabaseUrl() }), before = await fingerprint(source);
const env = provisionTestDatabase(resolve(root, 'test.db')); process.env.DATABASE_URL = env.DATABASE_URL;
const db = createPrismaClient(), results = [], diagnostics = [], password = randomBytes(24).toString('base64url');
let browser, child, smtp, logs = '';
const pass = name => { results.push(name); console.info('PASS: ' + name); };
const user = email => db.user.findUniqueOrThrow({ where: { email: email + '@example.test' } });
async function actor(u) { const s = await db.session.create({ data: { userId: u.id, token: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 3600000) } }); return { id: u.id, role: u.role, sessionId: s.id }; }
async function emit(u, key, extra = {}) { return db.$transaction(tx => emitNotification(tx, { sourceKey: key, source: 'SYSTEM', sourceId: key, type: 'TEST', category: 'SYSTEM', title: 'Событие ' + key, body: 'Защищённое событие', mandatory: true, recipients: [{ id: u.id, role: u.role, href: ({ STUDENT: '/dashboard', TEACHER: '/teacher', ADMIN: '/admin', DEANERY_STAFF: '/deanery', TECHNICAL_STAFF: '/staff' })[u.role] }], ...extra })); }
async function freePort() { const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
try {
  await seedBrsDemo(db); await seedServices(db);
  const [alex, maria, teacher, dean, admin, staff] = await Promise.all(['alexander.smirnov', 'maria.volkova', 'mikhail.sokolov', 'olga.kuznetsova', 'irina.lebedeva', 'sergey.petrov'].map(user));
  const actors = new Map(); for (const u of [alex, maria, teacher, dean, admin, staff]) actors.set(u.id, await actor(u));
  const a = actors.get(alex.id), m = actors.get(maria.id), d = actors.get(dean.id), t = actors.get(teacher.id);
  assert.equal(await db.notification.count(), 0, 'No demo backfill');
  for (let i = 0; i < 35; i++) await emit(alex, 'pagination-' + i);
  await emit(maria, 'private-maria');
  const once = await db.notification.count(); await emit(alex, 'pagination-0'); assert.equal(await db.notification.count(), once);
  const first = await listNotifications(db, a); assert.equal(first.items.length, 30); assert(first.nextCursor); assert.equal(first.unread, 35);
  await emit(alex, 'new-after-boundary'); await markNotifications(db, a, first.boundary, true);
  let feed = await listNotifications(db, a); assert.equal(feed.unread, 1); assert.equal(feed.items[0].readAt, null);
  const older = await listNotifications(db, a, first.nextCursor); assert.equal(older.items.length, 5); assert(!older.items.some(n => first.items.some(f => f.id === n.id)));
  const foreign = (await listNotifications(db, m)).items[0]; await markNotifications(db, a, foreign.id, false); assert.equal((await listNotifications(db, m)).unread, 1);
  await assert.rejects(() => listNotifications(db, { id: maria.id, sessionId: a.sessionId }), /Сессия/);
  for (const href of ['//evil.test/x', '/\\evil', 'https://evil.test', '/dashboard%2f../x', '/api/auth']) assert.throws(() => safeNotificationHref(href));
  pass('Persistent read state, snapshot read-all race, stable cursor, idempotency, ownership and safe links');

  await savePreferences(db, a, { optionalCategories: [], emailCategories: [], personalEmail: false });
  const count = await db.notification.count({ where: { recipientId: alex.id } });
  await emit(alex, 'optional-disabled', { mandatory: false }); assert.equal(await db.notification.count({ where: { recipientId: alex.id } }), count);
  await emit(alex, 'mandatory-enabled'); assert.equal(await db.notification.count({ where: { recipientId: alex.id } }), count + 1);
  await savePreferences(db, a, { optionalCategories: allNotificationCategories, emailCategories: [], personalEmail: false });
  await emit(alex, 'optional-disabled', { mandatory: false }); assert.equal(await db.notification.count({ where: { recipientId: alex.id } }), count + 1, 'Retry must preserve original suppression');
  const department = await db.studentProfile.findUniqueOrThrow({ where: { userId: alex.id }, include: { group: true } });
  const announcement = { requestId: randomUUID(), title: 'Настоящее объявление', content: 'Содержание новой публикации', departmentId: department.group.departmentId };
  await assert.rejects(() => publishAnnouncement(db, d, announcement), /администратору/);
  const news = await publishAnnouncement(db, actors.get(admin.id), announcement);
  await publishAnnouncement(db, actors.get(admin.id), announcement);
  assert.equal(await db.notificationEvent.count({ where: { source: 'NEWS', sourceId: news.id } }), 1);
  await assert.rejects(() => publishAnnouncement(db, actors.get(admin.id), { ...announcement, title: 'Подмена' }), /Ключ/);
  const foreignGroup = await db.studyGroup.findFirstOrThrow({ where: { departmentId: { not: department.group.departmentId } } });
  await db.studentProfile.update({ where: { userId: alex.id }, data: { groupId: foreignGroup.id } });
  assert(!(await listNotifications(db, a)).items.some(n => n.href.includes(news.id)));
  await db.studentProfile.update({ where: { userId: alex.id }, data: { groupId: department.groupId } });
  pass('Saved settings, mandatory delivery, no historical replay, authorized scoped publication and transfer');

  const plan = await db.brsPlan.findFirstOrThrow({ where: { control: 'CREDIT', publishedAt: { not: null } }, include: planInclude });
  const event = plan.modules[0].events.find(e => e.kind === 'HOMEWORK');
  const old = await db.brsResult.findUnique({ where: { eventId_studentId: { eventId: event.id, studentId: alex.id } } });
  await executeBrsCommand(db, t, { operation: 'GRADING_SETTINGS', requestId: randomUUID(), planId: plan.id, revision: plan.revision, eventId: event.id, scaleVersion: event.scaleVersion, scoringMode: 'RATING' });
  const cmd = { operation: 'RESULT', requestId: randomUUID(), planId: plan.id, revision: (await db.brsPlan.findUniqueOrThrow({ where: { id: plan.id } })).revision, eventId: event.id, studentId: alex.id, version: old?.version ?? 0, score: old?.score === event.maxScore ? 0 : event.maxScore, scoringMode: 'RATING', submissionTiming: 'ON_TIME', reason: 'Изолированная проверка уведомлений' };
  await executeBrsCommand(db, t, cmd); await executeBrsCommand(db, t, cmd);
  const brs = await db.notification.findMany({ where: { event: { source: 'BRS' } }, include: { event: true } });
  assert(brs.length); assert(brs.every(n => n.recipientId === alex.id)); assert(brs.some(n => n.href.includes(event.id)));
  assert(brs.some(n => n.event.type === 'FINAL_CHANGED'));
  const after = await db.brsResult.findUniqueOrThrow({ where: { eventId_studentId: { eventId: event.id, studentId: alex.id } } });
  await executeBrsCommand(db, t, { ...cmd, requestId: randomUUID(), revision: (await db.brsPlan.findUniqueOrThrow({ where: { id: plan.id } })).revision, version: after.version });
  assert.equal(await db.notification.count({ where: { event: { source: 'BRS' } } }), brs.length, 'No technical SAVE notice');
  const currentResult = await db.brsResult.findUniqueOrThrow({ where: { id: after.id } });
  await executeBrsCommand(db, t, { ...cmd, requestId: randomUUID(), revision: (await db.brsPlan.findUniqueOrThrow({ where: { id: plan.id } })).revision, version: currentResult.version, submittedOn: '2026-11-17', checkedOn: '2026-11-18' });
  assert(await db.notification.count({ where: { event: { source: 'BRS' } } }) > brs.length, 'Visible date correction must notify');
  const exam = await db.brsPlan.findFirstOrThrow({ where: { control: 'EXAM', publishedAt: { not: null } } });
  const admission = await db.brsAdmission.findUniqueOrThrow({ where: { planId_studentId: { planId: exam.id, studentId: alex.id } } });
  assert(admission.approved);
  await executeBrsCommand(db, d, { operation: 'REVOKE', requestId: randomUUID(), planId: exam.id, revision: exam.revision, studentId: alex.id, version: admission.version, reason: 'Изолированная проверка изменения допуска' });
  assert.equal(await db.notification.count({ where: { recipientId: alex.id, event: { source: 'BRS', sourceId: exam.id, type: 'ADMISSION_CHANGED' } } }), 1);
  pass('Real BRS result/date correction, official review, admission change, owner-only delivery, exact work link, retry and no-op suppression');

  const term = await db.academicTerm.findFirstOrThrow({ where: { isPublished: true } }), room = await db.room.findFirstOrThrow(), discipline = await db.discipline.findFirstOrThrow();
  const schedule = { operation: 'CREATE', groupIds: [department.groupId], teacherIds: [teacher.id], disciplineId: discipline.id, roomId: room.id, termId: term.id, dayOfWeek: 7, start: '22:00', end: '23:00', kind: 'LECTURE', weekPattern: 'EVERY', isPublished: true };
  const created = await executeScheduleCommand(db, d, schedule);
  const notices = await db.notification.findMany({ where: { event: { source: 'SCHEDULE' } }, include: { event: true } });
  assert(notices.some(n => n.recipientId === alex.id)); assert(notices.some(n => n.recipientId === teacher.id));
  assert(notices.every(n => n.recipientId === teacher.id || n.scopeGroupId === department.groupId));
  const version = (await db.scheduleEntry.findUniqueOrThrow({ where: { id: created.objectId } })).version;
  await executeScheduleCommand(db, d, { ...schedule, operation: 'UPDATE', entryId: created.objectId, version });
  assert.equal(await db.notification.count({ where: { event: { source: 'SCHEDULE' } } }), notices.length);
  await executeScheduleCommand(db, d, { ...schedule, operation: 'UPDATE', entryId: created.objectId, version: version + 1, start: '21:30', end: '22:30' });
  assert(await db.notification.count({ where: { event: { source: 'SCHEDULE' } } }) > notices.length);
  await db.deaneryDepartmentAssignment.delete({ where: { userId_departmentId: { userId: dean.id, departmentId: department.group.departmentId } } });
  await assert.rejects(() => executeScheduleCommand(db, d, schedule), /полномочий|недоступен/);
  await db.deaneryDepartmentAssignment.create({ data: { userId: dean.id, departmentId: department.group.departmentId } });
  pass('Real published schedule and time changes, actual participants, no-op saves and revoked deanery authority');

  await db.serviceRoute.create({ data: { serviceCode: 'deanery-appeal', sourceDepartmentId: department.group.departmentId, departmentId: department.group.departmentId } });
  const grant = await db.serviceGrant.create({ data: { userId: dean.id, departmentId: department.group.departmentId, serviceCode: 'deanery-appeal', active: true } });
  const draft = await executeServiceCommand(db, a, { operation: 'CREATE', requestId: randomUUID(), code: 'deanery-appeal' });
  const saved = await executeServiceCommand(db, a, { operation: 'SAVE', requestId: randomUUID(), id: draft.id, version: draft.version, fields: { subject: 'Проверка', message: 'Вопрос для проверки уведомлений' } });
  const detail = await getServiceRequest(db, a, draft.id);
  const submit = { operation: 'SUBMIT', requestId: randomUUID(), id: draft.id, version: saved.version, confirmed: true, confirmationHash: detail.profilePreview.confirmationHash };
  await executeServiceCommand(db, a, submit); await executeServiceCommand(db, a, submit);
  assert.equal(await db.serviceEvent.count({ where: { requestId: draft.id } }), 1);
  assert.equal(await db.notification.count({ where: { recipientId: alex.id, event: { source: 'SERVICES', sourceId: draft.id } } }), 1);
  assert((await listNotifications(db, d)).items.some(n => n.href.includes(draft.id)));
  await db.serviceGrant.update({ where: { id: grant.id }, data: { active: false } });
  assert(!(await listNotifications(db, d)).items.some(n => n.href.includes(draft.id)));
  await db.serviceGrant.update({ where: { id: grant.id }, data: { active: true } });
  pass('Existing ServiceEvent integrated atomically without duplicate delivery');

  // Actual local SMTP protocol, including provider refusal and retry.
  let rejectMail = false, acceptedMessages = [], rcpts = 0;
  smtp = createServer(socket => {
    socket.setEncoding('utf8'); socket.write('220 test.local ESMTP\r\n'); let buffer = '', data = false, message = '';
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const pos = buffer.indexOf('\r\n'), line = buffer.slice(0, pos); buffer = buffer.slice(pos + 2);
        if (data) { if (line === '.') { data = false; acceptedMessages.push(message); message = ''; socket.write('250 2.0.0 queued\r\n'); } else message += line + '\r\n'; continue; }
        if (/^EHLO|^HELO/.test(line)) socket.write('250-test.local\r\n250 8BITMIME\r\n');
        else if (/^MAIL FROM/.test(line)) socket.write('250 OK\r\n');
        else if (/^RCPT TO/.test(line)) { rcpts++; socket.write(rejectMail ? '550 Recipient rejected\r\n' : '250 OK\r\n'); }
        else if (line === 'DATA') { data = true; socket.write('354 End with dot\r\n'); }
        else if (line === 'QUIT') { socket.end('221 Bye\r\n'); } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { NOTIFICATIONS_SMTP_HOST: '127.0.0.1', NOTIFICATIONS_SMTP_PORT: String(smtp.address().port), NOTIFICATIONS_SMTP_FROM: 'notifications@example.test', NOTIFICATIONS_SMTP_LOCAL_TEST: 'true', NOTIFICATIONS_SMTP_SECURE: 'false', BETTER_AUTH_URL: 'http://localhost:3000' });
  await db.user.update({ where: { id: alex.id }, data: { emailVerified: true } });
  await savePreferences(db, a, { optionalCategories: allNotificationCategories, emailCategories: ['SYSTEM'], personalEmail: true });
  await emit(alex, 'smtp-success', { title: 'Секретные баллы 97', body: 'Паспорт и приватный комментарий' });
  let delivered = await deliverNotificationEmails(db); assert.equal(delivered.sent, 1); assert.equal(acceptedMessages.length, 1);
  assert(!acceptedMessages[0].includes('97') && !acceptedMessages[0].includes('Паспорт'));
  assert.equal((await deliverNotificationEmails(db)).sent, 0);
  rejectMail = true; await emit(alex, 'smtp-failed'); delivered = await deliverNotificationEmails(db); assert.equal(delivered.failed, 1);
  assert.equal(await db.notificationEmail.count({ where: { state: 'failed', attempts: 1, sentAt: null } }), 1);
  rejectMail = false; delivered = await deliverNotificationEmails(db, undefined, new Date(Date.now() + 120000)); assert.equal(delivered.sent, 1);
  await emit(alex, 'smtp-concurrent');
  const concurrentDelivery = await Promise.all([deliverNotificationEmails(db), deliverNotificationEmails(db)]);
  assert.equal(concurrentDelivery.reduce((sum, result) => sum + result.sent, 0), 1);
  rejectMail = true; await emit(alex, 'smtp-exhausted');
  for (let i = 0; i < 5; i++) await deliverNotificationEmails(db, undefined, new Date(Date.now() + i * 900000));
  assert.equal(await db.notificationEmail.count({ where: { state: 'failed', attempts: 4, lastError: 'SMTP_DELIVERY_FAILED' } }), 1);
  rejectMail = false;
  await db.user.update({ where: { id: alex.id }, data: { emailVerified: false } });
  const beforeRcpt = rcpts; await emit(alex, 'smtp-unverified'); await deliverNotificationEmails(db); assert.equal(rcpts, beforeRcpt);
  delete process.env.NOTIFICATIONS_SMTP_HOST; assert.equal(emailCapability({ email: alex.email, emailVerified: true }).emailAvailable, false);
  await emit(alex, 'smtp-not-configured'); assert.equal((await deliverNotificationEmails(db)).available, false);
  assert((await listNotifications(db, a)).items.some(n => n.title.includes('smtp-not-configured')));
  pass('Real test SMTP acceptance, provider refusal/retry, no duplicate send, verified addresses, private template and disabled provider');

  await db.account.updateMany({ where: { providerId: 'credential' }, data: { password: await hashPassword(password) } });
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const serverEnv = { ...process.env, BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_TRUST_PROXY: 'false', AUTH_PROXY_SECRET: '' };
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: serverEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => logs += b); child.stderr.on('data', b => logs += b);
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  assert.equal((await fetch(base + '/api/notifications')).status, 401);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  async function signed(u) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const login = await context.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: u.email, password } }); assert.equal(login.status(), 200);
    const page = await context.newPage();
    page.on('pageerror', e => diagnostics.push(e.message)); page.on('console', msg => { if (/hydration|Next\.js encountered|Blocking Route|Instant validation|uncached data|unstable value/i.test(msg.text())) diagnostics.push(msg.text()); });
    return { context, page };
  }
  async function checkHeader(page, home) {
    let unread = 0;
    const intercept = async route => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({ json: { items: [], unread, boundary: 0, nextCursor: null } });
    };
    await page.route('**/api/notifications', intercept);
    await page.goto(base + home);
    const bell = page.locator('.dashboard-header .notification-button');
    await expect(bell).toHaveAttribute('href', home + '/notifications');
    await expect(bell.locator('svg')).toBeVisible();
    for (const count of [0, 1, 12, 101]) {
      unread = count;
      await page.evaluate(() => window.dispatchEvent(new Event('notifications-updated')));
      if (count) await expect(bell.locator('.notification-bell-count')).toHaveText(count > 99 ? '99+' : String(count));
      else await expect(bell.locator('.notification-bell-count')).toHaveCount(0);
      for (const width of [360, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await bell.evaluate(el => {
          const r = el.getBoundingClientRect(), badge = el.querySelector('.notification-bell-count')?.getBoundingClientRect();
          return { visible: r.x >= 0 && r.right <= innerWidth && r.width >= 32 && r.height >= 40,
            badgeFits: !badge || (badge.x >= r.x && badge.right <= r.right && badge.y >= r.y && badge.bottom <= r.bottom),
            round: !badge || (badge.height === 16 && badge.width === (el.querySelector('.notification-bell-count-wide') ? 22 : 16)) };
        });
        assert(geometry.visible && geometry.badgeFits && geometry.round, JSON.stringify(geometry));
      }
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: resolve(root, home.slice(1) + '-header-360.png') });
    await bell.focus(); await expect(bell).toBeFocused();
    await page.keyboard.press('Enter'); await expect(page).toHaveURL(base + home + '/notifications');
    await page.unroute('**/api/notifications', intercept);
    await page.goto(base + home + '/notifications');
    const restored = await (await page.request.get(base + '/api/notifications')).json();
    await expect(page.locator('.notification-summary strong')).toHaveText(String(restored.unread));
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  const { context, page } = await signed(alex);
  await checkHeader(page, "/dashboard");
  const api = await context.request.get(base + '/api/notifications'); assert.equal(api.status(), 200); assert.match(api.headers()['cache-control'], /no-store/);
  assert.equal((await context.request.get(base + '/api/notifications?recipientId=' + maria.id)).status(), 400);
  assert.equal((await context.request.post(base + '/api/notifications', { headers: { Origin: 'https://evil.test' }, data: { operation: 'READ_ALL', boundary: 99999 } })).status(), 403);
  assert.equal((await context.request.post(base + '/api/notifications', { headers: { Origin: base }, data: { operation: 'READ', boundary: foreign.id, recipientId: maria.id } })).status(), 400);
  await page.goto(base + '/dashboard'); await expect(page.locator('.home-notifications')).toHaveAttribute('data-unread',String((await listNotifications(db, a)).unread));
  const previousCount = Number(await page.locator('.home-notifications').getAttribute('data-unread'));
  await emit(alex, 'browser-no-f5');
  await expect(page.locator('.home-notifications')).toHaveAttribute('data-unread',String(previousCount + 1), { timeout: 18000 });
  await expect(page.locator('.desktop-sidebar .notification-count')).toHaveText(String(previousCount + 1));
  await expect(page.locator('.dashboard-header .notification-bell-count')).toHaveText(previousCount + 1 > 99 ? '99+' : String(previousCount + 1));
  await expect(page.locator('.notification-list')).toHaveCount(0);
  await page.goto(base + '/dashboard/notifications'); await expect(page.locator('.notification-unread')).not.toHaveCount(0);
  assert.equal(await page.getByRole('tab').count(), 0); assert.equal(await page.getByRole('combobox').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Отметить прочитанным' }).count(), 0);
  await page.screenshot({ path: resolve(root, 'notifications-1366.png'), fullPage: true });
  const second = await context.newPage(); await second.goto(base + '/dashboard'); await expect(second.locator('.home-notifications')).toBeVisible();
  const countBeforeRead = (await listNotifications(db, a)).unread;
  let injected = false;
  await page.route('**/api/notifications', async route => {
    if (!injected && route.request().method() === 'POST' && route.request().postDataJSON().operation === 'READ_ALL') { injected = true; await emit(alex, 'during-read-all'); }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Прочитать все', exact: true }).click();
  await expect(page.locator('.notification-summary strong')).toHaveText('1');
  await second.bringToFront(); await expect(second.locator('.home-notifications')).toHaveAttribute('data-unread','1', { timeout: 18000 });
  assert(countBeforeRead > 0); assert.equal((await listNotifications(db, a)).unread, 1);
  await page.unroute('**/api/notifications');
  await page.bringToFront();
  await page.getByRole('button', { name: 'Прочитать все', exact: true }).click();
  await expect(page.locator('.notification-summary strong')).toHaveText('0');
  await expect(page.locator('.dashboard-header .notification-bell-count')).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 }); await page.screenshot({ path: resolve(root, 'notifications-360.png'), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const retained = await page.locator('.services-event').count();
  await context.setOffline(true); await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.locator('.services-error[role=alert]')).toBeVisible();
  assert.equal(await page.locator('.services-event').count(), retained);
  await emit(alex, 'after-network-restored'); await context.setOffline(false); await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.notification-list')).toContainText('after-network-restored', { timeout: 18000 });
  await page.goto(base + '/dashboard/profile'); await expect(page.getByRole('heading', { name: 'Настройки уведомлений' })).toBeVisible();
  await page.getByRole('button', { name: 'Настройки уведомлений', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Дублировать на подтверждённую почту учётной записи' }).uncheck();
  await page.getByRole('button', { name: 'Сохранить настройки уведомлений' }).click(); await expect(page.getByText('Настройки сохранены.', { exact: true })).toBeVisible();
  assert.equal((await db.notificationSettings.findUniqueOrThrow({ where: { userId: alex.id } })).personalEmail, false);
  // Existing source pages independently authorize every deep link.
  await page.goto(base + brs.find(n => n.href.includes(event.id)).href); await expect(page.getByRole('dialog')).toBeVisible();
  await page.goto(base + `/dashboard/news?id=${news.id}`); await expect(page.getByRole('heading', { name: announcement.title })).toBeVisible();
  await page.goto(base + `/dashboard/services?requestId=${draft.id}`); await expect(page.locator('.services-request-heading')).toBeVisible();
  await page.goto(base + notices.find(n => n.recipientId === alex.id).href); await expect(page.getByRole('heading', { name: 'Моё расписание' })).toBeVisible();
  for (const u of [teacher, admin, staff, dean]) {
    const home = ({ TEACHER: '/teacher', ADMIN: '/admin', TECHNICAL_STAFF: '/staff', DEANERY_STAFF: '/deanery' })[u.role];
    const { context: c, page: p } = await signed(u);
    await checkHeader(p, home);
    await emit(u, 'role-' + u.role); await p.goto(base + home + '/notifications'); await expect(p.locator('.notification-list')).toContainText('role-' + u.role);
    const data = await (await c.request.get(base + '/api/notifications')).json(); assert(!data.items.some(n => n.title.includes('private-maria') || n.title.includes('browser-no-f5')));
    await p.goto(base + home); await expect(p.locator('.notification-summary')).toBeVisible(); await c.close();
  }
  assert.equal(diagnostics.length, 0, diagnostics.join('\n'));
  assert(!/Next\.js encountered|Blocking Route|Instant validation|uncached data|unstable value/i.test(logs));
  pass('Real browser: polling without F5, shared menu/home/feed count, two tabs, read-all race, network recovery, settings, deep links, 360/1366px and all five roles');
  await context.close();
  const check = createClient({ url: env.DATABASE_URL }); await integrity(check); check.close();
} finally {
  if (browser) await browser.close();
  if (child) { const exited = new Promise(r => child.once('exit', r)); child.kill(); await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]); }
  if (smtp) await new Promise(r => smtp.close(r));
  await db.$disconnect();
  assert.equal(await fingerprint(source), before, 'Main database changed'); source.close();
  writeFileSync(resolve(root, 'results.json'), JSON.stringify({ results, diagnostics, sourceUnchanged: true }, null, 2), { mode: 0o600 });
  console.info('Notification report: ' + root);
}
