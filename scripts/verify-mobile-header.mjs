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
import { provisionTestDatabase } from './test-fixtures.mjs';
import { fingerprint } from './database-snapshot.mjs';

const development = process.argv.includes('--development');
mkdirSync('.local', {recursive:true});
const root = mkdtempSync(resolve('.local/mobile-header-'));
const source = createClient({url:getDatabaseUrl()}), before = await fingerprint(source);
process.env.DATABASE_URL = provisionTestDatabase(resolve(root,'test.db')).DATABASE_URL;
const db = createPrismaClient(), password = randomBytes(24).toString('base64url');
const results = [], diagnostics = [], scrollRoots = [];
let browser, child, logs = '';
const warning = /hydration|Next\.js encountered|Blocking Route|Instant validation|uncached data during|unstable value/i;
const pass = name => {results.push(name);console.info('PASS: '+name);};
async function settle(page) {
  await page.locator('main h1:visible').first().waitFor();
  await page.waitForLoadState('networkidle');
}
function watch(page) {
  page.setDefaultTimeout(15000);
  page.on('pageerror',e=>diagnostics.push(e.message));
  page.on('console',m=>{if(warning.test(m.text()))diagnostics.push(m.text());});
}
async function state(page) {
  return page.evaluate(() => {
    const header = document.querySelector('.dashboard-header');
    let root = header.parentElement;
    while(root && root!==document.body && !/(auto|scroll|overlay)/.test(getComputedStyle(root).overflowY))root=root.parentElement;
    if(!root || root===document.body)root=document.scrollingElement;
    const rect = header.getBoundingClientRect();
    return {hidden:header.dataset.scrollHidden==='true',inert:header.inert,top:rect.top,bottom:rect.bottom,height:rect.height,
      scroll:root.scrollTop,scrollHeight:root.scrollHeight,clientHeight:root.clientHeight,root:root.className||root.tagName,
      mainY:document.querySelector('main').getBoundingClientRect().top+root.scrollTop,
      duration:getComputedStyle(header).transitionDuration,position:getComputedStyle(header).position};
  });
}
async function shown(page) {
  await expect.poll(async()=>{const s=await state(page);return !s.hidden&&!s.inert&&Math.abs(s.top)<1;}).toBe(true);
}
async function hidden(page) {
  await expect.poll(async()=>{const s=await state(page);return s.hidden&&s.inert&&s.bottom<=1;}).toBe(true);
}
async function wheel(page,dy) {
  const size=page.viewportSize();await page.mouse.move(size.width-8,450);await page.mouse.wheel(0,dy);
  await expect.poll(async()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)))))).toBe(true);
}
async function scrollTo(page,y) {
  await page.evaluate(y=>{
    const header=document.querySelector('.dashboard-header');let el=header.parentElement;
    while(el && el!==document.body && !/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY))el=el.parentElement;
    if(!el || el===document.body)el=document.scrollingElement;
    el.scrollTo({top:y,behavior:'instant'});
  },y);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
}
async function screenshot(page,label) {
  await page.screenshot({path:resolve(root,label+'.png'),caret:'initial'});
}
async function basic(page,path,width) {
  await page.setViewportSize({width,height:900});await page.goto(path);await settle(page);
  await scrollTo(page,0);await shown(page);
  const collisions=await page.locator('.dashboard-header').evaluate(header=>{
    const buttons=[...header.querySelectorAll('a,button')].filter(el=>el.getBoundingClientRect().width);
    return buttons.filter(el=>{const r=el.getBoundingClientRect();return !el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}).map(el=>el.getAttribute('aria-label')||el.className);
  });
  assert.deepEqual(collisions,[],'Header buttons overlap or cannot be reached');
  const initial=await state(page);scrollRoots.push({path:new URL(path).pathname,width,...initial});
  assert(initial.scrollHeight-initial.clientHeight>200,'Fixture page is not long: '+path+' '+width);
  const label=new URL(path).pathname.slice(1).replaceAll('/','-')+'-'+width;
  await screenshot(page,label+'-top');
  await wheel(page,260);
  await expect.poll(async()=>(await state(page)).scroll).toBeGreaterThan(80);
  if(width>760) {
    assert.equal((await state(page)).position,'static');assert.equal((await state(page)).hidden,false);
    await screenshot(page,label+'-desktop-scroll');return;
  }
  await hidden(page);await screenshot(page,label+'-down');
  const down=await state(page);
  assert.equal(down.scrollHeight,initial.scrollHeight,'Hiding changed document height');
  assert(Math.abs(down.mainY-initial.mainY)<1,'Hiding shifted content in document space');
  // Finger jitter below the reveal threshold must not toggle the bar.
  await wheel(page,-4);await wheel(page,3);await wheel(page,-3);
  assert.equal((await state(page)).hidden,true,'Small movements revealed the header');
  await wheel(page,-70);await shown(page);await screenshot(page,label+'-up');
  const up=await state(page);
  assert.equal(up.scrollHeight,initial.scrollHeight);assert(Math.abs(up.mainY-initial.mainY)<1);
  await scrollTo(page,0);await shown(page);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
}

