import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@libsql/client';
import { hashPassword } from 'better-auth/crypto';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDeaneryContext, getDeaneryGroups, getDeaneryStudents, getDeaneryOverview, getDeanerySchedule, requireDeaneryGroup, requireDeaneryStudent, DeaneryAccessDenied } from '../src/lib/deanery-repository.ts';
import { parseScheduleQuery } from '../src/lib/schedule-calendar.ts';

mkdirSync('.local',{recursive:true});
const root=mkdtempSync(resolve('.local/deanery-test-'));
const source=createClient({url:getDatabaseUrl()});
async function fingerprint() {
  const result=[];
  for(const {name} of (await source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows)result.push([name,(await source.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows]);
  return createHash('sha256').update(JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v)).digest('hex');
}
const before=await fingerprint();
const file=resolve(root,'test.db');
await source.execute({sql:'VACUUM INTO ?',args:[file]});
process.env.DATABASE_URL='file:'+file.replaceAll('\\','/');
const db=createPrismaClient(), results=[], errors=[];
const pass=(name,details={})=>{results.push({name,...details});console.info('PASS: '+name+' '+JSON.stringify(details));};
let child,browser,logs='';
try {
  const dean=await db.user.findUniqueOrThrow({where:{email:'olga.kuznetsova@example.test'}});
  const actor={id:dean.id,role:'DEANERY_STAFF'};
  const own=await db.academicDepartment.create({data:{faculty:'Fixture Faculty',name:'Deanery own'}});
  const other=await db.academicDepartment.create({data:{faculty:'Fixture Faculty',name:'Deanery other'}});
  await db.deaneryDepartmentAssignment.deleteMany({where:{userId:dean.id}});
  await db.deaneryDepartmentAssignment.create({data:{userId:dean.id,departmentId:own.id}});
  const group=await db.studyGroup.update({where:{slug:'pi-24-1'},data:{departmentId:own.id}});
  const foreignGroup=await db.studyGroup.update({where:{slug:'it-25-1'},data:{departmentId:other.id,parentId:group.id}});
  const student=await db.user.findUniqueOrThrow({where:{email:'alexander.smirnov@example.test'}});
  const foreign=await db.user.findUniqueOrThrow({where:{email:'maria.volkova@example.test'}});
  await db.studentProfile.update({where:{userId:student.id},data:{groupId:group.id}});
  await db.studentProfile.update({where:{userId:foreign.id},data:{groupId:foreignGroup.id,institute:own.faculty}});
  const context=await getDeaneryContext(db,actor); assert.equal(context.departments.length,1);
  assert.deepEqual((await getDeaneryGroups(db,actor)).map(g=>g.id),[group.id]);
  assert.deepEqual((await getDeaneryStudents(db,actor)).map(s=>s.userId),[student.id]);
  assert.equal((await getDeaneryOverview(db,actor)).students,1);
  assert.equal((await requireDeaneryStudent(db,actor,student.id)).user.email,student.email);
  for(const read of [
    ()=>requireDeaneryStudent(db,actor,foreign.id),()=>requireDeaneryStudent(db,actor,'missing'),
    ()=>requireDeaneryGroup(db,actor,{id:foreignGroup.id}),()=>getDeaneryStudents(db,actor,{departmentId:other.id}),
    ()=>getDeaneryGroups(db,actor,{groupId:foreignGroup.id}),()=>getDeaneryStudents(db,actor,{studentId:foreign.id}),
    ()=>getDeanerySchedule(db,actor,parseScheduleQuery({group:foreignGroup.slug,week:'2026-11-09'})),
  ])await assert.rejects(read,DeaneryAccessDenied);
  const schedule=await getDeanerySchedule(db,actor,parseScheduleQuery({group:group.slug,week:'2026-11-09'}));
  assert(schedule.days.flatMap(d=>d.lessons).length>0);
  assert(schedule.allGroups.every(g=>g.slug===group.slug));
  assert(schedule.days.flatMap(d=>d.lessons).every(l=>l.groups.every(g=>g.slug===group.slug)));
  await db.studentProfile.update({where:{userId:foreign.id},data:{groupId:null,groupName:group.code}});
  assert.deepEqual((await getDeaneryStudents(db,actor)).map(s=>s.userId),[student.id]);
  await db.studentProfile.update({where:{userId:foreign.id},data:{groupId:foreignGroup.id}});
  await db.deaneryDepartmentAssignment.create({data:{userId:dean.id,departmentId:other.id}});
  assert.equal((await getDeaneryStudents(db,actor)).length,2);
  await db.deaneryDepartmentAssignment.delete({where:{userId_departmentId:{userId:dean.id,departmentId:other.id}}});
  await assert.rejects(()=>requireDeaneryStudent(db,actor,foreign.id),DeaneryAccessDenied);
  for(const role of ['STUDENT','TEACHER','ADMIN','TECHNICAL_STAFF']) {
    const user=await db.user.findFirstOrThrow({where:{role}});
    await assert.rejects(()=>getDeaneryStudents(db,{id:user.id,role}),DeaneryAccessDenied);
    await assert.rejects(()=>getDeaneryStudents(db,{id:user.id,role:'DEANERY_STAFF'}),DeaneryAccessDenied);
  }
  await db.user.update({where:{id:dean.id},data:{role:'ADMIN'}});
  await assert.rejects(()=>getDeaneryStudents(db,actor),DeaneryAccessDenied);
  await db.user.update({where:{id:dean.id},data:{role:'DEANERY_STAFF'}});
  pass('Deanery data scope',{multipleAssignments:true,foreignStudentDenied:true,foreignGroupDenied:true,unlinkedDenied:true,noNameInference:true,crossDepartmentParentDenied:true,liveRole:true,revocation:true,publishedSchedule:true});

  const password=randomBytes(24).toString('base64url');
  await db.account.updateMany({where:{userId:dean.id,providerId:'credential'},data:{password:await hashPassword(password)}});
  const base='http://127.0.0.1:3214';
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3214'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',BETTER_AUTH_URL:base,BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),AUTH_TRUST_PROXY:'false',AUTH_PROXY_SECRET:''}});
  child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
  let ready=false;
  for(let i=0;i<50;i++){try{if((await fetch(base+'/api/auth/get-session')).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,200));}
  assert(ready);
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
  const browserContext=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await browserContext.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/login');
  await page.getByLabel(/email/i).fill(dean.email);await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти в кабинет',exact:true}).click();await page.waitForURL(base+'/deanery');
  await expect(page.locator('main h1:visible')).toHaveText('Рабочая панель деканата');
  await page.goto(base+'/deanery/students');
  await expect(page.locator('.deanery-list:visible')).toContainText(student.email);
  assert(!(await page.locator('main:visible').innerText()).includes(foreign.email));
  for(const query of ['studentId='+foreign.id,'departmentId='+other.id,'groupId='+foreignGroup.id,'departmentId=x&departmentId=y']) {
    await page.goto(base+'/deanery/students?'+query);
    await expect(page.getByRole('heading',{name:'Кажется, здесь пока пусто',exact:true})).toBeVisible();
    assert(!(await page.locator('main:visible').innerText()).includes(foreign.email));
  }
  await page.goto(base+'/deanery/schedule?group='+foreignGroup.slug);
  await expect(page.getByRole('heading',{name:'Кажется, здесь пока пусто',exact:true})).toBeVisible();
  await page.goto(base+'/deanery/schedule?group='+group.slug+'&week=2026-11-09');
  await expect(page.locator('.public-lesson:visible').first()).toBeVisible();
  await page.getByRole('link',{name:'Следующая неделя',exact:true}).click();
  await expect(page.locator('.schedule-date-input input:visible')).toHaveValue('16.11.2026');
  assert.equal(new URL(page.url()).searchParams.get('group'),group.slug);
  const api=await browserContext.request.get(base+'/api/v1/schedule?group='+group.slug+'&week=2026-11-09');
  assert.equal(api.status(),200);
  const publicText=await api.text();
  for(const value of [dean.email,student.email,foreign.email,'studentNumber','deaneryAssignments','password','departmentId'])assert(!publicText.includes(value),'Public API disclosed private data to deanery');
  for(const path of ['update-user','admin/set-role'])assert.equal((await browserContext.request.post(base+'/api/auth/'+path,{headers:{Origin:base},data:{role:'ADMIN',departmentId:other.id}})).status(),404);
  for(const route of ['/admin','/staff','/teacher','/dashboard']) {await page.goto(base+route);await page.waitForURL(base+'/deanery');}
  await expect(page.locator('main h1:visible')).toHaveText('Рабочая панель деканата');
  await expect(page.locator('main:visible')).toContainText(own.name);
  await page.screenshot({path:resolve(root,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'/deanery/students');await expect(page.locator('.deanery-list:visible')).toContainText(student.email);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(root,'mobile.png'),fullPage:true});
  await db.deaneryDepartmentAssignment.deleteMany({where:{userId:dean.id}});
  await page.goto(base+'/deanery');await expect(page.locator('main:visible')).toContainText('Подразделения не назначены');
  await page.goto(base+'/deanery/students');assert(!(await page.locator('main:visible').innerText()).includes(student.email));
  assert.equal((await getDeaneryOverview(db,actor)).students,0);
  await assert.rejects(()=>requireDeaneryStudent(db,actor,student.id),DeaneryAccessDenied);
  assert.deepEqual(errors,[]);
  assert.equal(await fingerprint(),before);
  pass('Deanery browser and source preservation',{loginRedirect:true,desktopMobile:true,forgedParametersDenied:true,noSelfEscalation:true,noAssignmentsFailClosed:true,groupKeptOnWeekChange:true,publicApiPrivacy:true,browserErrors:0,sourceUnchanged:true});
} finally {
  await browser?.close();child?.kill();await db.$disconnect();source.close();
  writeFileSync(resolve(root,'results.json'),JSON.stringify(results,null,2));
  // Server logs contain no request bodies or credentials, but remain ignored.
  writeFileSync(resolve(root,'server.log'),logs,{mode:0o600});
  console.info('Deanery report: '+root.replaceAll('\\','/')+'/results.json');
}
