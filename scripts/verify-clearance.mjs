import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createClient } from '@libsql/client';
import { chromium, expect } from '@playwright/test';
import { PDFDocument, PDFRawStream, decodePDFRawStream, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { executeClearanceCommand, clearanceContext, clearanceDetail, listClearances, downloadClearance } from '../src/lib/clearance-repository.ts';
import { listNotifications } from '../src/lib/notifications-repository.ts';
import { parseClearanceCommand } from '../src/lib/clearance-shared.ts';
import { provisionTestDatabase } from './test-fixtures.mjs';
import { snapshot, fingerprint, integrity } from './database-snapshot.mjs';
import { seedClearanceDemo, fixtureActor, clearanceIdentities } from './clearance-fixture.mjs';

mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/clearance-test-')), source = createClient({ url: getDatabaseUrl() }), before = await fingerprint(source);
const env = provisionTestDatabase(resolve(root, 'test.db')); process.env.DATABASE_URL = env.DATABASE_URL;
const db = createPrismaClient(), password = randomBytes(24).toString('base64url'), results = [], diagnostics = [], layout = [];
let browser, child, logs = '';
const pass = name => { results.push(name); console.info('PASS: ' + name); };
const command = (operation, extra = {}) => ({ operation, requestId: randomUUID(), ...extra });
async function port() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
const codes = async (f, code) => assert.rejects(f, e => e.status === code);
try {
  const passwords = Object.fromEntries(clearanceIdentities.map(i => [i.key, password]));
  const demo = await seedClearanceDemo(db, passwords), { users, processId } = demo;
  const initialCounts = { processes: await db.clearanceProcess.count(), users: await db.user.count(), history: await db.clearanceHistory.count(), remarks: await db.clearanceRemark.count() };
  const credentials = await db.account.findMany({ where: { userId: { in: Object.values(users).map(u => u.id) } }, orderBy: { id: 'asc' } });
  const repeated = await seedClearanceDemo(db, passwords); assert.equal(repeated.processId, processId);
  assert.deepEqual(initialCounts, { processes: await db.clearanceProcess.count(), users: await db.user.count(), history: await db.clearanceHistory.count(), remarks: await db.clearanceRemark.count() });
  assert.deepEqual(await db.account.findMany({ where: { userId: { in: Object.values(users).map(u => u.id) } }, orderBy: { id: 'asc' } }), credentials);
  pass('Idempotent synthetic scenario; existing credentials and academic status preserved');
  const actors = {}; for (const [key, u] of Object.entries(users)) actors[key] = await fixtureActor(db, u.id);
  const existing = {}; for (const [key, email] of Object.entries({ ADMIN: 'irina.lebedeva', TEACHER: 'mikhail.sokolov', EMPTY: 'alexander.smirnov', FOREIGN: 'olga.kuznetsova', UNASSIGNED: 'sergey.petrov' })) { const u = await db.user.findUniqueOrThrow({ where: { email: email + '@example.test' } }); existing[key] = u; actors[key] = await fixtureActor(db, u.id); }
  const current = () => clearanceDetail(db, actors.DEAN, processId);
  const run = async (key, operation, extra = {}, target = processId) => { const p = await clearanceDetail(db, actors.DEAN, target); return executeClearanceCommand(db, actors[key], command(operation, { id: target, version: p.version, ...extra })); };
  const p = await current(), library = p.steps.find(s => s.name === 'Библиотека');
  assert.equal(p.status, 'ACTION_REQUIRED'); assert.equal(p.steps.filter(s => s.status === 'APPROVED').length, 4);
  const metrics = (await listClearances(db, actors.STUDENT)).items[0]; assert.equal(metrics.approved, 4); assert.equal(metrics.totalSteps, 5);
  assert.equal((await listClearances(db, actors.EMPTY)).total, 0);
  assert.equal((await listClearances(db, actors.DEAN, { q: 'северин даниил', group: 'демо' })).total, 1);
  assert.equal((await clearanceContext(db, actors.DEAN, 'северин даниил')).studentTotal, 1);
  assert.equal((await clearanceContext(db, actors.ADMIN, 'книжнова анна')).userTotal, 1);
  await codes(() => clearanceDetail(db, actors.EMPTY, processId), 404);
  await codes(() => clearanceDetail(db, actors.FOREIGN, processId), 404);
  await codes(() => clearanceDetail(db, actors.UNASSIGNED, processId), 404);
  await codes(() => clearanceDetail(db, actors.TEACHER, processId), 403);
  const worker = await clearanceDetail(db, actors.LIBRARY, processId);
  assert.equal(worker.steps.length, 1); assert.equal(worker.basisNote, null); assert.equal(worker.reason, null); assert.equal(worker.orderNumber, null); assert(worker.history.every(h => h.stepId === library.id));
  await codes(() => listClearances(db, actors.LIBRARY, { reason: 'WITHDRAWAL' }), 403);
  await codes(() => run('LIBRARY', 'APPROVE', { stepId: p.steps.find(s => s.name === 'Бухгалтерия').id }), 403);
  await codes(() => run('ADMIN', 'APPROVE', { stepId: library.id }), 403);
  await codes(() => run('STUDENT', 'APPROVE', { stepId: library.id }), 403);
  await codes(() => run('DEAN', 'COMPLETE'), 409);
  await codes(() => downloadClearance(db, actors.STUDENT, processId), 404);
  assert.throws(() => parseClearanceCommand(command('APPROVE', { approvedBy: 'forged' })), /недопустимые/);
  assert.throws(() => parseClearanceCommand(command('APPROVE', { stepId: '../other' })), /идентификатор/);
  pass('All five roles, student IDOR, department privacy, forged actor/status, premature completion and PDF denial');

  const create = command('CREATE', { studentId: users.STUDENT.id, templateId: 'clearance-standard-transfer', basisNote: 'Проверка перевода', startsOn: '2026-11-20' });
  const draft = await executeClearanceCommand(db, actors.DEAN, create);
  assert.deepEqual(await executeClearanceCommand(db, actors.DEAN, create), draft);
  await codes(() => executeClearanceCommand(db, actors.DEAN, { ...create, basisNote: 'Изменённое основание' }), 409);
  await codes(() => executeClearanceCommand(db, actors.DEAN, command('CREATE', { ...create, requestId: randomUUID() })), 409);
  await codes(() => clearanceDetail(db, actors.STUDENT, draft.id), 404);
  await codes(() => run('DEAN', 'OPEN', {}, draft.id), 400);
  let dp = await clearanceDetail(db, actors.DEAN, draft.id);
  assert(dp.steps.some(s => s.needsClarification));
  for (const s of dp.steps.filter(s => s.needsClarification)) await run('DEAN', 'APPLICABILITY', { stepId: s.id, required: false, confirmed: true, text: 'Проверено деканатом по синтетическому личному делу; обязательств нет.' }, draft.id);
  await run('DEAN', 'OPEN', {}, draft.id);
  dp = await clearanceDetail(db, actors.DEAN, draft.id);
  const libStep = dp.steps.find(s => s.departmentId === library.departmentId);
  const first = command('START', { id: dp.id, version: dp.version, stepId: libStep.id });
  const concurrent = await Promise.allSettled([executeClearanceCommand(db, actors.LIBRARY, first), executeClearanceCommand(db, actors.LIBRARY, { ...first, requestId: randomUUID() })]);
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
  assert.deepEqual(await executeClearanceCommand(db, actors.LIBRARY, first), concurrent.find(r => r.status === 'fulfilled').value);
  const oldVersion = (await clearanceDetail(db, actors.DEAN, draft.id)).version;
  await run('LIBRARY', 'APPROVE', { stepId: libStep.id }, draft.id);
  await codes(() => executeClearanceCommand(db, actors.LIBRARY, command('REMARK', { id: draft.id, version: oldVersion, stepId: libStep.id, category: 'Конфликт', description: 'Устаревшее действие', requiredAction: 'Не применяется' })), 409);
  await codes(() => run('DEAN', 'CANCEL', { text: '', confirmed: true }, draft.id), 400);
  await run('DEAN', 'CANCEL', { text: 'Тестовая процедура отменена.', confirmed: true }, draft.id);
  await codes(() => run('LIBRARY', 'APPROVE', { stepId: libStep.id }, draft.id), 409);
  const replacement = await executeClearanceCommand(db, actors.DEAN, { ...create, requestId: randomUUID() });
  await run('DEAN', 'CANCEL', { text: 'Повторное тестовое создание проверено.', confirmed: true }, replacement.id);
  pass('Draft privacy, unknown applicability, duplicate reservation, replay, concurrent transitions, stale versions, cancellation and historical recreation');

  const notices = await listNotifications(db, actors.LIBRARY); assert(notices.items.some(n => n.source === 'CLEARANCE' && n.href.includes(processId)));
  await db.clearanceGrant.update({ where: { userId_departmentId: { userId: users.LIBRARY.id, departmentId: library.departmentId } }, data: { active: false } });
  await codes(() => clearanceDetail(db, actors.LIBRARY, processId), 404);
  assert(!(await listNotifications(db, actors.LIBRARY)).items.some(n => n.source === 'CLEARANCE'));
  await db.clearanceGrant.update({ where: { userId_departmentId: { userId: users.LIBRARY.id, departmentId: library.departmentId } }, data: { active: true } });
  await db.deaneryDepartmentAssignment.delete({ where: { userId_departmentId: { userId: users.DEAN.id, departmentId: (await db.clearanceProcess.findUniqueOrThrow({ where: { id: processId } })).academicDepartmentId } } });
  await codes(() => current(), 404);
  const ad = await db.academicDepartment.findUniqueOrThrow({ where: { id: 'clearance-demo-academic' } });
  await db.deaneryDepartmentAssignment.create({ data: { userId: users.DEAN.id, departmentId: ad.id } });
  const beforeTemplate = (await current()).steps.map(s => ({ name: s.name, rule: s.rule }));
  await db.clearanceDepartment.update({ where: { id: library.departmentId }, data: { name: 'Новое имя для будущих процессов' } });
  assert.deepEqual((await current()).steps.map(s => ({ name: s.name, rule: s.rule })), beforeTemplate);
  await db.clearanceDepartment.update({ where: { id: library.departmentId }, data: { name: 'Библиотека' } });
  const expired = await fixtureActor(db, users.STUDENT.id); await db.session.update({ where: { id: expired.sessionId }, data: { createdAt: new Date(Date.now() - 9 * 3600000), expiresAt: new Date(Date.now() + 3600000) } });
  await codes(() => listClearances(db, expired), 401);
  pass('Live department and deanery revocation, inbox revocation, immutable configuration snapshot and absolute session lifetime');

  const settings = (operation, data) => executeClearanceCommand(db, actors.ADMIN, command(operation, data));
  const extraDepartment = await settings('DEPARTMENT', { code: 'clearance-extra', name: 'Дополнительная проверка оборудования с длинным названием подразделения', description: 'Проверка по явно подтверждённому основанию.', contact: 'Кабинет 109', active: true, sortOrder: 95, text: 'Создание дополнительного подразделения для регрессии.' });
  await settings('DEPARTMENT', { id: extraDepartment.id, version: 1, code: 'clearance-extra', name: 'Дополнительная проверка оборудования с длинным названием подразделения', description: 'Проверка по явно подтверждённому основанию.', contact: 'Кабинет 110', active: true, sortOrder: 95, text: 'Контакты уточнены.' });
  await codes(() => settings('DEPARTMENT', { id: extraDepartment.id, version: 1, code: 'clearance-extra', name: 'Устаревшая правка', description: 'Не применяется', contact: 'Нет', active: true, sortOrder: 95, text: 'Конфликт версий.' }), 409);
  const finalDepartment = p.steps.find(s => s.isFinal).departmentId;
  const templateCommand = command('TEMPLATE', { name: 'Дополнительный шаблон', reason: 'TRANSFER', active: true, rules: [{ departmentId: extraDepartment.id, rule: 'ALWAYS' }, { departmentId: finalDepartment, rule: 'FINAL' }], text: 'Явное правило дополнительной проверки.' });
  const extraTemplate = await executeClearanceCommand(db, actors.ADMIN, templateCommand);
  await codes(() => executeClearanceCommand(db, actors.ADMIN, { ...templateCommand, rules: [{ departmentId: extraDepartment.id, rule: 'MANUAL' }, { departmentId: finalDepartment, rule: 'FINAL' }] }), 409);
  await settings('TEMPLATE', { id: extraTemplate.id, version: 1, name: 'Обновлённый дополнительный шаблон', reason: 'TRANSFER', active: true, rules: templateCommand.rules, text: 'Настройка будущих процедур.' });
  for (const key of ['STUDENT', 'ADMIN', 'TEACHER']) await codes(() => settings('GRANT', { userId: actors[key].id, departmentId: extraDepartment.id, active: true, text: 'Проверка ограничения роли.' }), 400);
  await settings('GRANT', { userId: users.LIBRARY.id, departmentId: extraDepartment.id, active: true, text: 'Назначен дополнительный проверяющий.' });
  const extraProcess = await executeClearanceCommand(db, actors.DEAN, command('CREATE', { studentId: users.STUDENT.id, templateId: extraTemplate.id, startsOn: '2026-11-20', basisNote: 'Основание дополнительной проверки', serviceRequestId: '' }));
  await run('DEAN', 'ADD_STEP', { departmentId: library.departmentId, text: 'Дополнительное основание проверки библиотеки.' }, extraProcess.id);
  await run('DEAN', 'OPEN', {}, extraProcess.id);
  let ep = await clearanceDetail(db, actors.DEAN, extraProcess.id);
  for (const s of ep.steps.filter(s => !s.isFinal)) await run('LIBRARY', 'APPROVE', { stepId: s.id }, ep.id);
  ep = await clearanceDetail(db, actors.DEAN, extraProcess.id);
  const finalRace = await Promise.allSettled([
    executeClearanceCommand(db, actors.LIBRARY, command('REMARK', { id: ep.id, version: ep.version, stepId: ep.steps.find(s => s.departmentId === extraDepartment.id).id, category: 'Повторная проверка', description: 'Обнаружено новое подтверждённое обязательство.', requiredAction: 'Вернуть оборудование.' })),
    executeClearanceCommand(db, actors.DEAN, command('COMPLETE', { id: ep.id, version: ep.version })),
  ]);
  assert.equal(finalRace.filter(r => r.status === 'fulfilled').length, 1);
  const raced = await clearanceDetail(db, actors.DEAN, ep.id);
  if (raced.status === 'COMPLETED') {
    assert.equal(await db.clearanceRemark.count({ where: { step: { processId: ep.id }, resolvedAt: null } }), 0);
    await executeClearanceCommand(db, actors.ADMIN, command('INVALIDATE', { id: ep.id, version: raced.version, text: 'Конкурентное итоговое решение проверено.', confirmed: true }));
  } else {
    assert.equal(raced.status, 'ACTION_REQUIRED');
    await codes(() => executeClearanceCommand(db, actors.DEAN, command('COMPLETE', { id: ep.id, version: ep.version })), 409);
    await run('DEAN', 'CANCEL', { text: 'Проверка гонки итогового решения завершена.', confirmed: true }, ep.id);
  }
  await settings('GRANT', { userId: users.LIBRARY.id, departmentId: extraDepartment.id, active: false, text: 'Назначение отозвано после проверки.' });
  assert.equal((await db.studentProfile.findUniqueOrThrow({ where: { userId: users.STUDENT.id } })).educationStatus, 'STUDYING');
  pass('Admin department/template versions, nested replay protection, grants, additional steps, reopened approval and final-review race');

  // Real browser workflow uses the still-open withdrawal scenario.
  if (!process.argv.includes('--server-only')) {
    const base = 'http://127.0.0.1:' + await port();
    child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', new URL(base).port], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, NODE_ENV: 'production', BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_TRUST_PROXY: 'false', AUTH_PROXY_SECRET: '' } });
    child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
    for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
    async function signed(email, pwd, home) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/Los_Angeles' });
      assert.equal((await context.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email, password: pwd } })).status(), 200);
      const page = await context.newPage();
      page.on('pageerror', e => diagnostics.push(e.message)); page.on('console', m => { if (/Next\.js encountered|Blocking Route|Instant validation/.test(m.text())) diagnostics.push(m.text()); });
      await page.goto(base + home + '/clearance'); await page.locator('.clearance-workspace h1').waitFor(); await expect(page.getByText('Загрузка обходного листа…')).toHaveCount(0);
      return { context, page };
    }
    const studentBrowser = await signed(users.STUDENT.email, password, '/dashboard'), sp = studentBrowser.page;
    const staffBrowser = await signed(users.LIBRARY.email, password, '/staff'), wp = staffBrowser.page;
    const deanBrowser = await signed(users.DEAN.email, password, '/deanery'), dp = deanBrowser.page;
    const adminBrowser = await signed(existing.ADMIN.email, env.DEMO_ADMIN_PASSWORD, '/admin'), ap = adminBrowser.page;
    await ap.getByText('Подразделения (', { exact: false }).first().click(); await expect(ap.locator('.clearance-settings strong').filter({ hasText: /^Библиотека$/ })).toBeVisible();
    await ap.getByRole('button', { name: 'Добавить подразделение', exact: true }).click();
    await ap.getByRole('dialog').getByLabel('Название', { exact: true }).fill('Служба конкурсной проверки'); await ap.getByLabel('Внутренний код', { exact: true }).fill('competition-check'); await ap.getByLabel('Описание проверки', { exact: true }).fill('Подтверждение возврата материалов.'); await ap.getByLabel('Контакты', { exact: true }).fill('Корпус Б, кабинет 102'); await ap.getByLabel('Причина изменения', { exact: true }).fill('Настройка через экран администратора.'); await ap.getByRole('button', { name: 'Сохранить настройки', exact: true }).click(); await expect(ap.getByRole('dialog')).toHaveCount(0);
    await dp.getByText('Создать обходной лист', { exact: true }).click(); await dp.locator('select[name=studentId]').selectOption(users.STUDENT.id); await dp.locator('select[name=templateId]').selectOption('clearance-standard-transfer'); await dp.getByLabel('Основание оформления', { exact: true }).fill('Подготовка к переводу по решению деканата.');
    const started = dp.getByLabel('Дата начала', { exact: true });
    await started.fill('28.02.2028');
    const planned = dp.getByLabel('Планируемое завершение', { exact: true });
    await planned.fill('29.02.2028');
    await planned.press('ArrowDown');
    await dp.locator('.schedule-calendar [data-date="2028-02-29"]').click();
    const order = dp.getByLabel('Дата приказа', { exact: true });
    await order.fill('27.02.2028');
    await order.press('ArrowDown');
    await dp.getByRole('button', { name: 'Очистить', exact: true }).click();
    await expect(order).toHaveValue('');
    await order.fill('29.02.2028');
    await dp.getByRole('button', { name: 'Подготовить черновик', exact: true }).click(); await expect(dp.getByRole('button', { name: 'Открыть обходной лист', exact: true })).toBeDisabled(); await expect(dp.locator('.clearance-summary')).toContainText('Черновик');
    const draftWithDates = await db.clearanceProcess.findFirstOrThrow({ where: { basisNote: 'Подготовка к переводу по решению деканата.' } });
    assert.deepEqual([draftWithDates.startsOn, draftWithDates.plannedOn, draftWithDates.orderDate].map(date => date.toISOString().slice(0, 10)), ['2028-02-28', '2028-02-29', '2028-02-29']);
    await dp.reload();
    await expect(dp.locator('.clearance-summary')).toContainText('29.02.2028');
    await dp.getByRole('button', { name: 'Отменить процесс', exact: true }).click(); await dp.getByLabel('Обоснование', { exact: true }).fill('Создание через форму проверено, процедура отменена.'); await dp.getByLabel('Подтверждаю обоснованность решения', { exact: true }).check(); await dp.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(dp.getByRole('dialog')).toHaveCount(0); await dp.getByRole('button', { name: 'Все обходные листы', exact: true }).click();
    pass('Browser admin configuration and deanery draft creation with optional blank application ID, unknown applicability and confirmed cancellation');
    await sp.goto(base + '/dashboard/clearance?id=' + processId); await expect(sp.getByText('Не возвращена книга «Высшая математика».', { exact: true }).first()).toBeVisible();
    for (const theme of ['light', 'dark']) for (const width of [346, 360, 390, 768, 1366]) {
      for (const [name, page] of [['student', sp], ['staff', wp], ['deanery', dp], ['admin', ap]]) {
        await page.setViewportSize({ width, height: 900 }); await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(overflow <= 1, name + ' overflow ' + width);
        layout.push({ name, width, theme, overflow }); await page.screenshot({ path: resolve(root, `${name}-${theme}-${width}.png`), fullPage: true });
      }
    }
    await sp.setViewportSize({ width: 390, height: 900 }); await sp.getByRole('button', { name: 'Сообщить об устранении', exact: true }).click();
    await expect(sp.getByRole('dialog')).toBeVisible(); await sp.getByLabel('Что сделано', { exact: true }).fill('Книга возвращена в библиотеку. Прошу проверить.'); await sp.screenshot({ path: resolve(root, 'student-reply-dialog-390.png') }); await sp.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(sp.getByRole('dialog')).toHaveCount(0);
    await expect(sp.getByText('Ожидает повторной проверки', { exact: true })).toBeVisible();
    await wp.goto(base + '/staff/clearance?id=' + processId);
    await wp.getByRole('button', { name: 'Добавить замечание', exact: true }).first().click();
    const remarkDialog = wp.locator('dialog.clearance-dialog');
    const due = remarkDialog.getByLabel('Срок устранения', { exact: true });
    await due.fill('01.03.2028');
    await due.press('ArrowDown');
    await remarkDialog.locator('[data-date="2028-02-29"]').click();
    await expect(remarkDialog.locator('input[name=dueOn]')).toHaveValue('2028-02-29');
    await wp.keyboard.press('Escape');
    await expect(remarkDialog).toBeHidden();
    await wp.getByRole('button', { name: 'Вернуть на устранение', exact: true }).click(); await wp.getByLabel('Обоснование', { exact: true }).fill('Уточните экземпляр возвращённой книги.'); await wp.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(wp.getByRole('dialog')).toHaveCount(0);
    await sp.reload(); await sp.getByRole('button', { name: 'Сообщить об устранении', exact: true }).click(); await sp.getByLabel('Что сделано', { exact: true }).fill('Возвращён экземпляр 2026-001. Проверено у стойки выдачи.'); await sp.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(sp.getByRole('dialog')).toHaveCount(0);
    await wp.reload(); await wp.screenshot({ path: resolve(root, 'library-recheck.png'), fullPage: true }); await wp.getByRole('button', { name: 'Согласовать', exact: true }).click(); await wp.getByLabel('Результат проверки', { exact: true }).fill('Возврат экземпляра подтверждён библиотекой. Задолженность устранена.'); await wp.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(wp.getByRole('dialog')).toHaveCount(0);
    await dp.goto(base + '/deanery/clearance?id=' + processId); await dp.getByRole('button', { name: 'Завершить обходной лист', exact: true }).click(); await dp.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(dp.getByRole('dialog')).toHaveCount(0, { timeout: 30000 });
    await sp.reload(); await expect(sp.getByRole('heading', { name: 'Обходной лист завершён', exact: true })).toBeVisible();
    const download = sp.waitForEvent('download'); await sp.getByRole('link', { name: 'Скачать итоговый PDF' }).click(); await (await download).saveAs(resolve(root, 'clearance.pdf'));
    await sp.screenshot({ path: resolve(root, 'student-completed.png'), fullPage: true }); await dp.screenshot({ path: resolve(root, 'deanery-completed.png'), fullPage: true });
    const teacherContext = await browser.newContext(); assert.equal((await teacherContext.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: existing.TEACHER.email, password: env.DEMO_TEACHER_PASSWORD } })).status(), 200); assert.equal((await teacherContext.request.get(base + '/api/clearance')).status(), 403);
    const teacherPage = await teacherContext.newPage(); await teacherPage.goto(base + '/staff/clearance'); await teacherPage.waitForURL(base + '/teacher');
    const empty = await signed(existing.EMPTY.email, env.DEMO_ALEXANDER_PASSWORD, '/dashboard'); await expect(empty.page.getByRole('heading', { name: 'Обходной лист не требуется', exact: true })).toBeVisible(); assert.equal((await empty.context.request.get(base + '/api/clearance?view=pdf&id=' + processId)).status(), 404);
    const anonymous = await browser.newContext(); assert.equal((await anonymous.request.get(base + '/api/clearance')).status(), 401); assert.equal((await anonymous.request.get(base + '/api/clearance?view=pdf&id=' + processId)).status(), 401);
    assert.equal((await studentBrowser.context.request.post(base + '/api/clearance', { headers: { Origin: 'https://attacker.invalid' }, data: command('COMPLETE', { id: processId, version: 1 }) })).status(), 403);
    await sp.goto(base + '/dashboard'); await sp.locator('.desktop-sidebar a[href="/dashboard/clearance"]').count().then(async count => { if (count && await sp.locator('.desktop-sidebar').isVisible()) await sp.locator('.desktop-sidebar a[href="/dashboard/clearance"]').click(); else await sp.goto(base + '/dashboard/clearance'); }); await expect(sp.locator('.clearance-list-item').filter({ hasText: 'Завершён' })).toHaveCount(1);
    assert.equal(diagnostics.length, 0, diagnostics.join('\n')); assert(!/Next\.js encountered|Blocking Route|Instant validation/.test(logs));
    pass('Real Chrome: student reply, staff rejection, second reply, confirmed approval, deanery completion, student PDF, archive, teacher/anonymous/CSRF/IDOR denial');
    pass('Both themes; student, staff, deanery and admin at 346/360/390/768/1366px; screenshots, no overflow or browser diagnostics');
  } else {
    await run('STUDENT', 'REPLY', { stepId: library.id, remarkId: library.remarks[0].id, text: 'Книга возвращена.' });
    await run('LIBRARY', 'REJECT_REPLY', { stepId: library.id, remarkId: library.remarks[0].id, text: 'Уточните экземпляр.' });
    await run('STUDENT', 'REPLY', { stepId: library.id, remarkId: library.remarks[0].id, text: 'Экземпляр 2026-001.' });
    await run('LIBRARY', 'APPROVE', { stepId: library.id, text: 'Возврат проверен и подтверждён.' });
    await run('DEAN', 'COMPLETE');
  }
  const completed = await current(); assert.equal(completed.status, 'COMPLETED');
  const file = await downloadClearance(db, actors.STUDENT, processId); writeFileSync(resolve(root, 'clearance.pdf'), file.bytes);
  const pdf = await PDFDocument.load(file.bytes); assert(pdf.getPageCount() >= 1); let pages = 0;
  // The document consists of full-page PNGs. Decode its actual image streams
  // for visual QA without installing a second renderer in the application.
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image' && obj.dict.get(PDFName.of('ColorSpace'))?.toString() === '/DeviceRGB') {
    const width = obj.dict.get(PDFName.of('Width')).asNumber(), height = obj.dict.get(PDFName.of('Height')).asNumber();
    await sharp(Buffer.from(decodePDFRawStream(obj).decode()), { raw: { width, height, channels: 3 } }).resize({ width: 1000 }).png().toFile(resolve(root, 'pdf-page-' + (++pages) + '.png'));
  }
  assert.equal(pages, pdf.getPageCount());
  const stored = await db.clearanceDocument.findUniqueOrThrow({ where: { processId } }), saved = JSON.parse(stored.snapshotJson);
  assert(saved.steps.every(s => s.actor && s.date)); assert(saved.steps.some(s => s.name === 'Библиотека')); assert(saved.completedBy);
  await db.user.update({ where: { id: users.LIBRARY.id }, data: { name: 'Новое отображаемое имя' } });
  assert((await downloadClearance(db, actors.STUDENT, processId)).bytes.equals(file.bytes));
  await codes(() => run('LIBRARY', 'REMARK', { stepId: library.id, category: 'Нельзя', description: 'Закрытый процесс', requiredAction: 'Нет' }), 409);
  await codes(() => run('DEAN', 'COMPLETE'), 409);
  const finalVersion = completed.version;
  await executeClearanceCommand(db, actors.ADMIN, command('INVALIDATE', { id: processId, version: finalVersion, text: 'Привилегированное аннулирование для проверки защиты итогового документа.', confirmed: true }));
  await codes(() => downloadClearance(db, actors.STUDENT, processId), 404);
  assert.equal((await db.clearanceDocument.findUniqueOrThrow({ where: { processId } })).sha256, stored.sha256);
  const notifications = await db.notificationEvent.findMany({ where: { source: 'CLEARANCE' } });
  assert.equal(new Set(notifications.map(n => n.sourceKey)).size, notifications.length);
  assert(notifications.every(n => !/Высшая|экземпляр|по собственному/.test(n.body) && n.clearanceProcessId));
  const check = createClient({ url: env.DATABASE_URL }); await integrity(check); const backup = resolve(root, 'restored.db'); await check.execute({ sql: 'VACUUM INTO ?', args: [backup] }); const restored = createClient({ url: 'file:' + backup.replaceAll('\\', '/') }); await integrity(restored); assert.deepEqual(await snapshot(restored), await snapshot(check)); restored.close(); check.close();
  pass('Persisted PDF and Cyrillic pages, immutable names/decisions, terminal guards, audited invalidation, generic deduplicated notifications, consistent restore and foreign keys');
} finally {
  await browser?.close();
  if (child) { const exited = new Promise(r => child.once('exit', r)); child.kill(); await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]); }
  await db.$disconnect(); const sourceUnchanged = before === await fingerprint(source); source.close();
  writeFileSync(resolve(root, 'results.json'), JSON.stringify({ results, diagnostics, layout, sourceUnchanged }, null, 2), { mode: 0o600 });
  writeFileSync(resolve(root, 'server.log'), logs.replaceAll(password, '[REDACTED]'), { mode: 0o600 }); console.info('Clearance report: ' + root); assert(sourceUnchanged, 'Main database changed');
}