async function interactions(page,base) {
  await page.setViewportSize({width:360,height:900});await page.goto(base+'/dashboard/profile');await settle(page);
  await wheel(page,280);await hidden(page);await wheel(page,-80);await shown(page);
  await page.locator('.theme-toggle').click();
  const saved=await page.evaluate(()=>localStorage.getItem('lks-theme'));
  await wheel(page,160);await shown(page);
  await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-expanded','true');
  assert.equal(await page.evaluate(()=>localStorage.getItem('lks-theme')),saved);
  await screenshot(page,'theme-open-360');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Открыть меню',exact:true}).click();
  await expect(page.locator('.mobile-menu')).toBeVisible();
  await scrollTo(page,350);await shown(page);await screenshot(page,'sidebar-open-360');
  await page.keyboard.press('Escape');
  await page.locator('main h1').click();await scrollTo(page,200);
  await page.keyboard.press('Tab');await wheel(page,140);await shown(page);
  await page.goto(base+'/dashboard/services');await settle(page);
  const field=page.locator('main input:not([type=checkbox]):not([type=hidden]),main textarea,main select').first();
  const fieldY=(await field.boundingBox()).y;
  await wheel(page,fieldY-35);await hidden(page);
  await field.focus();await shown(page);
  assert((await field.boundingBox()).y>=(await state(page)).bottom,'Revealed header covers the focused field');
  await wheel(page,120);await shown(page);
  await page.setViewportSize({width:360,height:560});await wheel(page,100);await shown(page);
  await screenshot(page,'keyboard-viewport-360');
  await page.setViewportSize({width:360,height:900});
  await page.goto(base+'/dashboard/profile');await settle(page);
  await page.locator('main h1').click();await scrollTo(page,200);
  await wheel(page,150);await hidden(page);
  const origin=await page.evaluate(()=>performance.timeOrigin);
  // Use the real Next Link handler without revealing the bar via keyboard first.
  await page.locator('.desktop-sidebar a[href="/dashboard/services"]').evaluate(el=>el.click());
  await page.waitForURL(base+'/dashboard/services');await settle(page);await shown(page);
  assert.equal(await page.evaluate(()=>performance.timeOrigin),origin,'Navigation reloaded the document');
  await page.goBack();await settle(page);await shown(page);
  await page.goto(base+'/dashboard/schedule');await settle(page);
  await wheel(page,260);await hidden(page);
  await page.locator('.schedule-week-links a').last().evaluate(el=>el.click());
  await page.waitForURL(url=>url.searchParams.has('week'));await settle(page);await shown(page);
  pass('Menus, keyboard/form focus, reduced viewport, soft navigation, history and same-path query navigation');

  await page.setViewportSize({width:1366,height:900});
  await page.goto(base+'/dashboard/grades');await settle(page);
  await page.locator('.brs-full .brs-progress-cell').first().click();
  await expect(page.locator('.brs-dialog')).toBeVisible();
  await page.setViewportSize({width:360,height:900});
  await scrollTo(page,250);await wheel(page,100);await shown(page);
  await screenshot(page,'brs-dialog-open-360');await page.keyboard.press('Escape');
  pass('Actual BRS modal keeps the header revealed during scrolling and resize');

  await page.goto(base+'/dashboard/profile');await settle(page);
  await page.evaluate(()=>{
    const workspace=document.querySelector('.dashboard-workspace');
    Object.assign(workspace.style,{height:'900px',minHeight:'0',overflowY:'auto'});
    dispatchEvent(new Event('resize'));
  });
  await wheel(page,240);await hidden(page);
  assert.equal((await state(page)).root,'dashboard-workspace');
  assert.equal(await page.evaluate(()=>window.scrollY),0,'Nested-root test scrolled window');
  await wheel(page,-70);await shown(page);await screenshot(page,'nested-scroll-root-360');
  // A nested scroller must not drive the header's direction or thresholds.
  await page.evaluate(()=>{
    const div=document.createElement('div');div.id='nested-scroll-probe';
    div.style.cssText='height:100px;overflow-y:auto';div.innerHTML='<div style="height:1000px">Nested scroll fixture</div>';
    document.querySelector('main').prepend(div);div.scrollTop=300;
  });
  await page.locator('#nested-scroll-probe').dispatchEvent('wheel',{deltaY:200});
  await page.evaluate(()=>{document.querySelector('#nested-scroll-probe').scrollTop=500;});
  await shown(page);
  pass('Real document scroll root, alternate workspace scroll root and ignored nested vertical scrolling');

  await page.goto(base+'/dashboard/profile');await settle(page);
  const cdp=await page.context().newCDPSession(page);
  const swipe=async(from,to)=>{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:340,y:from}]});
    for(let i=1;i<=10;i++) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:340,y:from+(to-from)*i/10}]});
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  await swipe(650,350);
  await expect.poll(async()=>(await state(page)).scroll).toBeGreaterThan(80);
  await hidden(page);
  await swipe(350,480);
  await shown(page);await cdp.detach();
  let last=-1,steady=0;
  await expect.poll(async()=>{
    const y=(await state(page)).scroll;steady=Math.abs(y-last)<.25?steady+1:0;last=y;return steady>=3;
  },{intervals:[60]}).toBe(true); // Let touch momentum finish before switching input.
  await page.keyboard.press('Home');
  await expect.poll(async()=>(await state(page)).scroll).toBe(0);
  await shown(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await wheel(page,260);await hidden(page);assert.equal((await state(page)).duration,'0s');
  await page.setViewportSize({width:360,height:860});await hidden(page);
  await page.setViewportSize({width:360,height:900});await hidden(page);
  await wheel(page,-60);await shown(page);
  await page.setViewportSize({width:1366,height:900});assert.equal((await state(page)).inert,false);
  await page.setViewportSize({width:390,height:900});await shown(page);
  pass('Touch swipe, reduced motion, stable browser-toolbar height changes and mobile/desktop resize reset');
}

