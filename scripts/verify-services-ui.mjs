import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createClient } from '@libsql/client';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { fingerprint, integrity } from './database-snapshot.mjs';
import { provisionTestDatabase } from './test-fixtures.mjs';
import { seedServices } from '../src/lib/services-repository.ts';
import { serviceCatalog } from '../src/lib/services-catalog.ts';
import { verifyImagePreparation } from './services-image-checks.mjs';
import { navigationPdf, actionPdf } from './service-pdf-fixtures.mjs';

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
  await expect(page.locator('.services-appeal h2')).toHaveText('Не нашли подходящую услугу?');
  await page.getByRole('button', { name: 'Черновики', exact: true }).click(); await expect(page.locator('.services-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Каталог услуг', exact: true }).click(); await expect(page.locator('.services-category')).toHaveCount(4); await expect(page.getByText('Загружаем каталог…', { exact: true })).toHaveCount(0);
  await noOverflow(page); await page.screenshot({ path: resolve(root, 'catalog-1366.png'), fullPage: true });
  await page.getByRole('searchbox', { name: 'Поиск услуг' }).fill('матпомощь');
  await expect(page.locator('.services-category li')).toHaveCount(1);
  await page.locator('.services-category a').click();
  await page.getByRole('button', { name: 'Создать черновик' }).click(); await waitDetail(page);
  let id = new URL(page.url()).searchParams.get('requestId'); assert(id);
  await field(page, 'Основание / причина', 'Непредвиденные расходы'); await field(page, 'Обстоятельства', 'Подтверждающий документ приложен');
  await expect(page.locator('.services-autosave')).toContainText('Сохранено');
  await page.reload(); await waitDetail(page);
  await expect(page.getByLabel(/^Обстоятельства/)).toHaveValue('Подтверждающий документ приложен');
  const png = await sharp({ create: { width: 100, height: 120, channels: 3, background: '#71945d' } }).png().toBuffer();
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.services-success')).toContainText('загружен');
  await expect(page.locator('.services-upload-progress')).toHaveCount(0);
  await expect(page.locator('.services-file').filter({ hasText: 'proof.png' })).toContainText('КБ');
  await expect(page.locator('.services-file').filter({ hasText: 'proof.png' }).getByRole('button', { name: 'Удалить / заменить' })).toBeVisible();
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
  await page.goto(base + '/dashboard/services'); await expect(page.locator('.services-category')).toHaveCount(4);
  await expect(page.locator('.services-appeal textarea')).toHaveCount(0);
  const appealButton = page.getByRole('button', { name: 'Написать обращение в деканат', exact: true });
  await expect(appealButton).toBeDisabled();
  await page.getByLabel('Я просмотрел каталог и не нашёл подходящей услуги', { exact: true }).check();
  await expect(appealButton).toBeEnabled(); await appealButton.click(); await waitDetail(page);
  await field(page, 'Тема', 'Обращение'); await field(page, 'Вопрос', 'Обычный вопрос студента'); await saved(page);
  await expect(page.getByRole('checkbox', { name: 'Я просмотрел каталог и не нашёл подходящей услуги' })).toHaveCount(0);
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
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') }); await expect(page.locator('.services-error')).toContainText('PDF');
  await page.getByLabel('Подтверждаю актуальность показанных официальных данных').check(); await saved(page, 'Отправить заявление');
  await staff.goto(base + '/deanery/requests?requestId=' + appealId); await waitDetail(staff); await staff.getByLabel('Действие', { exact: true }).selectOption('IN_REVIEW'); await saved(staff, 'Применить решение'); await staff.getByLabel('Действие', { exact: true }).selectOption('REJECTED'); await expect(staff.getByRole('button', { name: 'Применить решение' })).toBeDisabled(); await staff.getByLabel('Причина отказа').fill('Указанная услуга не относится к полномочиям подразделения.'); await saved(staff, 'Применить решение');
  await page.reload(); await waitDetail(page); await expect(page.locator('.services-result-rejected')).toContainText('не относится к полномочиям');
  pass('Catalogue confirmation, structured general appeal, network recovery, version conflict, corrupt PDF rejection and reasoned refusal');
  // Autosave without a manual save, including typing while an older save waits.
  await page.goto(base + '/dashboard/services?service=deanery-appeal');
  const beforeCreateRetry = await db.serviceRequest.count({ where: { ownerId: student.id, serviceCode: 'deanery-appeal' } });
  let lostCreateResponse = false;
  await page.route('**/api/services', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.operation === 'CREATE' && !lostCreateResponse) { lostCreateResponse = true; await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Создать черновик', exact: true }).click(); await expect(page.locator('.services-error')).toContainText('Нет связи');
  await page.reload(); await page.getByRole('button', { name: 'Создать черновик', exact: true }).click(); await waitDetail(page); await page.unroute('**/api/services');
  assert.equal(await db.serviceRequest.count({ where: { ownerId: student.id, serviceCode: 'deanery-appeal' } }), beforeCreateRetry + 1);
  const autoId = new URL(page.url()).searchParams.get('requestId');
  // Regression: a real ~3 MiB JPEG used to inflate to >8 MiB PNG and fail 413.
  const largePhoto = await sharp(randomBytes(2000 * 1800 * 3), { raw: { width: 2000, height: 1800, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  assert(largePhoto.length > 2.8 * 1024 * 1024 && largePhoto.length < 3.2 * 1024 * 1024);
  const inflated = await sharp(largePhoto).rotate().png().toBuffer(); assert(inflated.length > 8 * 1024 * 1024);
  let savePending = false;
  await page.route('**/api/services', async route => { if (route.request().postDataJSON()?.operation === 'SAVE') { savePending = true; await new Promise(r => setTimeout(r, 600)); } await route.continue(); });
  await field(page, 'Тема', 'Одновременное сохранение и JPEG'); await field(page, 'Вопрос', 'Проверка фотографии');
  await expect.poll(() => savePending).toBe(true);
  const photoResponse = page.waitForResponse(r => r.url().includes('upload=1'));
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'pexels-kienvirak-4826377.jpg', mimeType: 'image/jpeg', buffer: largePhoto });
  const photoHttp = await photoResponse; assert.equal(photoHttp.status(), 200, await photoHttp.text());
  await expect(page.locator('.services-file a').filter({ hasText: 'pexels-kienvirak-4826377.jpg' })).toBeVisible();
  await expect(page.locator('.services-upload-progress')).toHaveCount(0); await expect(page.locator('.services-error')).toHaveCount(0);
  await page.unroute('**/api/services');
  const photoDoc = await db.serviceDocument.findFirstOrThrow({ where: { requestId: autoId, name: 'pexels-kienvirak-4826377.jpg' } });
  assert.equal(photoDoc.mime, 'image/jpeg'); assert(photoDoc.size <= 8 * 1024 * 1024);
  const photoBytes = readFileSync(resolve(root, 'files', photoDoc.key)); assert.equal(photoBytes.length, photoDoc.size);
  assert.equal((await sharp(photoBytes).metadata()).format, 'jpeg');
  assert.equal(await db.serviceHistory.count({ where: { requestId: autoId, action: 'UPLOAD' } }), 1);
  assert.equal(readdirSync(resolve(root, 'files')).filter(key => key === photoDoc.key).length, 1);
  await page.reload(); await waitDetail(page); await expect(page.locator('.services-file a').filter({ hasText: photoDoc.name })).toBeVisible();
  const photoDownload = await page.context().request.get(base + '/api/services?view=file&id=' + photoDoc.id);
  assert.equal(photoDownload.headers()['content-type'], 'image/jpeg'); assert.match(photoDownload.headers()['content-disposition'], /document\.jpg/); assert((await photoDownload.body()).equals(photoBytes));
  await page.locator('.services-file').filter({ hasText: photoDoc.name }).getByRole('button', { name: 'Удалить / заменить' }).click();
  await expect(page.locator('.services-success')).toContainText('снято');
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: largePhoto });
  await expect(page.locator('.services-file a').filter({ hasText: 'replacement.jpg' })).toBeVisible(); await expect(page.locator('.services-upload-progress')).toHaveCount(0);
  assert((await db.serviceDocument.findUniqueOrThrow({ where: { id: photoDoc.id } })).removedAt); assert(readFileSync(resolve(root, 'files', photoDoc.key)).equals(photoBytes));
  const largePng = await sharp(randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
  const pngResponse = page.waitForResponse(r => r.url().includes('upload=1'));
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'representative-3mib.png', mimeType: 'image/png', buffer: largePng });
  assert.equal((await pngResponse).status(), 200);
  await expect(page.locator('.services-file a').filter({ hasText: 'representative-3mib.png' })).toBeVisible(); await expect(page.locator('.services-upload-progress')).toHaveCount(0);
  pass('3 MiB JPEG browser regression: old PNG inflation >8 MiB, concurrent autosave, HTTP 200, JPEG blob/DB/version/history, reload/download, removal and replacement');
  let delayed = false;
  await page.route('**/api/services', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.operation === 'SAVE' && !delayed) { delayed = true; await new Promise(r => setTimeout(r, 1000)); }
    await route.continue();
  });
  await field(page, 'Тема', 'Первая версия');
  await expect.poll(() => delayed).toBe(true);
  await field(page, 'Тема', 'Самая последняя версия'); await field(page, 'Вопрос', 'Потерял карточку студента');
  await expect(page.locator('.services-autosave')).toContainText('Сохранено');
  await page.unroute('**/api/services');
  await expect.poll(async () => JSON.parse((await db.serviceRequest.findUniqueOrThrow({ where: { id: autoId } })).fieldsJson).subject).toBe('Самая последняя версия');
  const sameSession = await signed(student.email);
  await sameSession.page.goto(page.url()); await waitDetail(sameSession.page); await expect(sameSession.page.getByLabel(/^Тема/)).toHaveValue('Самая последняя версия');
  await page.reload(); await waitDetail(page); await expect(page.getByLabel(/^Вопрос/)).toHaveValue('Потерял карточку студента');
  // Immediate navigation flushes before returning to the catalogue.
  await field(page, 'Тема', 'Перед переходом'); await page.getByRole('link', { name: '← К каталогу услуг', exact: true }).click();
  await expect(page.locator('.services-category')).toHaveCount(4);
  await page.goto(base + '/dashboard/services?requestId=' + autoId); await waitDetail(page); await expect(page.getByLabel(/^Тема/)).toHaveValue('Перед переходом');
  // Pending values recover on reload without a network connection.
  await page.context().setOffline(true); await field(page, 'Тема', 'Аварийный ввод');
  await expect(page.locator('.services-autosave')).toContainText('Не удалось сохранить');
  await page.context().setOffline(false); await page.reload(); await waitDetail(page);
  await expect(page.getByLabel(/^Тема/)).toHaveValue('Аварийный ввод'); await expect(page.locator('.services-autosave')).toContainText('Сохранено');
  // Closing the page after a successful autosave needs no sessionStorage recovery.
  const closedUrl = page.url(); await sameSession.page.close();
  const reopened = await sameSession.context.newPage(); await reopened.goto(closedUrl); await waitDetail(reopened); await expect(reopened.getByLabel(/^Тема/)).toHaveValue('Аварийный ввод');
  const freshBrowser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  try {
    const freshContext = await freshBrowser.newContext();
    assert.equal((await freshContext.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: student.email, password } })).status(), 200);
    const freshPage = await freshContext.newPage(); await freshPage.goto(closedUrl); await waitDetail(freshPage); await expect(freshPage.getByLabel(/^Тема/)).toHaveValue('Аварийный ввод');
  } finally { await freshBrowser.close(); }
  // Actual XHR progress reaches processing before the delayed server response.
  const pdf = await PDFDocument.create(); const representativePage = pdf.addPage([200, 200]);
  representativePage.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(Buffer.alloc(164 * 1024, 32))));
  const pdfBuffer = Buffer.from(await pdf.save());
  const longPdfName = 'Руководство HONOR & инструкция, (русская версия) ' + 'подробное описание '.repeat(6) + '.pdf';
  assert(longPdfName.length > 120 && longPdfName.length < 255);
  let acknowledged = false, failedReads = 0;
  await page.route('**/api/services?upload=*', async route => {
    const response = await route.fetch(); acknowledged = response.ok(); await route.fulfill({ response });
  });
  await page.route('**/api/services?view=request&*', async route => {
    if (acknowledged && failedReads < 2) { failedReads++; await route.abort(); } else await route.continue();
  });
  const longResponse = page.waitForResponse(r => r.url().includes('upload=1'));
  await field(page, 'Тема', 'Автосохранение перед загрузкой PDF');
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: longPdfName, mimeType: 'application/pdf', buffer: pdfBuffer });
  const accepted = await longResponse; assert.equal(accepted.status(), 200, await accepted.text());
  await expect(page.locator('.services-file a').filter({ hasText: longPdfName })).toBeVisible();
  await expect(page.locator('.services-upload-progress')).toHaveCount(0);
  await expect(page.locator('.services-success')).toContainText('Документ загружен');
  assert.equal(failedReads, 2); await page.unroute('**/api/services?view=request&*');
  await page.unroute('**/api/services?upload=*');
  assert.equal(await db.serviceDocument.count({ where: { requestId: autoId, name: longPdfName } }), 1);
  assert.equal(JSON.parse((await db.serviceRequest.findUniqueOrThrow({ where: { id: autoId } })).fieldsJson).subject, 'Автосохранение перед загрузкой PDF');
  await page.route('**/api/services?view=request&*', route => route.abort());
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'saved-refresh.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  await expect(page.locator('.services-success')).toContainText('Повторно загружать файл не нужно');
  await expect(page.locator('.services-upload-progress')).toHaveCount(0); await expect(page.locator('.services-error')).toHaveCount(0);
  await page.unroute('**/api/services?view=request&*');
  await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await expect(page.locator('.services-file a').filter({ hasText: 'saved-refresh.pdf' })).toBeVisible();
  assert.equal(await db.serviceDocument.count({ where: { requestId: autoId, name: 'saved-refresh.pdf' } }), 1);
  // Force a real server-side version conflict before UPLOAD commits.
  const docsBeforeConflict = await db.serviceDocument.count({ where: { requestId: autoId } });
  const auditBeforeConflict = await db.serviceHistory.count({ where: { requestId: autoId, action: 'UPLOAD' } });
  let conflictOnce = false;
  await page.route('**/api/services?upload=*', async route => {
    if (!conflictOnce) { conflictOnce = true; await db.serviceRequest.update({ where: { id: autoId }, data: { version: { increment: 1 } } }); }
    await route.continue();
  });
  const conflictResponse = page.waitForResponse(r => r.url().includes('upload=1'));
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'conflict.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  assert.equal((await conflictResponse).status(), 409);
  await expect(page.locator('.services-error')).toContainText('изменено');
  assert.equal(await db.serviceDocument.count({ where: { requestId: autoId } }), docsBeforeConflict);
  assert.equal(await db.serviceHistory.count({ where: { requestId: autoId, action: 'UPLOAD' } }), auditBeforeConflict);
  await page.unroute('**/api/services?upload=*');
  await page.getByRole('button', { name: 'Обновить версию, сохранив мой ввод', exact: true }).click();
  await expect(page.locator('.services-detail')).toHaveAttribute('aria-busy', 'false');
  const uploadNetwork = await page.context().newCDPSession(page);
  await uploadNetwork.send('Network.enable');
  await uploadNetwork.send('Network.emulateNetworkConditions', { offline: false, latency: 800, downloadThroughput: 10000000, uploadThroughput: 10000000 });
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'proof.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  await expect(page.locator('.services-upload-progress')).toContainText('Обрабатывается');
  await expect(page.locator('.services-upload-progress')).toHaveCount(0); await expect(page.locator('.services-success')).toContainText('Документ загружен');
  await uploadNetwork.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await uploadNetwork.detach();
  const pdfDoc = await db.serviceDocument.findFirstOrThrow({ where: { requestId: autoId, mime: 'application/pdf' } });
  const pdfDownload = await page.context().request.get(base + '/api/services?view=file&id=' + pdfDoc.id);
  assert.equal(pdfDownload.headers()['content-type'], 'application/pdf'); assert.match(pdfDownload.headers()['content-disposition'], /^attachment;/); assert((await pdfDownload.body()).equals(pdfBuffer));
  let lostUpload = false;
  await page.route('**/api/services?upload=*', async route => { if (!lostUpload) { lostUpload = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'receipt.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  await expect(page.locator('.services-upload-progress')).toContainText('Ошибка');
  assert.equal(await db.serviceDocument.count({ where: { requestId: autoId, name: 'receipt.pdf' } }), 1);
  const receiptHistory = await db.serviceHistory.count({ where: { requestId: autoId, action: 'UPLOAD' } });
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'receipt.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
  await expect(page.locator('.services-success')).toContainText('Документ загружен'); await expect(page.locator('.services-upload-progress')).toHaveCount(0);
  assert.equal(await db.serviceDocument.count({ where: { requestId: autoId, name: 'receipt.pdf' } }), 1);
  assert.equal(await db.serviceHistory.count({ where: { requestId: autoId, action: 'UPLOAD' } }), receiptHistory);
  await page.unroute('**/api/services?upload=*');
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('alert(1)') }));
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'unsafe.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) }); await expect(page.locator('.services-error')).toContainText('PDF');
  await expect(page.locator('.services-error')).toContainText('неподдерживаемое содержимое');
  const linked = await navigationPdf();
  const linkedResponse = page.waitForResponse(r => r.url().includes('upload=1'));
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'links.pdf', mimeType: 'application/pdf', buffer: linked });
  const allowed = await linkedResponse; assert.equal(allowed.status(), 200, await allowed.text());
  await expect(page.locator('.services-file a').filter({hasText:'links.pdf'})).toBeVisible(); await expect(page.locator('.services-upload-progress')).toHaveCount(0);
  const linkedDoc = await db.serviceDocument.findFirstOrThrow({where:{requestId:autoId,name:'links.pdf'}});
  const linkedDownload = await page.context().request.get(base+'/api/services?view=file&id='+linkedDoc.id);
  assert((await linkedDownload.body()).equals(linked)); assert.match(linkedDownload.headers()['content-disposition'],/^attachment;/);
  for (const width of [360,1366]) {
    await page.setViewportSize({width,height:900}); await noOverflow(page);
    await expect(page.getByText('Поддерживаемые форматы: JPG, JPEG, PNG, PDF',{exact:true})).toBeVisible();
    const section = page.locator('section').filter({has:page.getByRole('heading',{name:'Документы',exact:true})});
    await expect(section.locator('p.services-muted').first()).toHaveText('Поддерживаемые форматы: JPG, JPEG, PNG, PDF');
    await section.screenshot({path:resolve(root,'upload-formats-'+width+'.png')});
  }
  const rejectedLinks = page.waitForResponse(r => r.url().includes('upload=1'));
  await page.getByLabel(/^Загрузить:/).setInputFiles({name:'dangerous-link.pdf',mimeType:'application/pdf',buffer:await actionPdf('URI','javascript:alert(1)')});
  const deniedLink = await rejectedLinks; assert.equal(deniedLink.status(),400); const deniedBody=await deniedLink.json();
  assert.equal(deniedBody.diagnostic.stage,'VALIDATE'); assert.equal(deniedBody.diagnostic.status,400); assert(deniedBody.diagnostic.trace);
  await expect(page.locator('.services-upload-progress')).toContainText('Выберите другой файл');
  await expect(page.locator('.services-upload-progress')).not.toContainText(/VALIDATE|HTTP|[0-9a-f]{8}-[0-9a-f-]{27}/i);
  await expect(page.locator('.services-error')).not.toContainText(/VALIDATE|HTTP|[0-9a-f]{8}-[0-9a-f-]{27}/i);
  const jpeg = await sharp(png).jpeg().toBuffer();
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg }); await expect(page.locator('.services-upload-progress')).toHaveCount(0); await expect(page.locator('.services-success')).toContainText('Документ загружен');
  const largePdf = await PDFDocument.create(), largePage = largePdf.addPage([200, 200]);
  largePage.node.set(PDFName.of('Contents'), largePdf.context.register(largePdf.context.stream(Buffer.alloc(19 * 1024 * 1024, 32))));
  const slowUpload = await page.context().newCDPSession(page);
  await slowUpload.send('Network.enable');
  await slowUpload.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 10000000, uploadThroughput: 4000000 });
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await largePdf.save({ useObjectStreams: false })) });
  await expect.poll(async () => Number(await page.getByRole('progressbar', { name: 'Прогресс загрузки' }).getAttribute('value'))).toBeGreaterThan(0);
  assert(Number(await page.getByRole('progressbar', { name: 'Прогресс загрузки' }).getAttribute('value')) < 100);
  await expect(page.locator('.services-upload-progress')).toHaveCount(0, { timeout: 15000 }); await expect(page.locator('.services-file a').filter({ hasText: 'large.pdf' })).toBeVisible();
  await slowUpload.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await slowUpload.detach();
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'too-large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await expect(page.locator('.services-error')).toContainText('20 МиБ');
  await expect(page.locator('.services-upload-progress')).toContainText('PDF слишком большой. Допустимый размер — 20 МиБ. Выберите другой файл.');
  const oversizeVersion = (await db.serviceRequest.findUniqueOrThrow({ where: { id: autoId } })).version;
  const oversizeResponse = await page.context().request.post(base + '/api/services?' + new URLSearchParams({ upload: '1', id: autoId, version: String(oversizeVersion), requestId: crypto.randomUUID(), slot: 'attachment', kind: 'STUDENT' }), { headers: { Origin: base, 'Content-Type': 'application/pdf', 'X-File-Name': 'oversize.pdf' }, data: Buffer.alloc(20 * 1024 * 1024 + 1) });
  assert.equal(oversizeResponse.status(), 413);
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'spoof.pdf', mimeType: 'image/png', buffer: pdfBuffer }); await expect(page.locator('.services-error')).toContainText('Тип файла');
  await page.route('**/api/services?upload=*', route => route.abort());
  await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'interrupted.png', mimeType: 'image/png', buffer: png }); await expect(page.locator('.services-upload-progress')).toContainText('Ошибка');
  await page.unroute('**/api/services?upload=*'); await page.getByLabel(/^Загрузить:/).setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: png }); await expect(page.locator('.services-upload-progress')).toHaveCount(0); await expect(page.locator('.services-success')).toContainText('Документ загружен');
  await page.setViewportSize({ width: 360, height: 800 }); await noOverflow(page); await page.screenshot({ path: resolve(root, 'upload-360.png'), fullPage: true }); await page.setViewportSize({ width: 1366, height: 900 });
  await field(reopened, 'Тема', 'Изменения в конкурирующей вкладке');
  await expect(reopened.locator('.services-error')).toContainText('изменено');
  assert.notEqual(JSON.parse((await db.serviceRequest.findUniqueOrThrow({ where: { id: autoId } })).fieldsJson).subject, 'Изменения в конкурирующей вкладке');
  await reopened.close();
  // Latest keystroke is saved before submit, without a second catalogue warning.
  await page.getByLabel('Подтверждаю актуальность показанных официальных данных').check();
  await field(page, 'Тема', 'Последний ввод перед отправкой'); await page.getByRole('button', { name: 'Отправить заявление', exact: true }).click();
  await expect(page.locator('.services-request-heading .services-status')).toHaveText('Подано'); await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal(JSON.parse((await db.serviceRequest.findUniqueOrThrow({ where: { id: autoId } })).fieldsJson).subject, 'Последний ввод перед отправкой');
  pass('Autosave queue, reload/closed tab/other session, immediate navigation/submit, offline emergency recovery, real XHR progress, PDF/JPEG and direct appeal submission without modal');
  // Legacy autosaves remain in audit but cannot consume visible history pages.
  assert(await db.serviceHistory.count({ where: { requestId: autoId, action: 'SAVE' } }) > 0);
  await db.serviceHistory.createMany({ data: Array.from({ length: 180 }, (_, i) => ({ requestId: autoId, actorId: student.id, actorName: student.name, action: i % 3 ? 'SAVE' : 'COMMENT', text: i % 3 ? null : 'Историческое сообщение ' + i, createdAt: new Date(Date.now() + i + 1) })) });
  const audit = await db.serviceHistory.findMany({ where: { requestId: autoId }, orderBy: { id: 'asc' } });
  const meaningful = audit.filter(row => row.action !== 'SAVE');
  await page.reload(); await waitDetail(page);
  await expect(page.locator('.services-history > li')).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё историю', exact: true }).click();
  await expect(page.locator('.services-history > li')).toHaveCount(meaningful.length);
  await expect(page.getByRole('button', { name: 'Показать ещё историю', exact: true })).toHaveCount(0);
  await expect(page.locator('.services-history')).not.toContainText('Сохранены поля');
  assert.deepEqual(await db.serviceHistory.findMany({ where: { requestId: autoId }, orderBy: { id: 'asc' } }), audit);
  pass('Legacy history pagination and multiple autosaves: only meaningful events visible, full audit unchanged');
  await page.goto(base + '/dashboard/services?service=deanery-appeal'); await page.getByRole('button', { name: 'Создать черновик' }).click(); await waitDetail(page); const deletedId = new URL(page.url()).searchParams.get('requestId');
  let deletionSave = false;
  await page.route('**/api/services', async route => { if (route.request().method() === 'POST' && route.request().postDataJSON()?.operation === 'SAVE') { deletionSave = true; await new Promise(r => setTimeout(r, 1000)); } await route.continue(); });
  await field(page, 'Тема', 'Удаление при ожидающем сохранении'); await expect.poll(() => deletionSave).toBe(true);
  await page.getByRole('button', { name: 'Удалить черновик', exact: true }).click(); await page.getByRole('button', { name: 'Да, удалить', exact: true }).click(); await expect(page.locator('.services-tabs button[aria-current=page]')).toHaveText('Черновики'); assert((await db.serviceRequest.findUniqueOrThrow({ where: { id: deletedId } })).deletedAt); await page.unroute('**/api/services'); await new Promise(r => setTimeout(r, 1000)); assert.equal((await page.context().request.get(base + '/api/services?view=request&id=' + deletedId, { maxRetries: 2 })).status(), 404);
  await page.goto(base + '/dashboard/profile'); await expect(page.locator('.services-military')).toContainText('Сведения не предоставлены');
  for (const width of [360, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/dashboard/profile'); await page.locator('.services-military a').click();
    await expect(page).toHaveURL(base + '/dashboard/services?service=military-change');
    await expect(page.locator('.services-notice')).toContainText('ручной проверки');
    await expect(page.getByRole('button', { name: 'Создать черновик' })).toBeEnabled();
    assert.equal(await db.militaryRecord.count({ where: { userId: student.id } }), 0);
  }
  await db.militaryRecord.create({ data: { userId: student.id, departmentId, office: 'Тестовый военкомат', documentType: 'Тестовый документ', registrationStatus: 'REQUIRED', verifiedAt: new Date() } });
  for (const width of [360, 1366]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(base + '/dashboard/profile');
    await expect(page.locator('.services-military')).toContainText('Тестовый военкомат'); assert.equal(await page.locator('.services-military input').count(), 0);
    await page.locator('.services-military a').click(); await expect(page).toHaveURL(base + '/dashboard/services?service=military-change');
  }
  await page.goto(base + '/dashboard/profile');
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
  await db.studentProfile.update({ where: { userId: student.id }, data: { gender: 'FEMALE' } });
  await db.militaryRecord.update({ where: { userId: student.id }, data: { registrationStatus: 'NOT_REQUIRED', verifiedAt: new Date() } });
  await page.goto(base + '/dashboard/profile'); await expect(page.locator('.services-military')).toContainText('Воинский учёт для вас не требуется'); await expect(page.locator('.services-military a')).toHaveCount(0);
  await page.goto(base + '/dashboard/services?service=military-change'); await expect(page.getByRole('button', { name: 'Создать черновик' })).toHaveCount(0);
  const blockedMilitary = await page.context().request.post(base + '/api/services', { headers: { Origin: base }, data: { operation: 'CREATE', code: 'military-change', requestId: crypto.randomUUID() } }); assert.equal(blockedMilitary.status(), 403);
  const oldMilitary = await db.serviceRequest.findFirstOrThrow({ where: { ownerId: student.id, serviceCode: 'military-change' } });
  await page.goto(base + '/dashboard/services?requestId=' + oldMilitary.id); await waitDetail(page); await expect(page.locator('.services-fields textarea')).toHaveCount(0);
  assert.equal((await page.context().request.get(base + '/api/services?view=request&id=' + oldMilitary.id)).status(), 200);
  await db.militaryRecord.update({ where: { userId: student.id }, data: { registrationStatus: null, verifiedAt: null } });
  await page.goto(base + '/dashboard/profile'); await expect(page.locator('.services-military a')).toHaveAttribute('href', '/dashboard/services?service=military-change');
  await db.militaryRecord.update({ where: { userId: student.id }, data: { registrationStatus: 'REQUIRED: подтверждённая ВУС', verifiedAt: new Date() } });
  await page.goto(base + '/dashboard/services?service=military-change'); await expect(page.getByRole('button', { name: 'Создать черновик' })).toBeEnabled();
  pass('Military exemption in profile/catalogue/API, historical access, unknown clarification and female verified specialty');
  const exitSession = await signed(student.email);
  await exitSession.page.goto(base + '/dashboard/services?service=deanery-appeal'); await exitSession.page.getByRole('button', { name: 'Создать черновик', exact: true }).click(); await waitDetail(exitSession.page);
  const logoutDraftUrl = exitSession.page.url(), logoutDraftId = new URL(logoutDraftUrl).searchParams.get('requestId');
  await field(exitSession.page, 'Тема', 'Ввод непосредственно перед выходом'); await exitSession.page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).first().click(); await expect(exitSession.page).toHaveURL(base + '/login');
  assert.equal(JSON.parse((await db.serviceRequest.findUniqueOrThrow({ where: { id: logoutDraftId } })).fieldsJson).subject, 'Ввод непосредственно перед выходом');
  assert.equal(await exitSession.page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('services-recovery:')).length), 0);
  assert.equal((await exitSession.context.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: student.email, password } })).status(), 200);
  await exitSession.page.goto(logoutDraftUrl); await waitDetail(exitSession.page); await expect(exitSession.page.getByLabel(/^Тема/)).toHaveValue('Ввод непосредственно перед выходом');
  pass('Immediate logout flushes pending fields, clears emergency copies and restores server draft after new login');
  await db.serviceGrant.updateMany({ where: { userId: dean.id }, data: { active: false } }); await staff.goto(base + '/deanery/requests?requestId=' + id); await expect(staff.locator('.services-error')).toContainText('недоступно');
  pass('Draft deletion, read-only real/absent military record, foreign applications/documents and revoked staff access');
  await verifyImagePreparation({ page, db, student, base, root });
  pass('Automatic image preparation: 24 Mp, EXIF, alpha, text, memory/corrupt/oversize failures, idempotent retry and server bypass denial');
  // List deletion, including the only row on the last page of legacy drafts.
  const bulkConfig = serviceCatalog[0];
  const existingDrafts = await db.serviceRequest.count({ where: { ownerId: student.id, serviceCode: bulkConfig.code, status: 'DRAFT', deletedAt: null } });
  await db.serviceRequest.createMany({ data: Array.from({ length: 51 - existingDrafts }, () => ({ ownerId: student.id, serviceCode: bulkConfig.code, schemaVersion: bulkConfig.version, category: bulkConfig.category, fieldsJson: '{}' })) });
  await page.goto(base + '/dashboard/services?tab=drafts');
  await page.locator('.services-filters select').selectOption(bulkConfig.code);
  await expect(page.locator('.services-pagination')).toContainText('Всего: 51');
  await page.getByRole('button', { name: 'Далее →', exact: true }).click();
  await expect(page.locator('.services-request-row')).toHaveCount(1);
  const listUrl = page.url(), onlyRow = page.locator('.services-list-item');
  const targetId = new URL(await onlyRow.locator('a').getAttribute('href'), base).searchParams.get('requestId');
  await page.setViewportSize({ width: 360, height: 800 }); await noOverflow(page);
  await onlyRow.getByRole('button', { name: 'Удалить черновик', exact: true }).click();
  await expect(page).toHaveURL(listUrl);
  await page.screenshot({ path: resolve(root, 'delete-draft-360.png'), fullPage: true });
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('.services-list-confirm')).toHaveCount(0);
  await page.route('**/api/services', async route => {
    if (route.request().postDataJSON()?.operation === 'DELETE') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Пробный отказ удаления' }) }); else await route.continue();
  });
  await onlyRow.getByRole('button', { name: 'Удалить черновик', exact: true }).click();
  await page.getByRole('button', { name: 'Да, удалить', exact: true }).click();
  await expect(page.locator('.services-error')).toContainText('Пробный отказ');
  await expect(page.locator('.services-request-row')).toHaveCount(1); assert.equal((await db.serviceRequest.findUniqueOrThrow({ where: { id: targetId } })).deletedAt, null);
  await page.unroute('**/api/services');
  await db.serviceRequest.update({ where: { id: targetId }, data: { version: { increment: 1 } } });
  await page.getByRole('button', { name: 'Да, удалить', exact: true }).click();
  await expect(page.locator('.services-error')).toContainText('изменено');
  await expect(page.locator('.services-request-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.locator('.services-error')).toHaveCount(0);
  let deleteWrites = 0;
  await page.route('**/api/services', async route => { if (route.request().postDataJSON()?.operation === 'DELETE') { deleteWrites++; await new Promise(r => setTimeout(r, 400)); } await route.continue(); });
  await page.getByRole('button', { name: 'Да, удалить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Удаляем…', exact: true })).toBeDisabled();
  await expect(page.locator('.services-pagination')).toContainText('Страница 1 · Всего: 50');
  await expect(page.locator('.services-request-row')).toHaveCount(50); assert.equal(deleteWrites, 1);
  assert((await db.serviceRequest.findUniqueOrThrow({ where: { id: targetId } })).deletedAt);
  await page.unroute('**/api/services');
  const deletedSave = await page.context().request.post(base + '/api/services', { headers: { Origin: base }, data: { operation: 'SAVE', id: targetId, version: 1, fields: {}, requestId: crypto.randomUUID() } }); assert.equal(deletedSave.status(), 404);
  await page.setViewportSize({ width: 1366, height: 900 }); await noOverflow(page);
  await page.screenshot({ path: resolve(root, 'drafts-1366.png'), fullPage: true });
  await page.goto(base + '/dashboard/services?tab=requests'); await expect(page.locator('.services-request-row').first()).toBeVisible(); await expect(page.getByRole('button', { name: 'Удалить черновик', exact: true })).toHaveCount(0);
  pass('Draft list: inline confirmation/cancel, failed DELETE and 409 preserved, one write, last-page counter correction, 360/1366px, deleted SAVE denied');
  await otherDevice.page.goto(base + '/dashboard/services'); await expect(otherDevice.page.locator('.services-category')).toHaveCount(4); await noOverflow(otherDevice.page); await otherDevice.page.screenshot({ path: resolve(root, 'catalog-360.png'), fullPage: true });
  assert.deepEqual(diagnostics, []); pass('360px/1366px layouts, no horizontal overflow and no React/hydration/navigation diagnostics');
  const inspect = createClient({ url: env.DATABASE_URL }); await integrity(inspect); inspect.close(); assert.equal(await fingerprint(source), before, 'Main database modified');
  writeFileSync(resolve(root, 'results.json'), JSON.stringify({ passed: results, diagnostics, mainDatabaseUnchanged: true }, null, 2), { mode: 0o600 }); console.info('Services UI report: ' + root);
} catch (e) { if (browser) { const pages = browser.contexts().flatMap(c => c.pages()); for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: resolve(root, 'failure-' + i + '.png'), fullPage: true }).catch(() => {}); } throw e; }
finally { if (browser) await browser.close(); if (child && child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } await db.$disconnect(); source.close(); }
