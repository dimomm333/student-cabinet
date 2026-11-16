import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createClient } from '@libsql/client';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import sharp from 'sharp';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { fingerprint, integrity } from './database-snapshot.mjs';
import { provisionTestDatabase } from './test-fixtures.mjs';
import { seedServices } from '../src/lib/services-repository.ts';
import { serviceCatalog } from '../src/lib/services-catalog.ts';

mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/services-ui-')), source = createClient({ url: getDatabaseUrl() }), before = await fingerprint(source);
const env = provisionTestDatabase(resolve(root, 'test.db')); process.env.DATABASE_URL = env.DATABASE_URL;
const db = createPrismaClient(), password = randomBytes(24).toString('base64url'), results = [], diagnostics = [];
let browser, child;
const pass = name => { results.push(name); console.info('PASS: ' + name); };
const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function waitDetail(page) { await expect(page.locator('.services-request-heading h2')).toBeVisible(); await expect(page.locator('.services-detail')).toHaveAttribute('aria-busy', 'false'); }
async function field(page, label, value) { await page.getByLabel(new RegExp('^' + escaped(label))).first().fill(value); }
async function saved(page, label = 'Сохранить изменения') { await page.getByRole('button', { name: label, exact: true }).click(); await expect(page.locator('.services-success')).toBeVisible(); }
async function noOverflow(page) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflow'); }
try {
  await seedServices(db);
  await db.account.updateMany({ where: { providerId: 'credential' }, data: { password: await hashPassword(password) } });
  const student = await db.user.findUniqueOrThrow({ where: { email: 'alexander.smirnov@example.test' } });
  const dean = await db.user.findUniqueOrThrow({ where: { email: 'olga.kuznetsova@example.test' } });
  const studentProfile = await db.studentProfile.findUniqueOrThrow({ where: { userId: student.id }, include: { group: true } });
  const departmentId = studentProfile.group.departmentId;
  const authority = { routes: serviceCatalog.map(s => ({ serviceCode: s.code, sourceDepartmentId: departmentId, departmentId, active: true })), grants: serviceCatalog.map(s => ({ userId: dean.id, departmentId, serviceCode: s.code, active: true, readFiles: true, readMilitary: s.code === 'military-change' })) };
  const configFile = resolve(root, 'authority.json'); writeFileSync(configFile, JSON.stringify(authority), { mode: 0o600 });
  const configured = spawnSync(process.execPath, ['--conditions=react-server', 'scripts/configure-services.mjs', configFile], { env: process.env, encoding: 'utf8', windowsHide: true }); assert.equal(configured.status, 0, configured.stderr);
  const net = createServer(); await new Promise(r => net.listen(0, '127.0.0.1', r)); const port = net.address().port; await new Promise(r => net.close(r));
  const base = 'http://127.0.0.1:' + port;
  const serverEnv = { ...process.env, BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_TRUST_PROXY: 'false', AUTH_PROXY_SECRET: '', SERVICES_STORAGE_DIR: resolve(root, 'files') };
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: serverEnv, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  const contexts = [];
  async function signed(email, viewport = { width: 1366, height: 900 }) {
    const context = await browser.newContext({ viewport }); contexts.push(context);
    const login = await context.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email, password } }); assert.equal(login.status(), 200);
    const page = await context.newPage();
    page.on('pageerror', e => diagnostics.push(e.message));
    page.on('console', m => { if (/hydration|Next\.js encountered|Blocking Route|Instant validation|uncached data|unstable value/i.test(m.text())) diagnostics.push(m.text()); });
    return { context, page };
  }
  const { page } = await signed(student.email), { page: staff, context: staffContext } = await signed(dean.email);
  await page.goto(base + '/dashboard/services');
  await expect(page.locator('.services-category')).toHaveCount(4);
  await expect(page.locator('.services-category li')).toHaveCount(15);
  await expect(page.locator('.services-appeal h2')).toHaveText('Обращение в деканат');
  await page.getByRole('button', { name: 'Черновики', exact: true }).click(); await expect(page.locator('.services-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Каталог услуг', exact: true }).click(); await expect(page.locator('.services-category')).toHaveCount(4); await expect(page.getByText('Загружаем каталог…', { exact: true })).toHaveCount(0);
  await noOverflow(page); await page.screenshot({ path: resolve(root, 'catalog-1366.png'), fullPage: true });
  await page.getByRole('searchbox', { name: 'Поиск услуг' }).fill('матпомощь');
  await expect(page.locator('.services-category li')).toHaveCount(1);
  await page.locator('.services-category a').click();
  await page.getByRole('button', { name: 'Создать черновик' }).click(); await waitDetail(page);
  let id = new URL(page.url()).searchParams.get('requestId'); assert(id);
  await field(page, 'Основание / причина', 'Непредвиденные расходы'); await field(page, 'Обстоятельства', 'Подтверждающий документ приложен');
  const png = await sharp({ create: { width: 100, height: 120, channels: 3, background: '#71945d' } }).png().toBuffer();
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.services-success')).toContainText('загружен');
  await saved(page); await page.reload(); await waitDetail(page);
  await expect(page.getByLabel(/^Основание \/ причина/).first()).toHaveValue('Непредвиденные расходы');
  const otherDevice = await signed(student.email, { width: 360, height: 800 });
  await otherDevice.page.goto(base + '/dashboard/services?requestId=' + id); await waitDetail(otherDevice.page);
  await expect(otherDevice.page.getByLabel(/^Основание \/ причина/).first()).toHaveValue('Непредвиденные расходы'); await noOverflow(otherDevice.page);
  await otherDevice.page.screenshot({ path: resolve(root, 'draft-360.png'), fullPage: true });
  await page.getByLabel('Подтверждаю актуальность показанных официальных данных').check();
  await page.getByRole('button', { name: 'Отправить заявление', exact: true }).dblclick();
  await expect(page.locator('.services-request-heading .services-status')).toHaveText('Подано');
  assert.equal(await db.serviceEvent.count({ where: { requestId: id, type: 'SUBMITTED' } }), 1);
  pass('Catalogue, debounced synonym search, draft/file persistence across devices, profile confirmation and double submission');

  await staff.goto(base + '/deanery/requests'); await expect(staff.locator('.services-request-row')).toHaveCount(1); await staff.locator('.services-request-row').click(); await waitDetail(staff);
  const downloaded = await staffContext.request.get(base + '/api/services?view=file&id=' + (await db.serviceDocument.findFirstOrThrow({ where: { requestId: id } })).id); assert.equal(downloaded.status(), 200);
  await staff.getByLabel('Действие', { exact: true }).selectOption('IN_REVIEW'); await saved(staff, 'Применить решение');
  await staff.getByLabel('Действие', { exact: true }).selectOption('CLARIFICATION_REQUIRED');
  await staff.getByRole('checkbox', { name: /Обстоятельства/ }).check();
  await staff.getByRole('checkbox', { name: /Подтверждающий документ/ }).check();
  await staff.getByLabel('Что необходимо уточнить').fill('Уточните обстоятельства и замените скан.'); await saved(staff, 'Применить решение');
  await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await expect(page.locator('.services-notice')).toContainText('Уточните обстоятельства');
  assert.equal(await page.getByLabel(/^Основание \/ причина/).count(), 0);
  await field(page, 'Обстоятельства', 'Уточнённые сведения студента');
  await page.getByRole('button', { name: 'Удалить / заменить' }).click(); await expect(page.locator('.services-success')).toContainText('снято');
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'updated.png', mimeType: 'image/png', buffer: png }); await expect(page.locator('.services-success')).toContainText('загружен');
  await page.getByLabel('Подтверждаю актуальность показанных официальных данных').check(); await saved(page, 'Отправить уточнение');
  await staff.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await expect(staff.locator('.services-request-heading .services-status')).toHaveText('На рассмотрении');
  await staff.getByLabel('Действие', { exact: true }).selectOption('IN_PROGRESS'); await saved(staff, 'Применить решение');
  await staff.getByLabel('Добавить итоговый документ', { exact: true }).setInputFiles({ name: 'result.png', mimeType: 'image/png', buffer: png }); await expect(staff.locator('.services-success')).toContainText('загружен');
  await staff.getByLabel('Действие', { exact: true }).selectOption('COMPLETED'); await staff.getByLabel('Результат исполнения').fill('Решение принято. <script>literal</script>\nОригинал выдаётся лично.'); await saved(staff, 'Применить решение');
  await page.goto(base + '/dashboard/notifications'); await expect(page.locator('.services-event').filter({ hasText: 'Заявление исполнено' })).toHaveCount(1);
  await page.locator('.services-event').filter({ hasText: 'Заявление исполнено' }).click(); await waitDetail(page);
  await expect(page.locator('.services-result')).toContainText('Решение принято. <script>literal</script>'); assert.equal(await page.locator('.services-detail script').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Отправить заявление', exact: true }).count(), 0);
  await expect(page.getByText('Итоговый документ ·')).toBeVisible();
  await page.screenshot({ path: resolve(root, 'completed-1366.png'), fullPage: true });
  await otherDevice.page.goto(base + '/dashboard/services?requestId=' + id); await waitDetail(otherDevice.page); await noOverflow(otherDevice.page); await otherDevice.page.screenshot({ path: resolve(root, 'completed-360.png'), fullPage: true });
  pass('Employee queue, protected download, clarification with file replacement, resubmission, completion/result and linked notifications');

  for (const config of serviceCatalog) {
    await page.goto(base + '/dashboard/services?service=' + config.code); await page.getByRole('button', { name: 'Создать черновик' }).click(); await waitDetail(page);
    for (const f of config.fields) assert.equal(await page.getByLabel(new RegExp('^' + escaped(f.label))).first().count(), 1, config.code + '.' + f.key);
    if (config.code === 'pass-reissue') {
      await page.getByLabel(/^Фотография/).selectOption('NEW'); await expect(page.getByLabel(/^Загрузить: Новая фотография/)).toBeVisible();
      await page.getByLabel(/^Фотография/).selectOption('KEEP'); await expect(page.getByLabel(/^Загрузить: Новая фотография/)).toHaveCount(0);
    }
  }
  pass('All 16 API-configured forms render their own fields; conditional pass photograph');
  await page.goto(base + '/dashboard/services'); await page.getByRole('button', { name: 'Описать вопрос' }).click();
  await page.getByLabel('Ваш вопрос', { exact: true }).fill('Потерял пропуск');
  await expect(page.locator('.services-suggestions a').first()).toBeVisible(); await page.locator('.services-suggestions a').filter({ hasText: 'Перевыпуск' }).click();
  await page.getByRole('button', { name: 'Создать черновик' }).click(); await waitDetail(page); assert.equal(await page.getByLabel(/^Основание \/ причина/).first().inputValue(), '');
  await page.goto(base + '/dashboard/services'); await page.getByRole('button', { name: 'Описать вопрос' }).click(); await page.getByLabel('Ваш вопрос', { exact: true }).fill('Нестандартный вопрос'); await page.getByRole('button', { name: 'Продолжить общее обращение' }).click(); await waitDetail(page);
  await field(page, 'Тема', 'Обращение'); await field(page, 'Вопрос', 'Обычный вопрос студента'); await saved(page);
  const appealId = new URL(page.url()).searchParams.get('requestId');
  // Network error retains input; retry gets the same key. Version conflict retains unsaved fields.
  await field(page, 'Тема', 'Сохранить мой ввод');
  let failed = false;
  await page.route('**/api/services', async route => { if (route.request().method() === 'POST' && !failed) { failed = true; await route.abort(); } else await route.continue(); });
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click(); await expect(page.locator('.services-error')).toContainText('Нет связи'); await expect(page.getByLabel(/^Тема/).first()).toHaveValue('Сохранить мой ввод');
  await saved(page); await page.unroute('**/api/services');
  const original = await db.serviceRequest.findUniqueOrThrow({ where: { id: appealId } });
  await db.serviceRequest.update({ where: { id: appealId }, data: { version: { increment: 1 } } });
  await field(page, 'Тема', 'После конфликта'); await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click(); await expect(page.locator('.services-error')).toContainText('изменено');
  await page.getByRole('button', { name: 'Обновить версию, сохранив мой ввод', exact: true }).click(); await expect(page.getByLabel(/^Тема/).first()).toHaveValue('После конфликта'); await saved(page);
  assert.equal((await db.serviceRequest.findUniqueOrThrow({ where: { id: appealId } })).version, original.version + 2);
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') }); await expect(page.locator('.services-error')).toContainText('PNG или JPEG');
  await page.getByLabel('Подтверждаю актуальность показанных официальных данных').check(); await saved(page, 'Отправить заявление');
  await staff.goto(base + '/deanery/requests?requestId=' + appealId); await waitDetail(staff); await staff.getByLabel('Действие', { exact: true }).selectOption('IN_REVIEW'); await saved(staff, 'Применить решение'); await staff.getByLabel('Действие', { exact: true }).selectOption('REJECTED'); await expect(staff.getByRole('button', { name: 'Применить решение' })).toBeDisabled(); await staff.getByLabel('Причина отказа').fill('Указанная услуга не относится к полномочиям подразделения.'); await saved(staff, 'Применить решение');
  await page.reload(); await waitDetail(page); await expect(page.locator('.services-result-rejected')).toContainText('не относится к полномочиям');
  pass('Appeal suggestions without carrying text, nonblocking general appeal, network recovery, version conflict, PDF rejection and reasoned refusal');
  await page.goto(base + '/dashboard/services?service=deanery-appeal'); await page.getByRole('button', { name: 'Создать черновик' }).click(); await waitDetail(page); const deletedId = new URL(page.url()).searchParams.get('requestId'); await page.getByRole('button', { name: 'Удалить черновик', exact: true }).click(); await page.getByRole('button', { name: 'Да, удалить', exact: true }).click(); await expect(page.locator('.services-tabs button[aria-current=page]')).toHaveText('Черновики'); assert((await db.serviceRequest.findUniqueOrThrow({ where: { id: deletedId } })).deletedAt);
  await page.goto(base + '/dashboard/profile'); await expect(page.locator('.services-military')).toContainText('Сведения не предоставлены');
  await db.militaryRecord.create({ data: { userId: student.id, departmentId, office: 'Тестовый военкомат', documentType: 'Тестовый документ' } }); await page.reload(); await expect(page.locator('.services-military')).toContainText('Тестовый военкомат'); assert.equal(await page.locator('.services-military input').count(), 0);
  await page.locator('.services-military a').click(); await expect(page.locator('.services-panel h2')).toContainText('воинского учёта');
  const foreign = await signed('maria.volkova@example.test');
  for (const view of ['request', 'file']) { const doc = await db.serviceDocument.findFirstOrThrow({ where: { requestId: id } }); const res = await foreign.context.request.get(base + '/api/services?' + new URLSearchParams({ view, id: view === 'file' ? doc.id : id })); assert.equal(res.status(), 404); }
  for (const [email, home] of [['irina.lebedeva@example.test', '/admin/requests'], ['sergey.petrov@example.test', '/staff/services'], ['mikhail.sokolov@example.test', '/teacher']]) {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) continue;
    const denied = await signed(email);
    assert.equal((await denied.context.request.get(base + '/api/services?view=military&studentId=' + student.id)).status(), 404);
    assert.equal((await denied.context.request.get(base + '/api/services?view=request&id=' + id)).status(), 404);
    if (user.role !== 'TEACHER') { await denied.page.goto(base + home); await expect(denied.page.locator('.services-empty')).toBeVisible(); }
  }
  await db.serviceGrant.updateMany({ where: { userId: dean.id }, data: { active: false } }); await staff.goto(base + '/deanery/requests?requestId=' + id); await expect(staff.locator('.services-error')).toContainText('недоступно');
  pass('Draft deletion, read-only real/absent military record, foreign applications/documents and revoked staff access');
  await otherDevice.page.goto(base + '/dashboard/services'); await expect(otherDevice.page.locator('.services-category')).toHaveCount(4); await noOverflow(otherDevice.page); await otherDevice.page.screenshot({ path: resolve(root, 'catalog-360.png'), fullPage: true });
  assert.deepEqual(diagnostics, []); pass('360px/1366px layouts, no horizontal overflow and no React/hydration/navigation diagnostics');
  const inspect = createClient({ url: env.DATABASE_URL }); await integrity(inspect); inspect.close(); assert.equal(await fingerprint(source), before, 'Main database modified');
  writeFileSync(resolve(root, 'results.json'), JSON.stringify({ passed: results, diagnostics, mainDatabaseUnchanged: true }, null, 2), { mode: 0o600 }); console.info('Services UI report: ' + root);
} catch (e) { if (browser) { const pages = browser.contexts().flatMap(c => c.pages()); for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: resolve(root, 'failure-' + i + '.png'), fullPage: true }).catch(() => {}); } throw e; }
finally { if (browser) await browser.close(); if (child && child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } await db.$disconnect(); source.close(); }