try {
  await seedBrsDemo(db);await seedServices(db);
  await db.account.updateMany({where:{providerId:'credential'},data:{password:await hashPassword(password)}});
  const assignment=await db.teachingAssignment.findFirstOrThrow({where:{isActive:true}});
  for(let i=0;i<24;i++)await db.learningMaterial.create({data:{authorId:assignment.teacherId,termId:assignment.termId,disciplineId:assignment.disciplineId,
    title:'Header scrolling fixture '+(i+1),searchTitle:'header scrolling fixture '+(i+1),description:'Material description for a long scrolling page. '.repeat(5),url:'https://example.test/header',category:'LECTURES',status:'PUBLISHED',publishedAt:new Date(),targets:{create:{groupId:assignment.groupId}}}});
  const net=createServer();await new Promise(r=>net.listen(0,'127.0.0.1',r));const port=net.address().port;await new Promise(r=>net.close(r));
  const base='http://127.0.0.1:'+port;
  let project=resolve('.');
  if(development) {
    project=resolve(root,'project');mkdirSync(project);
    for(const folder of ['src','public'])cpSync(folder,resolve(project,folder),{recursive:true});
    for(const file of ['package.json','package-lock.json','tsconfig.json','AGENTS.md','.gitignore'])cpSync(file,resolve(project,file));
    writeFileSync(resolve(project,'next.config.ts'),readFileSync('next.config.ts','utf8').replace('turbopack: {',`turbopack: { root: ${JSON.stringify(resolve('.').replaceAll('\\','/'))},`).replace('loaders: ["@tailwindcss/turbopack"]',`loaders: [{ loader: "@tailwindcss/turbopack", options: { base: ${JSON.stringify(resolve(project,'src').replaceAll('\\','/'))} } }]`));
    symlinkSync(resolve('node_modules'),resolve(project,'node_modules'),process.platform==='win32'?'junction':'dir');
  }
  child=spawn(process.execPath,['node_modules/next/dist/bin/next',development?'dev':'start',project,'--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BETTER_AUTH_URL:base,BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),AUTH_TRUST_PROXY:'false',AUTH_PROXY_SECRET:'',NEXT_TELEMETRY_DISABLED:'1'}});
  child.stdout.on('data',d=>{logs+=d;});child.stderr.on('data',d=>{logs+=d;});
  for(let i=0;i<120;i++){assert.equal(child.exitCode,null);try{if((await fetch(base+'/api/auth/get-session')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
  for(const actor of demoAccounts.filter(a=>a.email!=='maria.volkova@example.test')) {
    const context=await browser.newContext({viewport:{width:360,height:900},hasTouch:true,colorScheme:'light',reducedMotion:'no-preference'});
    assert.equal((await context.request.post(base+'/api/auth/sign-in/email',{headers:{Origin:base},data:{email:actor.email,password}})).status(),200);
    const page=await context.newPage();watch(page);const home=roleHomes[actor.role];
    const paths=actor.role==='STUDENT'?['/dashboard/profile','/dashboard/services','/dashboard/materials?'+new URLSearchParams({termId:assignment.termId,disciplineId:assignment.disciplineId}),'/dashboard/grades','/dashboard/schedule']:[home+'/profile'];
    for(const path of paths)for(const width of [346,360,390,1366])await basic(page,base+path,width);
    if(actor.role==='STUDENT')await interactions(page,base);
    await context.close();pass(actor.role+': scroll down/up, jitter, no content jumps, 346/360/390px and unchanged desktop');
  }
  assert.deepEqual(diagnostics,[]);assert(!warning.test(logs));
  assert.equal(await fingerprint(source),before,'Source database changed');
  pass('No runtime/hydration/Blocking Route/Instant errors; source database unchanged');
} finally {
  await browser?.close();child?.kill();await db.$disconnect();source.close();
  writeFileSync(resolve(root,'results.json'),JSON.stringify({mode:development?'development':'production',results,scrollRoots,diagnostics},null,2));
  writeFileSync(resolve(root,'server.log'),logs.replaceAll(password,'[REDACTED]'),{mode:0o600});
  console.info('Mobile header report: '+root.replaceAll('\\','/')+'/results.json');
}
