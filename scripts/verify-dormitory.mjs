import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createClient } from '@libsql/client';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import sharp from 'sharp';
import { demoAccounts } from '../src/lib/demo-accounts.ts';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { executeDormCommand } from '../src/lib/dormitory-command.ts';
import { dormDocumentScope, dormRepairScope } from '../src/lib/dormitory-access.ts';
import { getDormStaffContext, getOwnDormitory } from '../src/lib/dormitory-queries.ts';
import { chargeBalance } from '../src/lib/dormitory-money.ts';
import { openBed } from '../src/lib/dormitory-state.ts';
import { emitDormitoryPaymentReminders } from '../src/lib/dormitory-reminders.ts';
import { localServiceStorage, prepareServiceFile } from '../src/lib/services-storage.ts';
import { executeServiceCommand, profileFor, seedServices } from '../src/lib/services-repository.ts';
import { configFor } from '../src/lib/services-catalog.ts';
import { publishAnnouncement } from '../src/lib/announcements.ts';
import { studentNewsScope } from '../src/lib/news-repository.ts';
import { listNotifications } from '../src/lib/notifications-repository.ts';
import { executeClearanceCommand, clearanceDetail } from '../src/lib/clearance-repository.ts';
import { configureClearance, fixtureActor } from './clearance-fixture.mjs';
import { fingerprint, integrity } from './database-snapshot.mjs';
import { provisionTestDatabase } from './test-fixtures.mjs';

const demo = process.argv.includes('--demo'), browserMode = process.argv.includes('--browser');
mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/dormitory-' + (demo ? 'demo-' : 'test-')));
const source = createClient({ url: getDatabaseUrl() }), before = await fingerprint(source);
const env = provisionTestDatabase(resolve(root, 'test.db'));
assert.notEqual(getDatabaseUrl(env.DATABASE_URL), getDatabaseUrl(), 'Fixture database must differ from the source');
process.env.DATABASE_URL = env.DATABASE_URL;
if (browserMode) {
  const fixtureJournal = createClient({ url: env.DATABASE_URL });
  try { await fixtureJournal.execute('PRAGMA journal_mode = WAL'); }
  finally { fixtureJournal.close(); }
}
const db = createPrismaClient();
const storage = resolve(root, 'files');
const day = add => new Date(Date.now() + add * 86400000).toISOString().slice(0, 10);
const run = (actor, action, fields = {}, key = randomUUID()) => executeDormCommand(db, actor, { action, key, fields });
const service = (actor, operation, data) => executeServiceCommand(db, actor, { operation, requestId: randomUUID(), ...data });
const results = [];
const pass = message => { console.info('PASS: ' + message); results.push(message); };

