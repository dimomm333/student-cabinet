import { bellGrids, identifyPair } from '../src/lib/schedule-bells.ts';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@libsql/client';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { executeScheduleCommand, ScheduleEditError, getScheduleEditor } from '../src/lib/schedule-editor-repository.ts';
import { getPublicScheduleData, getPersonalScheduleData } from '../src/lib/schedule-repository.ts';
import { parseScheduleQuery } from '../src/lib/schedule-calendar.ts';
import { DeaneryAccessDenied } from '../src/lib/deanery-repository.ts';

mkdirSync('.local',{recursive:true});const root=mkdtempSync(resolve('.local/schedule-editor-test-'));
const source=createClient({url:getDatabaseUrl()});
async function fingerprint(){const rows=[];for(const {name}of(await source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows)rows.push([name,(await source.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows]);return createHash('sha256').update(JSON.stringify(rows,(_,v)=>typeof v==='bigint'?String(v):v)).digest('hex');}
const before=await fingerprint(),file=resolve(root,'test.db');await source.execute({sql:'VACUUM INTO ?',args:[file]});process.env.DATABASE_URL='file:'+file.replaceAll('\\','/');
const db=createPrismaClient(),results=[],errors=[],warnings=[];let child,browser,logs='';
const pass=(name,details={})=>{results.push({name,...details});console.info('PASS: '+name+' '+JSON.stringify(details));};
try{
  const dean=await db.user.findUniqueOrThrow({where:{email:'olga.kuznetsova@example.test'}}),actor={id:dean.id,role:'DEANERY_STAFF'};
  const [group,group2,foreignGroup,term,discipline,otherDiscipline,teacher,otherTeacher,room,otherRoom,student]=await Promise.all([
    db.studyGroup.findUniqueOrThrow({where:{slug:'pi-24-1'}}),db.studyGroup.findUniqueOrThrow({where:{slug:'pi-24-2'}}),db.studyGroup.findUniqueOrThrow({where:{slug:'it-25-1'}}),
    db.academicTerm.findUniqueOrThrow({where:{code:'demo-autumn-2026'}}),db.discipline.findUniqueOrThrow({where:{code:'math'}}),db.discipline.findUniqueOrThrow({where:{code:'english'}}),
    db.teacherProfile.findFirstOrThrow({where:{scheduleSlug:'mikhail-sokolov'}}),db.teacherProfile.findFirstOrThrow({where:{scheduleSlug:'anna-belova'}}),
    db.room.findFirstOrThrow({where:{number:'201'}}),db.room.findFirstOrThrow({where:{number:'304'}}),db.user.findUniqueOrThrow({where:{email:'alexander.smirnov@example.test'}}),
  ]);
  assert(group.departmentId);assert.equal(group.departmentId,group2.departmentId);assert.notEqual(group.departmentId,foreignGroup.departmentId);
  const assignment=await db.deaneryDepartmentAssignment.findUniqueOrThrow({where:{userId_departmentId:{userId:dean.id,departmentId:group.departmentId}}});
  await db.scheduleException.updateMany({data:{isActive:false}});await db.scheduleEntry.updateMany({data:{isDeleted:true}});
  const base={operation:'CREATE',groupIds:[group.id],teacherIds:[teacher.userId],disciplineId:discipline.id,roomId:room.id,termId:term.id,dayOfWeek:1,start:'19:00',end:'20:00',kind:'LECTURE',weekPattern:'NUMERATOR',isPublished:true};
  const save=command=>executeScheduleCommand(db,actor,command);
  const current=id=>db.scheduleEntry.findUniqueOrThrow({where:{id}});
  const read=(week='2026-11-09')=>getPublicScheduleData(db,parseScheduleQuery({group:group.slug,week}));
  const active=model=>model.days.flatMap(d=>d.lessons).filter(l=>!l.change?.cancelled);
  const created=await save(base),entryId=created.objectId;
  assert.equal(active(await read()).length,1);assert.equal(active(await read('2026-11-16')).length,0);
  const denominator=await save({...base,weekPattern:'DENOMINATOR'});
  assert.equal(active(await read('2026-11-16')).length,1);
  await assert.rejects(async()=>save({...base,weekPattern:'EVERY'}),/Преподаватель занят/);
  await save({operation:'DELETE',entryId:denominator.objectId,version:(await current(denominator.objectId)).version,confirmed:true});
  await save({...base,operation:'UPDATE',entryId,version:(await current(entryId)).version,start:'18:00',end:'19:00'});
  await assert.rejects(async()=>save({...base,operation:'UPDATE',entryId,version:1}),/уже изменилось/);
  pass('Regular CRUD and parity',{create:true,update:true,delete:true,numeratorDenominator:true,optimisticVersion:true});

  let changed=await save({...base,operation:'REPLACE',entryId,version:(await current(entryId)).version,sourceDate:'2026-11-09',date:'2026-11-10',teacherIds:[otherTeacher.userId],disciplineId:otherDiscipline.id,roomId:otherRoom.id,start:'18:00',end:'19:00'});
  let model=await read();assert.equal(active(model).length,1);assert.equal(active(model)[0].date,'2026-11-10');assert.equal(active(model)[0].discipline,otherDiscipline.title);assert.equal(active(model)[0].room,otherRoom.number);assert.equal(active(model)[0].teachers[0].slug,otherTeacher.scheduleSlug);
  assert.equal(model.days[0].lessons[0].change.type,'MOVED_FROM');assert.equal(active(await read('2026-11-23'))[0].teachers[0].slug,teacher.scheduleSlug);
  assert.equal(active(await getPersonalScheduleData(db,parseScheduleQuery({week:'2026-11-09'}),{id:student.id,role:'STUDENT'}))[0].date,'2026-11-10');
  assert.equal(active(await getPersonalScheduleData(db,parseScheduleQuery({week:'2026-11-09'}),{id:otherTeacher.userId,role:'TEACHER'}))[0].discipline,otherDiscipline.title);
  await assert.rejects(async()=>save({...base,operation:'UPDATE',entryId,version:(0)}),ScheduleEditError);
  await save({operation:'CANCEL',entryId,exceptionId:changed.objectId,version:(await current(entryId)).version,sourceDate:'2026-11-09',confirmed:true});
  assert.equal(active(await read()).length,0);assert.equal((await read()).days[1].lessons[0].change.type,'CANCELLED');assert.equal((await read()).days[0].lessons[0].change.type,'MOVED_FROM');assert.equal(active(await read('2026-11-23')).length,1);
  const blocker=await save({...base,operation:'EXTRA',date:'2026-11-09',start:'18:00',end:'19:00'});
  await assert.rejects(async()=>save({operation:'RESTORE',entryId,exceptionId:changed.objectId,version:0,confirmed:true}),/уже изменилось/);
  await assert.rejects(async()=>save({operation:'RESTORE',entryId,exceptionId:changed.objectId,version:(await current(entryId)).version,confirmed:true}),/занят/);
  await save({operation:'RESTORE',exceptionId:blocker.objectId,version:1,confirmed:true});
  await save({operation:'RESTORE',entryId,exceptionId:changed.objectId,version:(await current(entryId)).version,confirmed:true});
  assert.equal(active(await read())[0].teachers[0].slug,teacher.scheduleSlug);
  const privateChange=await save({...base,operation:'REPLACE',entryId,version:(await current(entryId)).version,sourceDate:'2026-11-09',date:'2026-11-09',teacherIds:[otherTeacher.userId],start:'18:00',end:'19:00'});
  await db.teacherProfile.update({where:{userId:otherTeacher.userId},data:{isSchedulePublic:false}});
  assert.equal(active(await read()).length,0,'Private replacement must suppress the obsolete public original');
  assert.equal(active(await getPersonalScheduleData(db,parseScheduleQuery({week:'2026-11-09'}),{id:student.id,role:'STUDENT'})).length,1);
  await db.teacherProfile.update({where:{userId:otherTeacher.userId},data:{isSchedulePublic:true}});
  await save({operation:'RESTORE',entryId,exceptionId:privateChange.objectId,version:(await current(entryId)).version,confirmed:true});

  const gridA=await save({...base,operation:'EXTRA',date:'2026-11-11',start:'12:25',end:'13:55'});
  await assert.rejects(()=>save({...base,operation:'EXTRA',date:'2026-11-11',start:'11:50',end:'13:20'}),ScheduleEditError);
  assert.equal(identifyPair(active(await read()).find(l=>l.start==='12:25').start,'13:55').number,3);
  await save({operation:'RESTORE',exceptionId:gridA.objectId,version:1,confirmed:true});
  pass('Different bell grids still conflict on real intervals');
  const extra=await save({...base,operation:'EXTRA',date:'2026-11-11',groupIds:[group.id,group2.id],teacherIds:[teacher.userId,otherTeacher.userId],start:'15:00',end:'16:00'});
  assert.equal((await read()).days[2].lessons.length,1);assert.equal((await read()).days[2].lessons[0].teachers.length,2);
  await assert.rejects(async()=>save({...base,operation:'EXTRA',date:'2026-11-11',groupIds:[group2.id],roomId:otherRoom.id,start:'15:30',end:'16:30'}),/Преподаватель занят/);
  const thirdTeacher=await db.teacherProfile.findFirstOrThrow({where:{scheduleSlug:'elena-morozova'}});
  await assert.rejects(async()=>save({...base,operation:'EXTRA',date:'2026-11-11',groupIds:[group2.id],teacherIds:[thirdTeacher.userId],start:'15:30',end:'16:30'}),/Аудитория занята/);
  await assert.rejects(async()=>save({...base,operation:'EXTRA',date:'2026-11-11',teacherIds:[thirdTeacher.userId],roomId:otherRoom.id,start:'15:30',end:'16:30'}),/группы/);
  await assert.rejects(async()=>save({...base,operation:'EXTRA',date:'2027-01-01'}),/учебный период/);
  await assert.rejects(async()=>save({...base,start:'20:00',end:'19:00'}),/Окончание/);
  await save({operation:'RESTORE',exceptionId:extra.objectId,version:1,confirmed:true});
  const subgroupA=await db.studyGroup.create({data:{slug:'fixture-editor-a',code:'Fixture A',programme:group.programme,course:2,parentId:group.id,departmentId:group.departmentId,isPublic:true}});
  const subgroupB=await db.studyGroup.create({data:{slug:'fixture-editor-b',code:'Fixture B',programme:group.programme,course:2,parentId:group.id,departmentId:group.departmentId,isPublic:true}});
  const thirdRoom=await db.room.findFirstOrThrow({where:{number:'112'}});
  const subA=await save({...base,operation:'EXTRA',date:'2026-11-11',groupIds:[subgroupA.id],start:'17:00',end:'18:00'});
  const subB=await save({...base,operation:'EXTRA',date:'2026-11-11',groupIds:[subgroupB.id],teacherIds:[otherTeacher.userId],roomId:otherRoom.id,start:'17:00',end:'18:00'});
  await assert.rejects(async()=>save({...base,operation:'EXTRA',date:'2026-11-11',teacherIds:[thirdTeacher.userId],roomId:thirdRoom.id,start:'17:00',end:'18:00'}),/группы/);
  await save({operation:'RESTORE',exceptionId:subA.objectId,version:1,confirmed:true});await save({operation:'RESTORE',exceptionId:subB.objectId,version:1,confirmed:true});
  const concurrent=await Promise.allSettled([save({...base,operation:'EXTRA',date:'2026-11-12',start:'14:00',end:'15:00'}),save({...base,operation:'EXTRA',date:'2026-11-12',start:'14:00',end:'15:00'})]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  const concurrentId=concurrent.find(r=>r.status==='fulfilled').value.objectId;
  await save({operation:'RESTORE',exceptionId:concurrentId,version:1,confirmed:true});
  pass('One-off changes and conflicts',{teacherRoomDiscipline:true,move:true,cancellation:true,extra:true,restore:true,otherWeeksPreserved:true,jointParticipants:true,teacherGroupRoomConflicts:true,hierarchyConflictsAndAllowedSiblings:true,privateReplacementBoundary:true,restorationConflict:true,concurrentWrites:true});

  await assert.rejects(async()=>save({...base,groupIds:[foreignGroup.id]}),/полномочий/);
  await assert.rejects(async()=>save({...base,groupIds:[group.id,foreignGroup.id]}),/полномочий/);
  const foreignLesson=await db.lesson.create({data:{disciplineId:discipline.id,kind:'LECTURE',groups:{create:[{groupId:foreignGroup.id},{groupId:group.id}]},teachers:{create:{teacherId:teacher.userId}}}});
  const foreignEntry=await db.scheduleEntry.create({data:{lessonId:foreignLesson.id,termId:term.id,roomId:room.id,dayOfWeek:7,startMinute:600,endMinute:660,isPublished:false}});
  for(const operation of ['UPDATE','DELETE','REPLACE','CANCEL'])await assert.rejects(async()=>save({...base,operation,entryId:foreignEntry.id,version:1,sourceDate:'2026-11-15',date:'2026-11-15',confirmed:true}),/полномочий/);
  const foreignException=await db.scheduleException.create({data:{entryId:foreignEntry.id,sourceDate:new Date('2026-11-15'),date:new Date('2026-11-15'),lessonId:foreignLesson.id,termId:term.id,roomId:room.id,startMinute:600,endMinute:660,isCancelled:true}});
  await assert.rejects(async()=>save({operation:'DELETE',entryId,exceptionId:foreignException.id,version:(await current(entryId)).version,confirmed:true}),/регулярную пару/);
  await assert.rejects(async()=>save({operation:'RESTORE',entryId:foreignEntry.id,exceptionId:foreignException.id,version:1,confirmed:true}),/полномочий/);
  await assert.rejects(()=>getScheduleEditor(db,actor,foreignGroup.slug,new Date('2026-11-09')),DeaneryAccessDenied);
  await assert.rejects(()=>executeScheduleCommand(db,{id:dean.id,role:'ADMIN'},base),DeaneryAccessDenied);
  await save({operation:'DELETE',entryId,version:(await current(entryId)).version,confirmed:true});
  await db.scheduleEntry.update({where:{id:foreignEntry.id},data:{isDeleted:true}});
  assert(await db.scheduleAudit.count({where:{actorId:dean.id}})>0);
  pass('Scope and audit',{foreignAndJointDenied:true,forgedRoleDenied:true,privateAudit:true});

  const password=randomBytes(24).toString('base64url');await db.account.updateMany({where:{providerId:'credential'},data:{password:await hashPassword(password)}});
  // Additional timetable teachers deliberately have no login in the source DB.
  // Give the replacement teacher temporary credentials only in this test copy.
  await db.account.upsert({where:{providerId_accountId:{providerId:'credential',accountId:otherTeacher.userId}},update:{password:await hashPassword(password)},create:{providerId:'credential',accountId:otherTeacher.userId,userId:otherTeacher.userId,password:await hashPassword(password)}});
  const baseUrl='http://127.0.0.1:3230';
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3230'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',BETTER_AUTH_URL:baseUrl,BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),AUTH_TRUST_PROXY:'false',AUTH_PROXY_SECRET:''}});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  let ready=false;for(let n=0;n<50;n++){try{if((await fetch(baseUrl+'/api/auth/get-session')).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,200));}assert(ready);
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(/Blocking Route|Instant validation|Next.js encountered/.test(message.text()))warnings.push(message.text());});
  await page.goto(baseUrl+'/login');await page.getByLabel(/email/i).fill(dean.email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти в кабинет',exact:true}).click();await page.waitForURL(baseUrl+'/deanery');
  const editorUrl=baseUrl+'/deanery/schedule?group='+group.slug+'&week=2026-11-09';await page.goto(editorUrl);
  const dialog=page.getByRole('dialog',{name:'Редактор занятия'});
  const addTrigger=page.getByRole('button',{name:'Добавить регулярную пару',exact:true});
  await addTrigger.focus();await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(addTrigger).toBeFocused();

  await addTrigger.click();
  const timeMode=dialog.locator('select').filter({has:page.locator('option[value=custom]')});
  const gridSelect=dialog.locator('select').filter({has:page.locator('option[value=A]')});
  const pairSelect=dialog.locator('select[id$="-pair"]');
  for(const grid of bellGrids){
    await gridSelect.selectOption(grid.id);
    for(const pair of grid.pairs){
      await pairSelect.selectOption(String(pair.number));
      await expect(dialog.locator('input[name=start]')).toHaveValue(pair.start);
      await expect(dialog.locator('input[name=end]')).toHaveValue(pair.end);
      await expect(dialog.locator('input[name=start]')).toHaveAttribute('readonly','');
    }
  }
  await timeMode.selectOption('custom');
  await dialog.locator('input[name=start]').fill('09:17');
  await dialog.locator('input[name=end]').fill('10:43');
  await timeMode.selectOption('standard');await timeMode.selectOption('custom');
  await expect(dialog.locator('input[name=start]')).toHaveValue('09:17');
  await expect(dialog.locator('input[name=end]')).toHaveValue('10:43');
  await page.keyboard.press('Escape');
  pass('Bell editor presets and preserved manual draft',{allFourteen:true});
  async function fillRegular(p,teacherName=teacher.publicName){const d=p.getByRole('dialog',{name:'Редактор занятия'});await d.getByLabel(teacherName,{exact:true}).check();await d.getByRole('combobox',{name:'Дисциплина',exact:true}).selectOption({label:discipline.title});await d.getByRole('combobox',{name:'Корпус и аудитория',exact:true}).selectOption(room.id);await d.getByRole('combobox',{name:'Учебный период',exact:true}).selectOption(term.id);await d.locator('select').filter({has:p.locator('option[value=custom]')}).selectOption('custom');await d.getByLabel('Начало',{exact:true}).fill('18:00');await d.getByLabel('Окончание',{exact:true}).fill('19:00');}
  async function submit(p,confirm=false){const d=p.getByRole('dialog',{name:'Редактор занятия'});if(confirm)await d.getByLabel('Подтверждаю действие').check();await d.getByRole('button',{name:confirm?'Подтвердить':'Сохранить занятие',exact:true}).click();await expect(d.locator('.editor-success')).toContainText('сохранен');await d.getByRole('button',{name:'Закрыть форму',exact:true}).click();await expect(d).toBeHidden();}
  const api=()=>context.request.get(baseUrl+'/api/v1/schedule?group='+group.slug+'&week=2026-11-09');
  await api(); // Warm cache before a write; the next request must see the new revision.
  await page.getByRole('button',{name:'Добавить регулярную пару',exact:true}).click();await fillRegular(page);await dialog.getByLabel('День недели',{exact:true}).selectOption('2');
  await dialog.locator('input[name=groupIds]:checked').evaluate((input,id)=>{input.value=id;},foreignGroup.id);
  await dialog.getByRole('button',{name:'Сохранить занятие',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('полномочий');
  await expect(dialog.getByLabel('Начало',{exact:true})).toHaveValue('18:00');
  await dialog.locator('input[name=groupIds]:checked').evaluate((input,id)=>{input.value=id;},group.id);
  await submit(page);
  let uiPair=page.locator('.editor-pair').filter({has:page.locator('h4',{hasText:discipline.title})});await expect(uiPair).toHaveCount(1);
  let data=await(await api()).json();assert.equal(data.data.days[1].lessons[0].discipline,discipline.title);
  await uiPair.getByRole('button',{name:'Создать разовую замену',exact:true}).click();await expect(dialog.locator('select').filter({has:page.locator('option[value=custom]')})).toHaveValue('custom');await expect(dialog.locator('input[name=start]')).toHaveValue('18:00');await dialog.getByLabel(teacher.publicName,{exact:true}).uncheck();await dialog.getByLabel(otherTeacher.publicName,{exact:true}).check();await dialog.getByRole('combobox',{name:'Корпус и аудитория',exact:true}).selectOption(otherRoom.id);await dialog.getByRole('combobox',{name:'Дисциплина',exact:true}).selectOption(otherDiscipline.id);await submit(page);
  data=await(await api()).json();assert.equal(data.data.days[1].lessons[0].teachers[0].slug,otherTeacher.scheduleSlug);assert.equal(data.data.days[1].lessons[0].change.type,'REPLACED');
  for(const [email,home]of[[student.email,'/dashboard'],['anna.belova@example.test','/teacher']]){const privateContext=await browser.newContext();await privateContext.request.post(baseUrl+'/api/auth/sign-in/email',{headers:{Origin:baseUrl},data:{email,password}});const personal=await privateContext.request.get(baseUrl+home+'/schedule?week=2026-11-09');assert((await personal.text()).includes(otherDiscipline.title));await privateContext.close();}
  const publicPage=await context.request.get(baseUrl+'/schedule?group='+group.slug+'&week=2026-11-09');assert((await publicPage.text()).includes('Разовая замена'));
  uiPair=page.locator('.editor-pair').filter({has:page.locator('h4',{hasText:otherDiscipline.title})});await uiPair.getByRole('button',{name:'Отменить занятие на дату',exact:true}).click();await submit(page,true);data=await(await api()).json();assert.equal(data.data.days[1].lessons[0].change.cancelled,true);
  uiPair=page.locator('.editor-pair').filter({has:page.locator('.schedule-cancelled')});await uiPair.getByRole('button',{name:'Восстановить исходное занятие',exact:true}).click();await submit(page,true);data=await(await api()).json();assert(!data.data.days[1].lessons[0].change);
  await page.screenshot({path:resolve(root,'desktop-editor.png'),fullPage:true});
  const mobile=await browser.newContext({storageState:await context.storageState(),viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});const phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto(editorUrl);
  await phone.getByRole('button',{name:'Добавить разовую пару',exact:true}).tap();await fillRegular(phone,otherTeacher.publicName);const phoneDialog=phone.getByRole('dialog',{name:'Редактор занятия'});await phoneDialog.getByLabel('Дата разового занятия',{exact:true}).fill('11.11.2026');await phoneDialog.getByLabel('Начало',{exact:true}).fill('16:00');await phoneDialog.getByLabel('Окончание',{exact:true}).fill('17:00');await phoneDialog.locator('select[id$="-mode"]').selectOption('standard');await phoneDialog.locator('select[id$="-pair"]').selectOption('5');await expect(phoneDialog.locator('input[name=start]')).toHaveValue('15:55');await phone.screenshot({path:resolve(root,'mobile-form.png'),fullPage:true});await submit(phone);
  await expect(phone.locator('.schedule-change-label',{hasText:'Дополнительная пара'})).toBeVisible();assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await expect(phone.locator('.public-lesson-tags').filter({hasText:'5-'})).toHaveCount(1);
  const mobilePair=phone.locator('.editor-pair').filter({has:phone.locator('.schedule-change-label',{hasText:'Дополнительная пара'})});await mobilePair.getByRole('button',{name:'Удалить разовую пару',exact:true}).tap();await submit(phone,true);
  await mobile.close();
  await page.getByText('Все регулярные пары выбранной группы',{exact:true}).click();await page.locator('.editor-template').getByRole('button',{name:'Удалить',exact:true}).click();await submit(page,true);assert.equal((await(await api()).json()).data.days.flatMap(d=>d.lessons).length,0);
  // Save standard times through the real form, reopen, and propagate a replacement.
  await addTrigger.click();await fillRegular(page);
  await dialog.locator('select[id$="-mode"]').selectOption('standard');
  await dialog.locator('select[id$="-grid"]').selectOption('B');
  await dialog.locator('select[id$="-pair"]').selectOption('3');
  await submit(page);
  const standardPair=page.locator('.editor-pair').filter({has:page.locator('h4',{hasText:discipline.title})});
  await expect(standardPair.locator('.public-lesson-tags')).toContainText('3-\u044f \u043f\u0430\u0440\u0430');
  await standardPair.locator('.editor-pair-actions button').first().click();
  await expect(dialog.locator('select[id$="-mode"]')).toHaveValue('standard');
  await expect(dialog.locator('select[id$="-grid"]')).toHaveValue('B');
  await expect(dialog.locator('input[name=start]')).toHaveValue('11:50');
  await page.keyboard.press('Escape');
  await standardPair.locator('.editor-pair-actions button').nth(1).click();
  await dialog.locator('select[id$="-grid"]').selectOption('A');
  await submit(page);
  let standardData=await(await api()).json();
  assert.equal(standardData.data.days[0].lessons[0].start,'12:25');
  assert.equal(standardData.data.days[0].lessons[0].end,'13:55');
  for(const [email,home]of[[student.email,'/dashboard'],['mikhail.sokolov@example.test','/teacher']]){
    const viewer=await browser.newContext();await viewer.request.post(baseUrl+'/api/auth/sign-in/email',{headers:{Origin:baseUrl},data:{email,password}});
    const response=await viewer.request.get(baseUrl+home+'/schedule?week=2026-11-09');
    assert((await response.text()).replace(/<!--.*?-->|<[^>]*>/g,'').includes('3-\u044f \u043f\u0430\u0440\u0430') && (await response.text()).includes('12:25'));
    await viewer.close();
  }
  const rendered=await context.request.get(baseUrl+'/schedule?group='+group.slug+'&week=2026-11-09');
  assert((await rendered.text()).replace(/<!--.*?-->|<[^>]*>/g,'').includes('3-\u044f \u043f\u0430\u0440\u0430') && (await rendered.text()).includes('12:25'));
  await page.screenshot({path:resolve(root,'desktop-standard-pair.png'),fullPage:true});
  await standardPair.locator('.editor-pair-actions button').first().click();
  await dialog.locator('select[id$="-grid"]').selectOption('A');
  await expect(dialog.locator('input[name=start]')).toHaveValue('12:25');
  await page.screenshot({path:resolve(root,'desktop-standard-form.png'),fullPage:true});
  await page.keyboard.press('Escape');
  pass('Standard save, reopen and one-off replacement across all schedule views',{regularB:true,replacementA:true,publicStudentTeacherEditor:true});

  await page.getByRole('button',{name:'Добавить регулярную пару',exact:true}).click();await fillRegular(page);await db.deaneryDepartmentAssignment.delete({where:{userId_departmentId:{userId:assignment.userId,departmentId:assignment.departmentId}}});await dialog.getByRole('button',{name:'Сохранить занятие',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('полномочий');
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.equal(await fingerprint(),before);
  pass('Competition workflow and shared output',{desktopCreateReplaceCancelRestoreDelete:true,mobileExtra:true,keyboardAndFocus:true,tamperedFormGroupDenied:true,inputPreservedAfterError:true,noCodeOrIdsRequired:true,studentTeacherPublicApi:true,cacheRevisionImmediate:true,liveAssignmentRevocation:true,browserErrors:0,sourceUnchanged:true});
}finally{await browser?.close();child?.kill();await db.$disconnect();source.close();writeFileSync(resolve(root,'results.json'),JSON.stringify(results,null,2));writeFileSync(resolve(root,'server.log'),logs,{mode:0o600});console.info('Editor report: '+root.replaceAll('\\','/')+'/results.json');}
