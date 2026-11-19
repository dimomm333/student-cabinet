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
import { roleHomes } from '../src/lib/roles.ts';
import { seedBrsDemo } from '../prisma/brs-demo.ts';
import { seedServices } from '../src/lib/services-repository.ts';
import { emitNotification } from '../src/lib/notifications-repository.ts';
import { serviceCatalog } from '../src/lib/services-catalog.ts';
import { provisionTestDatabase } from './test-fixtures.mjs';
import { fingerprint } from './database-snapshot.mjs';

const development = process.argv.includes('--development');
mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/themes-'));
const source = createClient({ url: getDatabaseUrl() }), before = await fingerprint(source);
process.env.DATABASE_URL = provisionTestDatabase(resolve(root, 'test.db')).DATABASE_URL;
const db = createPrismaClient(), password = randomBytes(24).toString('base64url');
let browser, child, logs = '';
const results = [], diagnostics = [], pages = [], contrastIssues = [];
const warning = /hydration|Next\.js encountered|Blocking Route|Instant validation|uncached data during|unstable value/i;
const pass = name => { results.push(name); console.info('PASS: ' + name); };
const watch = page => {
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', error => diagnostics.push(error.message));
  page.on('console', message => { if (warning.test(message.text())) diagnostics.push(message.text()); });
};
async function settle(page) {
  await page.locator('main h1:visible').first().waitFor();
  await page.waitForLoadState('networkidle');
  const overlay = (await page.locator('nextjs-portal').allTextContents()).join(' ');
  if (warning.test(overlay)) diagnostics.push(overlay);
}
async function check(page, theme, label, capture = true) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflow: ' + label);
  const state = await page.evaluate(() => {
    const visible = el => el.getBoundingClientRect().width && el.getBoundingClientRect().height && getComputedStyle(el).visibility !== 'hidden';
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const lum = values => values.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s,v,i) => s + v * [.2126,.7152,.0722][i], 0);
    const bright = [], contrast = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!(el instanceof HTMLElement) || !visible(el) || el.closest('nextjs-portal, .brand-mark, .theme-tooltip')) continue;
      const style = getComputedStyle(el), bg = rgb(style.backgroundColor);
      if ((bg[3] ?? 1) > .5 && lum(bg) > .3 && el.clientWidth > 30 && el.clientHeight > 25) bright.push(el.className || el.tagName);
      if (!Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) || style.opacity !== '1' || el.closest('button:disabled,select:disabled,.schedule-calendar-adjacent')) continue;
      let node = el, backdrop;
      while (node) {
        const s = getComputedStyle(node), c = rgb(s.backgroundColor);
        if (s.backgroundImage !== 'none') break;
        if ((c[3] ?? 1) === 1) { backdrop = c; break; }
        node = node.parentElement;
      }
      if (!backdrop) continue;
      const a = lum(rgb(style.color)), b = lum(backdrop), ratio = (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
      const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700;
      if (ratio < (large ? 3 : 4.5)) contrast.push({ selector: el.className || el.tagName, text: el.textContent.trim().slice(0,60), ratio: +ratio.toFixed(2), color: style.color });
    }
    const button = document.querySelector('.theme-toggle'), bell = document.querySelector('.notification-button');
    const a = button?.getBoundingClientRect(), b = bell?.getBoundingClientRect();
    return { bright, contrast, body: getComputedStyle(document.body).backgroundColor, chrome: ['.dashboard-header','.desktop-sidebar'].map(s => { const el=document.querySelector(s); return el && visible(el) ? getComputedStyle(el).backgroundColor : null; }), collision: !!(a && b && a.right > b.left), filter: [...document.querySelectorAll('img,svg')].some(el => getComputedStyle(el).filter !== 'none') };
  });
  assert(!state.collision, 'Theme switch overlaps notifications: ' + label);
  assert(!state.filter, 'Media was filtered: ' + label);
  if (theme === 'dark') {
    assert.equal(state.body, 'rgb(0, 0, 0)', label);
    assert(state.chrome.every(c => c === null || c === 'rgb(0, 0, 0)'), 'Chrome is not black: ' + label);
    assert.deepEqual(state.bright, [], 'Bright surfaces: ' + label);
    if (state.contrast.length) contrastIssues.push({ label, issues: state.contrast });
  }
  // Playwright's default caret hiding writes inline styles into every input.
  // In streamed dev pages this can race a nested component's hydration.
  if (capture) await page.screenshot({ path: resolve(root, label + '-' + theme + '.png'), fullPage: true, caret: 'initial' });
  pages.push({ label, theme, url: new URL(page.url()).pathname });
}
async function matrix(page, label, prepare, widths = [1366, 768, 360, 346]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    if (prepare) await prepare();
    for (const theme of ['dark', 'light']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        if (await page.locator('dialog[open], .schedule-calendar').count()) {
          // A modal makes the header inert. Model the supported cross-tab
          // storage event while keeping the real modal and its focus trap open.
          await page.evaluate(theme => { localStorage.setItem('lks-theme',theme); dispatchEvent(new StorageEvent('storage',{key:'lks-theme',newValue:theme})); },theme);
        } else await page.locator('.theme-toggle').click();
      }
      await check(page, theme, label + '-' + width, theme === 'dark' || label === 'public-home' || label === 'login');
    }
  }
}
async function preferences(base) {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 346, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); watch(page);
  await page.goto(base + '/'); await settle(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assert.equal(await page.evaluate(() => localStorage.getItem('lks-theme')), null);
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.locator('.theme-toggle').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.theme-toggle')).toHaveAccessibleName('Тёмная');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' }); await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Space'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  assert.equal(await page.evaluate(() => localStorage.getItem('lks-theme')), 'dark');
  await page.reload(); await settle(page); await expect(page.locator('.theme-toggle')).toHaveAccessibleName('Светлая');
  // Delay React, and observe the first rendered frame, not only final hydration.
  const slow = await context.newPage(); watch(slow);
  await slow.emulateMedia({ colorScheme: 'light' });
  await slow.route('**/_next/**/*.js*', route => new Promise(done => setTimeout(done, 1500)).then(() => route.continue()));
  await slow.addInitScript(() => {
    requestAnimationFrame(() => { window.__firstTheme = { theme: document.documentElement.dataset.theme, background: getComputedStyle(document.documentElement).backgroundColor }; });
  });
  await slow.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await slow.waitForFunction(() => window.__firstTheme);
  assert.deepEqual(await slow.evaluate(() => window.__firstTheme), { theme: 'dark', background: 'rgb(0, 0, 0)' });
  await slow.close();
  const second = await context.newPage(); watch(second); await second.goto(base + '/login'); await settle(second);
  await page.locator('.theme-toggle').click(); await expect(second.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => localStorage.removeItem('lks-theme')); await page.reload(); await settle(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await matrix(page, 'public-home');
  await page.goto(base + '/login'); await settle(page); await matrix(page, 'login');
  await page.getByLabel('Университетский email').fill('invalid@example.test');
  await page.getByLabel('Пароль').fill('invalid-password'); await page.getByRole('button', { name: 'Войти в кабинет', exact: true }).click();
  await expect(page.locator('.auth-error')).toBeVisible();
  if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.locator('.theme-toggle').click();
  await check(page, 'dark', 'login-error-346');
  await page.goto(base + '/schedule'); await settle(page); await matrix(page, 'public-schedule');
  await context.close();
  const blocked = await browser.newContext({ colorScheme: 'dark' }); const privatePage = await blocked.newPage(); watch(privatePage);
  await privatePage.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }); });
  await privatePage.goto(base + '/login'); await settle(privatePage); await expect(privatePage.locator('html')).toHaveAttribute('data-theme', 'dark');
  await privatePage.locator('.theme-toggle').click(); await privatePage.emulateMedia({ colorScheme: 'light' }); await privatePage.emulateMedia({ colorScheme: 'dark' });
  await expect(privatePage.locator('html')).toHaveAttribute('data-theme', 'light'); await blocked.close();
  pass('System tracking, manual override, Enter/Space, reload, first painted frame with delayed React, cross-tab sync, public pages and unavailable storage');
}