let child, browser, base, serverLog = '';
const browserErrors = [];
async function startServer() {
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  base = 'http://127.0.0.1:' + port;
  const project = demo ? resolve(root, 'project') : resolve('.');
  if (demo) {
    mkdirSync(project);
    for (const folder of ['src', 'public']) cpSync(folder, resolve(project, folder), { recursive: true });
    for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', '.gitignore']) cpSync(file, resolve(project, file));
    const workspace = JSON.stringify(resolve('.').replaceAll('\\', '/'));
    writeFileSync(resolve(project, 'next.config.ts'), readFileSync('next.config.ts', 'utf8').replace('turbopack: {', 'turbopack: { root: ' + workspace + ','));
    symlinkSync(resolve('node_modules'), resolve(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', demo ? 'dev' : 'start', project, '--hostname', '127.0.0.1', '--port', String(port)], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...env, NODE_ENV: demo ? 'development' : 'production', BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      AUTH_TRUST_PROXY: 'false', AUTH_PROXY_SECRET: '', NEXT_TELEMETRY_DISABLED: '1', SERVICES_STORAGE_DIR: storage,
    },
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { serverLog += data; });
  for (let attempt = 0; attempt < 80; attempt++) {
    assert.equal(child.exitCode, null, 'Server exited. See ' + resolve(root, 'server.log'));
    try { if ((await fetch(base + '/api/auth/get-session', { signal: AbortSignal.timeout(5000) })).ok) return; } catch { /* startup */ }
    await new Promise(done => setTimeout(done, 300));
  }
  throw new Error('Isolated server unavailable.');
}

try {
  const [student, roommate, admin, teacher, tech, dean] = await Promise.all(demoAccounts.map(account => db.user.findUniqueOrThrow({ where: { email: account.email } })));
  const actors = new Map();
  const passwords = new Map(demoAccounts.map(account => [account.email, env[account.passwordEnv]]));
  const outsiderEmail = 'dormitory.outside@example.test';
  const outsiderPassword = randomBytes(24).toString('base64url');
  const outsider = await db.user.create({ data: {
    name: 'Татьяна Морозова', email: outsiderEmail, role: 'STUDENT', studentProfile: { create: { groupId: (await db.studentProfile.findUniqueOrThrow({ where: { userId: student.id } })).groupId } },
  } });
  await db.account.create({ data: { userId: outsider.id, accountId: outsider.id, providerId: 'credential', password: await hashPassword(outsiderPassword) } });
  passwords.set(outsiderEmail, outsiderPassword);
  for (const user of [student, roommate, outsider, admin, tech, dean, teacher]) actors.set(user.id, await fixtureActor(db, user.id));
  const actor = user => actors.get(user.id);
  const manage = (action, fields) => run(actor(admin), action, fields);
  const residentData = user => getOwnDormitory(db, user);
  const serviceDepartments = new Set();
  await seedServices(db);
  for (const user of [student, roommate, outsider]) {
    const p = await db.studentProfile.findUniqueOrThrow({ where: { userId: user.id }, include: { group: true } });
    assert(p.group?.departmentId);
    serviceDepartments.add(p.group.departmentId);
  }
  for (const departmentId of serviceDepartments) {
    await db.deaneryDepartmentAssignment.upsert({ where: { userId_departmentId: { userId: dean.id, departmentId } }, create: { userId: dean.id, departmentId }, update: {} });
    for (const serviceCode of ['dorm-move-in', 'dorm-transfer']) {
      await db.serviceRoute.create({ data: { serviceCode, sourceDepartmentId: departmentId, departmentId } });
      await db.serviceGrant.create({ data: { userId: dean.id, departmentId, serviceCode } });
    }
  }
  async function application(user, code = 'dorm-move-in') {
    let request = await service(actor(user), 'CREATE', { code, fields: { reason: 'Демонстрационное основание' } });
    const profile = await profileFor(db, user.id, configFor(code));
    request = await service(actor(user), 'SUBMIT', { ...request, confirmed: true, confirmationHash: profile.hash });
    for (const status of ['IN_REVIEW', 'IN_PROGRESS', 'COMPLETED']) {
      request = await service(actor(dean), 'TRANSITION', { ...request, status, text: 'Проверено деканатом' });
    }
    return request.id;
  }
  const createDorm = async (name, address, contacts = 'Комендант, приёмная 101') =>
    (await manage('DORM_CREATE', { name, address, contacts })).id;
  const campusA = await createDorm('Учебное общежитие A', 'Университетская, 1', '+7 (495) 123-45-67');
  const campusB = await createDorm('Учебное общежитие B', 'Университетская, 2');
  const room = async (dormitoryId, number, floor, capacity, building = '') => (await manage('ROOM_CREATE', {
    dormitoryId, number, floor, capacity, building, block: number === '201' ? 'А' : '', type: 'Жилая',
  })).id;
  const sharedRoom = await room(campusA, '201', '2', '3', 'Северный');
  const otherRoom = await room(campusA, '301', '3', '1', 'Северный');
  const transferRoom = await room(campusB, '101', '1', '2');
  const bedRows = async roomId => db.dormBed.findMany({ where: { roomId }, orderBy: { number: 'asc' } });
  const [first, second, blocked] = await bedRows(sharedRoom);
  const [sameDorm] = await bedRows(otherRoom);
  const [foreignBed, transferBed] = await bedRows(transferRoom);
  await manage('BED_STATE', { id: blocked.id, state: 'unavailable' });
  await manage('GRANT', { dormitoryId: campusA, userId: tech.id, permission: 'TECHNICIAN', state: 'enable' });
  const reserve = async (requestId, bedId) => manage('RESERVE', { requestId, bedId, hours: '72', endsOn: day(180) });
  const place = async (requestId, bedId) => {
    const { id } = await reserve(requestId, bedId);
    await manage('CHECK_IN', { id });
    return id;
  };
  const roommateRequest = await application(roommate), foreignRequest = await application(outsider);
  await place(foreignRequest, foreignBed.id);
  const departments = await configureClearance(db);
  await db.clearanceGrant.createMany({ data: departments.filter(department => ['dormitory', 'library', 'accounting', 'academic', 'access'].includes(department.code))
    .map(department => ({ userId: tech.id, departmentId: department.id })) });
  if (demo) {
    await place(roommateRequest, second.id);
    await manage('DORM_EDIT', { dormitoryId: campusA, paymentUrl: 'https://example.com/' });
    await startServer();
    writeFileSync(resolve(root, 'accounts.json'), JSON.stringify([...passwords].map(([email, password]) => ({ email, password })), null, 2), { mode: 0o600 });
    console.info('Демо: ' + base);
    console.info('Временные учётные данные: ' + resolve(root, 'accounts.json'));
    if (!process.argv.includes('--smoke')) await once(child, 'exit');
  } else {
    await assert.rejects(() => run(actor(teacher), 'DORM_CREATE', { name: 'Запрещено', address: 'Тест' }), { status: 403 });
    await assert.rejects(() => run(actor(dean), 'DORM_CREATE', { name: 'Запрещено', address: 'Тест' }), { status: 403 });
    await assert.rejects(() => run({ id: admin.id, sessionId: 'invalid' }, 'DORM_CREATE', { name: 'Запрещено', address: 'Тест' }), { status: 401 });
    assert.equal((await getDormStaffContext(db, tech, campusB, 'finance', '', 0, '')).dorm, undefined);
    const applicant = await application(student);
    assert.equal((await residentData(student)).resident, null);
    assert.equal((await residentData(student)).decisions[0].status, 'COMPLETED');
    assert.equal(await db.dormBed.count({ where: { roomId: sharedRoom, ...openBed(new Date()) } }), 2);
    await assert.rejects(() => reserve(applicant, blocked.id), { status: 409 });
    const race = await Promise.allSettled([reserve(applicant, first.id), reserve(roommateRequest, first.id)]);
    assert.equal(race.filter(item => item.status === 'fulfilled').length, 1);
    const reserved = race.find(item => item.status === 'fulfilled').value;
    assert.equal(await db.dormPlacement.count({ where: { bedId: first.id, status: 'RESERVED' } }), 1);
    await manage('RESERVE_CANCEL', { id: reserved.id, reason: 'Проверка отмены' });
    const expired = await reserve(applicant, first.id);
    await db.dormPlacement.update({ where: { id: expired.id }, data: { reservedUntil: new Date(Date.now() - 1000) } });
    await assert.rejects(() => manage('CHECK_IN', { id: expired.id }), /истёк/);
    const placement = await place(applicant, first.id);
    assert.equal((await db.dormPlacement.findUniqueOrThrow({ where: { id: expired.id } })).status, 'EXPIRED');
    await place(roommateRequest, second.id);
    await assert.rejects(() => reserve(applicant, first.id), { status: 409 });
    assert.equal(await db.dormPlacement.count({ where: { bed: { roomId: sharedRoom }, status: 'ACTIVE' } }), 2);
    assert.equal(await db.dormPlacement.count({ where: { id: placement, status: 'ACTIVE' } }), 1);
    await assert.rejects(() => manage('ROOM_STATE', { id: sharedRoom, state: 'archive' }), { status: 409 });
    pass('Housing services, capacity, concurrent reserve, cancellation, authorization and check-in');

    const billing = { id: placement, basis: 'Проживание', from: day(0), to: day(30), dueOn: day(3) };
    for (const amountRub of ['', '-1', '0', '1,001', 'text', '21474836.48']) {
      await assert.rejects(() => manage('CHARGE', { ...billing, amountRub }), { status: 400 });
    }
    const { id: chargeId } = await manage('CHARGE', { ...billing, amountRub: '1950,50' });
    await manage('LEDGER', { id: chargeId, kind: 'PAYMENT', reference: 'Учебный документ 1', amountRub: '450.25' });
    const charge = await db.dormCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { entries: true } });
    assert.equal(charge.amountRub, '1950.50');
    assert.equal(charge.entries[0].amountRub, '450.25');
    assert.equal(chargeBalance(charge), 150025n);
    const { id: credit } = await manage('CHARGE', { ...billing, basis: 'Проверка переплаты', amountRub: '1' });
    await manage('LEDGER', { id: credit, kind: 'ADJUSTMENT', reference: 'Уменьшение', amountRub: '-0,25' });
    await manage('LEDGER', { id: credit, kind: 'PAYMENT', reference: 'Переплата', amountRub: '0.85' });
    await assert.rejects(() => manage('LEDGER', { id: credit, kind: 'ADJUSTMENT', reference: 'За пределами', amountRub: '-21474836.47' }), { status: 400 });
    const reopened = (await residentData(student)).payments.find(item => item.id === credit);
    assert.equal(reopened.entries.find(entry => entry.kind === 'ADJUSTMENT').amountRub, '-0.25');
    assert.equal(chargeBalance(reopened), -10n);
    assert.equal((await residentData(student)).next.dueOn.toISOString().slice(0, 10), day(3));
    assert.equal((await residentData(roommate)).payments.length, 0);
    await assert.rejects(() => run(actor(student), 'LEDGER', { id: chargeId, kind: 'PAYMENT', amountRub: '1', reference: 'Запрещено' }), { status: 403 });
    await assert.rejects(() => manage('DORM_EDIT', { dormitoryId: campusA, paymentUrl: 'javascript:alert(1)' }), /HTTPS/);
    await manage('DORM_EDIT', { dormitoryId: campusA, paymentUrl: 'https://example.com/' });
    assert.equal(await emitDormitoryPaymentReminders(db, 5), 1);
    assert.equal(await emitDormitoryPaymentReminders(db, 5), 0);
    assert.equal(await emitDormitoryPaymentReminders(db, 5, new Date(day(7))), 1);
    pass('Integer amounts, partial payment, dated debt, idempotent reminders and isolated financial access');

    let contexts, page;
    const image = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#435549' } }).png().toBuffer();
    if (browserMode) {
      await startServer();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
      contexts = new Map();
      for (const user of [student, roommate, outsider, admin, tech, dean, teacher]) {
        const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
        const signed = await context.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: user.email, password: passwords.get(user.email) } });
        assert.equal(signed.status(), 200);
        contexts.set(user.id, context);
      }
      page = await contexts.get(student.id).newPage();
      const warning = /Blocking Route|Instant validation|unstable value|uncached data during/;
      page.on('pageerror', error => browserErrors.push(error.message));
      page.on('console', message => { if (warning.test(message.text())) browserErrors.push(message.text()); });
      await page.goto(base + '/dashboard/dormitory');
      await expect(page.getByRole('heading', { name: 'Общежитие', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Разделы общежития' })).toHaveCount(0);
      await expect(page.locator('.dorm-metrics')).toContainText('Рабочий телефон коменданта');
      await expect(page.locator('#living')).toContainText('Предыдущих размещений нет.');
      await expect(page.getByRole('link', { name: 'Подать заявление на переселение' })).toHaveAttribute('href', '/dashboard/services?service=dorm-transfer');
      await expect(page.getByRole('link', { name: '+7 (495) 123-45-67' })).toHaveAttribute('href', 'tel:+74951234567');
      await expect(page.locator('.dorm-metrics')).toContainText('Оплатить до');
      await expect(page.locator('.dorm-metrics')).toContainText('1 500,25 ₽');
      await expect(page.locator('#payments')).toContainText('Переплата 0,10 ₽');
      await expect(page.getByRole('link', { name: 'Оплатить', exact: true })).toHaveAttribute('href', 'https://example.com/');
      await contexts.get(student.id).route('https://example.com/', route => route.fulfill({ contentType: 'text/plain; charset=utf-8', body: 'Учебная страница оплаты' }));
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('link', { name: 'Оплатить', exact: true }).click();
      const popup = await popupPromise;
      await expect(popup.locator('body')).toContainText('Учебная страница оплаты');
      await popup.close();
      assert.equal(await db.dormLedgerEntry.count({ where: { chargeId } }), 1);
      const financePage = await contexts.get(admin.id).newPage();
      await financePage.goto(base + '/admin/dormitory?dorm=' + campusA + '&tab=finance');
      const create = financePage.locator('form').filter({ has: financePage.getByRole('button', { name: 'Создать начисление' }) });
      await create.getByLabel('Запись проживания').selectOption(placement);
      await create.getByLabel('Основание').fill('Проверка ввода в рублях');
      await create.getByLabel('Сумма, ₽').fill('10,50');
      await create.getByLabel('Начало периода').fill(day(0));
      await create.getByLabel('Конец периода').fill(day(30));
      await create.getByLabel('Оплатить до').fill(day(4));
      await create.getByRole('button', { name: 'Создать начисление' }).click();
      const record = financePage.locator('article').filter({ hasText: 'Проверка ввода в рублях' });
      await expect(record).toContainText('Остаток 10,50 ₽');
      await record.getByText('Подтвердить оплату или внести корректировку').click();
      await record.getByLabel('Вид операции').selectOption('PAYMENT');
      await record.getByLabel('Сумма, ₽').fill('10.50');
      await record.getByLabel('Подтверждающий документ или основание').fill('Контрольный документ');
      await record.getByRole('button', { name: 'Подтвердить операцию' }).click();
      await expect(record).toContainText('Остаток 0 ₽');
      await financePage.reload();
      await expect(record).toContainText('Остаток 0 ₽');
      const repairFormToggle = page.getByText('Сообщить о неисправности', { exact: true });
      await repairFormToggle.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('details.dorm-disclosure')).toHaveAttribute('open', '');
      const form = page.locator('#repairs .dorm-form').filter({ has: page.getByRole('button', { name: 'Подать заявку' }) });
      await form.getByLabel('Категория').selectOption('APPLIANCE');
      await form.getByLabel('Заголовок').fill('Не работает холодильник');
      await form.getByLabel('Описание').fill('Не охлаждает <тест>');
      await form.getByRole('button', { name: 'Подать заявку' }).click();
      await expect(page.getByRole('heading', { name: 'Не работает холодильник · Новая' })).toBeVisible();
      const details = page.locator('#repairs article').filter({ hasText: 'Не работает холодильник' });
      await details.getByText('История и действия', { exact: true }).click();
      await details.getByLabel('Фото неисправности').setInputFiles({ name: 'repair.png', mimeType: 'image/png', buffer: image });
      await details.getByRole('button', { name: 'Прикрепить фото' }).click();
      await expect(details.getByRole('link', { name: 'repair.png' })).toBeVisible();
      await page.screenshot({ path: resolve(root, 'student-repair-form.png'), fullPage: true });
      await details.getByText('История и действия', { exact: true }).click();
      await page.getByText('Сообщить о неисправности', { exact: true }).click();
      for (const theme of ['light', 'dark']) for (const width of [346, 360, 390, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        if (await page.locator('html').getAttribute('data-theme') !== theme) {
          await page.locator('.theme-toggle').click();
          await page.getByRole('menuitemradio', { name: theme === 'light' ? 'Светлая' : 'Тёмная', exact: true }).click();
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow in ${theme} at ${width}`);
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
        await page.screenshot({ path: resolve(root, `student-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      }
      await page.goto(base + '/dashboard/profile');
      await expect(page.locator('.student-profile')).toContainText('Учебное общежитие A');
    } else await run(actor(student), 'REPAIR_CREATE', { category: 'APPLIANCE', title: 'Не работает холодильник', description: 'Не охлаждает <тест>' });
    const repair = await db.dormRepair.findFirstOrThrow({ where: { roomId: sharedRoom } });
    const photo = await db.dormFile.findFirst({ where: { repairId: repair.id } });
    const getRepair = () => db.dormRepair.findUniqueOrThrow({ where: { id: repair.id } });
    const transition = async (user, status, fields = {}) => run(actor(user), 'REPAIR_TRANSITION', { id: repair.id, version: String((await getRepair()).version), status, ...fields });
    assert((await residentData(roommate)).repairs.some(item => item.id === repair.id));
    assert.equal((await residentData(outsider)).repairs.length, 0);
    await assert.rejects(() => run(actor(roommate), 'REPAIR_CREATE', { category: 'APPLIANCE', title: 'Не работает холодильник', description: 'Не охлаждает <тест>' }), { status: 409 });
    await run(actor(roommate), 'REPAIR_CREATE', { category: 'ELECTRICITY', title: 'Розетка', description: 'Нет питания' });
    await assert.rejects(() => transition(outsider, 'CLOSED'), { status: 404 });
    let employeeRepairs;
    if (contexts) {
      employeeRepairs = await contexts.get(admin.id).newPage();
      await employeeRepairs.goto(base + '/admin/dormitory?dorm=' + campusA + '&tab=repairs');
      const chosen = employeeRepairs.locator('#repair-' + repair.id);
      await chosen.getByText('История и действия', { exact: true }).click();
      await chosen.getByRole('button', { name: 'Принять заявку' }).click();
      await expect(chosen.getByRole('heading')).toContainText('Принята');
    } else await transition(admin, 'ACCEPTED');
    await run(actor(admin), 'REPAIR_COMMENT', { id: repair.id, version: String((await getRepair()).version), message: 'Служебно', staffOnly: 'on' });
    assert(!(await residentData(roommate)).repairs[0].events.some(event => event.staffOnly));
    if (employeeRepairs) {
      await employeeRepairs.reload();
      const chosen = employeeRepairs.locator('#repair-' + repair.id);
      await chosen.getByText('История и действия', { exact: true }).click();
      await chosen.getByLabel('Исполнитель').selectOption(tech.id);
      await chosen.getByLabel('Срок выполнения').fill(day(2));
      await chosen.getByRole('button', { name: 'Назначить исполнителя' }).click();
      await expect(chosen.getByRole('heading')).toContainText('Назначен исполнитель');
    } else await transition(admin, 'ASSIGNED', { assigneeId: tech.id, dueOn: day(2) });
    assert.equal(await db.dormRepair.count({ where: dormRepairScope(tech) }), 1);
    if (contexts) {
      const technical = await contexts.get(tech.id).newPage();
      await technical.goto(base + '/staff/dormitory?dorm=' + campusA + '&tab=repairs');
      const task = technical.locator('#repair-' + repair.id);
      await task.getByText('История и действия', { exact: true }).click();
      await task.getByRole('button', { name: 'Начать работу' }).click();
      await expect(task.getByRole('heading')).toContainText('В работе');
      await task.getByRole('button', { name: 'Передать жильцам на проверку' }).click();
      await expect(task.getByRole('heading')).toContainText('Ожидает подтверждения');
      await technical.screenshot({ path: resolve(root, 'technician-1366.png'), fullPage: true });
    } else {
      await transition(tech, 'IN_PROGRESS');
      await transition(tech, 'VERIFY');
    }
    await assert.rejects(() => transition(tech, 'CLOSED'), { status: 403 });
    await transition(roommate, 'REWORK', { message: 'Холодильник по-прежнему тёплый' });
    await transition(tech, 'IN_PROGRESS');
    await transition(tech, 'VERIFY');
    const version = String((await getRepair()).version);
    const repairRace = await Promise.allSettled([student, roommate].map(user => run(actor(user), 'REPAIR_TRANSITION', { id: repair.id, version, status: 'CLOSED' })));
    assert.equal(repairRace.filter(item => item.status === 'fulfilled').length, 1);
    await manage('GRANT', { dormitoryId: campusA, userId: tech.id, permission: 'TECHNICIAN', state: 'revoke' });
    assert.equal(await db.dormRepair.count({ where: dormRepairScope(tech) }), 0);
    pass('Shared repair, exact duplicate and separate fault, dispute, concurrent confirmation and revoked grant');

    const { bytes, ...contractFile } = await prepareServiceFile(image, 'contract.png', 'image/png');
    await localServiceStorage(storage).put(contractFile.key, bytes);
    const { id: documentId } = await executeDormCommand(db, actor(admin), {
      action: 'DOCUMENT', key: randomUUID(), fields: { dormitoryId: campusA, placementId: placement, title: 'Договор проживания', kind: 'CONTRACT' },
      file: contractFile,
    });
    assert(await db.dormDocument.count({ where: { ...dormDocumentScope(student), id: documentId } }));
    assert.equal(await db.dormDocument.count({ where: { ...dormDocumentScope(roommate), id: documentId } }), 0);
    const announcement = await publishAnnouncement(db, actor(admin), {
      requestId: randomUUID(), departmentId: null, dormitoryIds: [campusA], title: 'Проверка горячей воды', content: 'Плановая проверка',
    });
    assert(await db.news.count({ where: { id: announcement.id, ...await studentNewsScope(db, student.id) } }));
    assert.equal(await db.news.count({ where: { id: announcement.id, ...await studentNewsScope(db, outsider.id) } }), 0);
    assert((await listNotifications(db, actor(student))).items.some(item => item.href.includes(announcement.id)));
    assert(!(await listNotifications(db, actor(outsider))).items.some(item => item.href.includes(announcement.id)));
    const building = await db.dormBuilding.findFirstOrThrow({ where: { dormitoryId: campusA } });
    const buildingNotice = await publishAnnouncement(db, actor(admin), {
      requestId: randomUUID(), departmentId: null, buildingIds: [building.id], title: 'Работы в корпусе', content: 'Проверьте вход',
    });
    const allResidents = await publishAnnouncement(db, actor(admin), {
      requestId: randomUUID(), departmentId: null, allResidents: true, title: 'Для проживающих', content: 'Общее объявление',
    });
    assert(await db.news.count({ where: { id: buildingNotice.id, ...await studentNewsScope(db, student.id) } }));
    assert.equal(await db.news.count({ where: { id: buildingNotice.id, ...await studentNewsScope(db, outsider.id) } }), 0);
    assert(await db.news.count({ where: { id: allResidents.id, ...await studentNewsScope(db, outsider.id) } }));
    if (contexts) {
      const stranger = contexts.get(outsider.id);
      assert.equal((await stranger.request.get(base + '/api/dormitory?id=' + photo.id)).status(), 404);
      assert.equal((await contexts.get(roommate.id).request.get(base + '/api/dormitory?id=' + photo.id)).status(), 200);
      const document = await db.dormDocument.findUniqueOrThrow({ where: { id: documentId } });
      assert.equal((await contexts.get(roommate.id).request.get(base + '/api/dormitory?id=' + document.fileId)).status(), 404);
      assert.equal((await contexts.get(student.id).request.get(base + '/api/dormitory?id=' + document.fileId)).status(), 200);
      assert.equal((await contexts.get(student.id).request.post(base + '/api/dormitory?action=REPAIR_FILE&key=' + randomUUID(), { headers: { Origin: 'https://another.example' } })).status(), 403);
      const newsPath = base + '/dashboard/news?id=' + announcement.id;
      await page.goto(newsPath);
      await expect(page.getByRole('heading', { name: announcement.title })).toBeVisible();
      const direct = await (await stranger.request.get(newsPath)).text();
      assert(!direct.includes(announcement.content));
    }

    const decision = await application(student, 'dorm-transfer');
    const moving = await Promise.allSettled([reserve(decision, transferBed.id), reserve(decision, sameDorm.id)]);
    assert.equal(moving.filter(item => item.status === 'fulfilled').length, 1);
    await manage('RESERVE_CANCEL', { id: moving.find(item => item.status === 'fulfilled').value.id, reason: 'Выбрано другое место' });
    const transfer = await place(decision, transferBed.id);
    assert.equal((await residentData(student)).resident.id, transfer);
    assert.equal((await residentData(student)).history.length, 2);
    assert.equal(await db.dormBed.count({ where: { id: first.id, ...openBed(new Date()) } }), 1);
    assert.equal((await residentData(student)).repairs.length, 0);
    assert((await residentData(student)).formerRepairs.some(item => item.id === repair.id));
    assert.equal(await db.news.count({ where: { id: announcement.id, ...await studentNewsScope(db, student.id) } }), 0);
    assert(!(await listNotifications(db, actor(student))).items.some(item => item.href.includes(announcement.id) || item.source === 'DORMITORY' && item.href.endsWith('#repairs')));
    if (contexts) {
      assert.equal((await contexts.get(student.id).request.get(base + '/api/dormitory?id=' + photo.id)).status(), 404);
      const stale = await (await contexts.get(student.id).request.get(base + '/dashboard/news?id=' + announcement.id)).text();
      assert(!stale.includes(announcement.content));
      await page.goto(base + '/dashboard/dormitory');
      await expect(page.locator('.dorm-overview')).toContainText('комната 101');
      await expect(page.locator('.dorm-metrics')).toContainText('Рабочий телефон коменданта');
      await expect(page.locator('.dorm-metrics a[href^="tel:"]')).toHaveCount(0);
      await expect(page.locator('.dorm-metrics div').filter({ hasText: 'Рабочий телефон коменданта' }).locator('dd')).toHaveText('Не указан');
      await expect(page.locator('#living')).toContainText('комната 201');
      await expect(page.locator('#living')).not.toContainText('комната 101');
    }
    pass('Transactional transfer, retained history and withdrawal of old room, file and news access');

    let clearance = await executeClearanceCommand(db, actor(dean), {
      operation: 'CREATE', requestId: randomUUID(), studentId: student.id, templateId: 'clearance-standard-withdrawal', basisNote: 'Тест выезда', startsOn: day(0),
    });
    let details = await clearanceDetail(db, actor(dean), clearance.id);
    for (const step of details.steps.filter(item => item.needsClarification)) {
      clearance = await executeClearanceCommand(db, actor(dean), {
        operation: 'APPLICABILITY', requestId: randomUUID(), id: clearance.id, version: details.version, stepId: step.id, required: false, confirmed: true, text: 'Проверено для демонстрации',
      });
      details = await clearanceDetail(db, actor(dean), clearance.id);
    }
    await executeClearanceCommand(db, actor(dean), { operation: 'OPEN', requestId: randomUUID(), id: clearance.id, version: details.version });
    await manage('LOAN', { id: transfer, label: 'Ключ 101', isKey: 'on' });
    await run(actor(student), 'DEPART', { id: transfer, reason: 'Окончание проживания', plannedOn: day(1) });
    await assert.rejects(() => run(actor(student), 'CHECK_OUT', { id: transfer }), { status: 403 });
    await manage('INSPECT', { id: transfer, notes: 'Комната проверена' });
    await assert.rejects(() => manage('CHECK_OUT', { id: transfer, ackDebt: 'on' }), { status: 409 });
    const loan = await db.dormLoan.findFirstOrThrow({ where: { placementId: transfer } });
    await manage('RETURN', { id: loan.id, condition: 'Возвращён исправным' });
    await assert.rejects(() => manage('CHECK_OUT', { id: transfer }), { status: 409 });
    await manage('CHECK_OUT', { id: transfer, ackDebt: 'on' });
    const dormStep = (await clearanceDetail(db, actor(tech), clearance.id)).steps.find(step => step.rule === 'DORMITORY');
    assert.equal(dormStep.status, 'PENDING');
    assert.deepEqual(dormStep.housing, { active: false, inspected: true, departed: true, keysOutstanding: false, propertyOutstanding: false, hasDebt: true });
    const final = await residentData(student);
    assert.equal(final.resident, null);
    assert.equal(final.next.balance, 150025n);
    assert(final.documents.some(doc => doc.id === documentId));
    assert.equal(await db.dormBed.count({ where: { id: transferBed.id, ...openBed(new Date()) } }), 1);
    pass('Check-out inspection, key return, acknowledged debt, continued access to own documents and manual clearance');
    if (contexts) {
      const guest = await browser.newContext();
      assert.equal((await guest.request.get(base + '/api/dormitory?id=' + photo.id)).status(), 401);
      const wrongRole = await contexts.get(teacher.id).newPage();
      await wrongRole.goto(base + '/staff/dormitory');
      await wrongRole.waitForURL(base + '/teacher');
      const employee = await contexts.get(admin.id).newPage();
      await employee.goto(base + '/admin/dormitory?dorm=' + campusA + '&tab=fund');
      await expect(employee.getByRole('heading', { name: 'Комнаты и места' })).toBeVisible();
      for (const theme of ['light', 'dark']) for (const width of [346, 360, 390, 768, 1366]) {
        await employee.setViewportSize({ width, height: 900 });
        if (await employee.locator('html').getAttribute('data-theme') !== theme) {
          await employee.locator('.theme-toggle').click();
          await employee.getByRole('menuitemradio', { name: theme === 'light' ? 'Светлая' : 'Тёмная', exact: true }).click();
        }
        assert(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (width === 346 || width === 1366) await employee.screenshot({ path: resolve(root, `employee-${width}-${theme}.png`), fullPage: true });
      }
      assert.deepEqual(browserErrors, []);
      pass('Browser forms, protected uploads, CSRF, direct news links, two themes and five widths');
    }
  }
  assert.equal(await fingerprint(source), before, 'Source database changed');
  await integrity(source);
  pass('Source database unchanged and integral');
} finally {
  await browser?.close();
  if (child?.exitCode === null) child.kill();
  writeFileSync(resolve(root, 'server.log'), serverLog, { mode: 0o600 });
  writeFileSync(resolve(root, 'results.json'), JSON.stringify(results, null, 2), { mode: 0o600 });
  source.close();
  await db.$disconnect();
  console.info('Результаты: ' + root);
}