try {
  await seedBrsDemo(db); await seedServices(db);
  await db.account.updateMany({ where: { providerId: 'credential' }, data: { password: await hashPassword(password) } });
  const student = await db.user.findUniqueOrThrow({ where: { email: 'alexander.smirnov@example.test' }, include: { studentProfile: { include: { group: true } } } });
  const departmentId = student.studentProfile.group.departmentId;
  for (const user of await db.user.findMany({ where: { role: { in: ['ADMIN','DEANERY_STAFF','TECHNICAL_STAFF'] } } })) {
    for (const config of serviceCatalog) await db.serviceGrant.create({ data: { userId: user.id, departmentId, serviceCode: config.code, readFiles: true } });
  }
  for (const config of serviceCatalog) await db.serviceRoute.create({ data: { serviceCode: config.code, sourceDepartmentId: departmentId, departmentId } });
  const config = serviceCatalog.find(s => s.documents.length);
  const request = await db.serviceRequest.create({ data: { ownerId: student.id, serviceCode: config.code, schemaVersion: config.version, departmentId, category: config.category, status: 'IN_REVIEW', submittedAt: new Date(), history: { create: { actorId: student.id, actorName: student.name, action: 'SUBMITTED' } } } });
  const assignment = await db.teachingAssignment.findFirstOrThrow({ where: { isActive: true }, include: { teacher: true } });
  await db.learningMaterial.create({ data: { authorId: assignment.teacherId, termId: assignment.termId, disciplineId: assignment.disciplineId, title: 'Материал для проверки оформления', searchTitle: 'материал для проверки оформления', description: 'Документы и ссылки доступны в светлой и тёмной теме.', url: 'https://example.test/material', category: 'LECTURES', status: 'PUBLISHED', publishedAt: new Date(), targets: { create: { groupId: assignment.groupId } } } });
  for (const user of await db.user.findMany({ where: { email: { in: demoAccounts.map(a => a.email) } } })) {
    for (let i = 0; i < 3; i++) await emitNotification(db, { sourceKey: 'theme-'+user.id+'-'+i, source:'SYSTEM', sourceId:'theme-fixture', type:'THEME_FIXTURE', category:'SYSTEM', title:'Проверка уведомлений '+(i+1), body:'Системное уведомление для проверки контраста и прочитанности.', mandatory:true, recipients:[{ id:user.id,role:user.role,href:roleHomes[user.role] }] });
    await db.notification.updateMany({ where:{recipientId:user.id}, data:{readAt:new Date()} });
    const latest = await db.notification.findFirstOrThrow({where:{recipientId:user.id},orderBy:{seq:'desc'}});
    await db.notification.update({where:{seq:latest.seq},data:{readAt:null}});
  }
  const net = createServer(); await new Promise(r => net.listen(0, '127.0.0.1', r)); const port = net.address().port; await new Promise(r => net.close(r));
  const base = 'http://127.0.0.1:' + port;
  let project = resolve('.');
  if (development) {
    project = resolve(root, 'project'); mkdirSync(project);
    for (const folder of ['src','public']) cpSync(folder, resolve(project, folder), { recursive: true });
    for (const file of ['package.json','package-lock.json','tsconfig.json','AGENTS.md','.gitignore']) cpSync(file, resolve(project, file));
    writeFileSync(resolve(project, 'next.config.ts'), readFileSync('next.config.ts','utf8').replace('turbopack: {', `turbopack: { root: ${JSON.stringify(resolve('.').replaceAll('\\','/'))},`).replace('loaders: ["@tailwindcss/turbopack"]', `loaders: [{ loader: "@tailwindcss/turbopack", options: { base: ${JSON.stringify(resolve(project,'src').replaceAll('\\','/'))} } }]`));
    symlinkSync(resolve('node_modules'), resolve(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', development ? 'dev' : 'start', project, '--hostname','127.0.0.1','--port',String(port)], { windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_TRUST_PROXY: 'false', AUTH_PROXY_SECRET: '', MATERIALS_STORAGE_DIR: resolve(root,'materials'), SERVICES_STORAGE_DIR: resolve(root,'documents'), NEXT_TELEMETRY_DISABLED: '1' } });
  child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
  for (let i=0;i<120;i++) { assert(child.exitCode===null,'Theme server exited'); try { if ((await fetch(base+'/api/auth/get-session')).ok) break; } catch {} await new Promise(r=>setTimeout(r,500)); }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  await preferences(base);
  for (const actor of demoAccounts.filter(a => a.email !== 'maria.volkova@example.test')) {
    const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
    assert.equal((await context.request.post(base+'/api/auth/sign-in/email',{ headers: { Origin: base }, data: { email: actor.email, password } })).status(),200);
    const page = await context.newPage(); watch(page); const home = roleHomes[actor.role];
    await page.goto(base+home); await settle(page);
    const paths = await page.locator('.desktop-sidebar .sidebar-nav a').evaluateAll(nodes => nodes.map(n=>n.getAttribute('href')));
    for (const path of paths) { await page.goto(base+path); await settle(page); await matrix(page,path.slice(1).replaceAll('/','-')); }
    await page.goto(base+home); await settle(page); await page.setViewportSize({width:346,height:900});
    await page.getByRole('button',{name:'Открыть меню',exact:true}).click(); await expect(page.locator('.mobile-menu')).toBeVisible();
    await matrix(page,actor.role.toLowerCase()+'-mobile-menu',undefined,[360,346]);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width:1366,height:900 });
    if (actor.role==='STUDENT'||actor.role==='TEACHER') {
      await page.goto(base+home+'/materials?'+new URLSearchParams({ termId:assignment.termId,disciplineId:assignment.disciplineId })); await settle(page); await expect(page.locator('.material-card')).toBeVisible();
      await page.locator('.material-card summary').first().click(); await matrix(page,actor.role.toLowerCase()+'-material-details');
      if (actor.role==='TEACHER') { await page.getByRole('button',{name:'Добавить материалы',exact:true}).click(); await matrix(page,'teacher-material-upload'); }
      await page.goto(base+home+'/schedule'); await settle(page);
      await matrix(page,actor.role.toLowerCase()+'-calendar',async()=>{
        if (await page.locator('.schedule-calendar').count()) await page.locator('.schedule-date-input input').press('Escape');
        await page.getByRole('button',{name:'Открыть календарь',exact:true}).click(); await expect(page.locator('.schedule-calendar')).toBeVisible();
      });
      await page.goto(base+home+'/grades'); await settle(page); await page.setViewportSize({width:1366,height:900});
      const cell = page.locator(actor.role==='STUDENT'?'.brs-full .brs-progress-cell':'.brs-cross-table td button').first();
      await cell.click(); await expect(page.locator('.brs-dialog')).toBeVisible(); await matrix(page,actor.role.toLowerCase()+'-brs-dialog'); await page.keyboard.press('Escape');
    }
    if (actor.role==='DEANERY_STAFF') {
      await page.goto(base+'/deanery/schedule'); await settle(page);
      await page.getByRole('button',{name:'Добавить регулярную пару',exact:true}).click(); await expect(page.locator('.editor-dialog')).toBeVisible(); await matrix(page,'deanery-editor-dialog'); await page.keyboard.press('Escape');
    }
    if (actor.role==='STUDENT') {
      await page.goto(base+'/dashboard/services?requestId='+request.id); await settle(page); await expect(page.locator('.services-detail')).toHaveAttribute('aria-busy','false'); await matrix(page,'student-service-history');
      await page.goto(base+'/dashboard/services?service='+config.code); await settle(page);
      await page.getByRole('button',{name:'Создать черновик',exact:true}).click(); await expect(page.locator('.services-detail')).toHaveAttribute('aria-busy','false'); await matrix(page,'student-service-documents');
      await page.goto(base+'/dashboard/services?tab=drafts'); await settle(page); await page.getByRole('button',{name:'Удалить черновик',exact:true}).click();
      await matrix(page,'student-delete-confirmation');
      await page.goto(base+'/dashboard/materials'); await settle(page);
      await page.route('**/api/materials?*', route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тестовая ошибка соединения'})}));
      await page.reload(); await settle(page); await expect(page.locator('.materials-workspace [role=alert]')).toBeVisible(); await matrix(page,'student-material-error'); await page.unroute('**/api/materials?*');
      let release; const pending = new Promise(done=>{release=done;});
      await page.route('**/api/materials?*',async route=>{await pending;await route.continue();});
      await page.reload({waitUntil:'domcontentloaded'}); await page.getByText('Загружаем материалы…',{exact:true}).waitFor();
      await matrix(page,'student-material-loading'); release(); await page.waitForLoadState('networkidle'); await page.unroute('**/api/materials?*');
    }
    if (actor.role==='ADMIN') {
      await page.goto(base+'/admin/news'); await settle(page); await matrix(page,'admin-announcement-form');
    }
    // Manual choice survives the actual sign-out redirect and the next login.
    await page.setViewportSize({ width:1366,height:900 }); await page.goto(base+home); await settle(page);
    if(await page.locator('html').getAttribute('data-theme')!=='dark')await page.locator('.theme-toggle').click();
    await page.getByRole('button',{name:'Выйти из аккаунта',exact:true}).filter({visible:true}).click(); await page.waitForURL(base+'/login'); await settle(page); await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    assert.equal((await context.request.post(base+'/api/auth/sign-in/email',{headers:{Origin:base},data:{email:actor.email,password}})).status(),200);
    await page.goto(base+home); await settle(page); await expect(page.locator('html')).toHaveAttribute('data-theme','dark'); await context.close();
    pass(actor.role+': all menu sections, four widths, both themes, bell geometry, contrast, logout/login persistence');
  }
  assert.deepEqual(contrastIssues, [], 'Dark text contrast below WCAG AA; see results.json');
  assert.deepEqual(diagnostics, [], 'Browser errors or Next.js diagnostics');
  assert(!warning.test(logs),'Next.js diagnostics in server log');
  assert.equal(await fingerprint(source), before, 'Source database changed');
  pass('No bright surfaces, overflow, media filters, hydration/Blocking Route/Instant errors; source database unchanged');
} finally {
  await browser?.close(); child?.kill(); await db.$disconnect(); source.close();
  writeFileSync(resolve(root,'results.json'),JSON.stringify({ mode:development?'development':'production',results,pages,contrastIssues,diagnostics },null,2));
  writeFileSync(resolve(root,'server.log'),logs.replaceAll(password,'[REDACTED]'),{mode:0o600});
  console.info('Theme report: '+root.replaceAll('\\','/')+'/results.json');
}

