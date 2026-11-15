import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createClient } from '@libsql/client';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { provisionTestDatabase } from './test-fixtures.mjs';
import { fingerprint, integrity } from './database-snapshot.mjs';
import { seedBrsDemo } from '../prisma/brs-demo.ts';
import { getBrsWorkspace, serializeWorkspace, calculateStudent, planInclude } from '../src/lib/brs-repository.ts';
import { executeBrsCommand } from '../src/lib/brs-commands.ts';
import { template, distribute, parsePoints, finalRating, gradeFor, completion, calculateBrs } from '../src/lib/brs-rules.ts';
import { executeScheduleCommand } from '../src/lib/schedule-editor-repository.ts';
import { verifyRefinementRules } from './brs-refinement-checks.mjs';
import { points } from '../src/lib/brs-rules.ts';

mkdirSync('.local',{recursive:true});
const root=mkdtempSync(resolve('.local/brs-test-')), source=createClient({url:getDatabaseUrl()}), before=await fingerprint(source);
process.once('exit',code=>console.info('BRS verification process exit: '+code));
const env=provisionTestDatabase(resolve(root,'test.db')); process.env.DATABASE_URL=env.DATABASE_URL;
const db=createPrismaClient(), results=[], errors=[], diagnostics=[]; let browser, child, logs='';
const pass=(name,evidence={})=>{results.push({name,...evidence}); console.info('PASS: '+name);};
const reject=async(fn,pattern)=>assert.rejects(fn,pattern);
const user=email=>db.user.findUniqueOrThrow({where:{email:email+'@example.test'}});
const full=id=>db.brsPlan.findUniqueOrThrow({where:{id},include:planInclude});
async function actor(user){const session=await db.session.create({data:{userId:user.id,token:randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+3600000)}});return{id:user.id,role:user.role,sessionId:session.id};}
async function command(actor,planId,values){
  // Explicit fixture input scales for NEW results; persisted legacy rows stay legacy.
  if(values.operation==='RESULT'&&planId){
    const plan=await full(planId),event=plan.modules.flatMap(item=>item.events).find(item=>item.id===values.eventId);
    const old=event&&await db.brsResult.findUnique({where:{eventId_studentId:{eventId:event.id,studentId:values.studentId}}});
    if(event?.kind==='SEMINAR'){
      const attendance=await db.brsAttendance.findUnique({where:{occurrenceId_studentId:{occurrenceId:event.occurrenceId,studentId:values.studentId}}});
      values={...values,operation:'ATTENDANCE',occurrenceId:event.occurrenceId,version:attendance?.version??0,mark:values.score? 'ACTIVE':'PRESENT'};
    }else if(event&&(!old||old.primaryMax!==null)&&values.scoringMode===undefined){
      if(!event.primaryMax)await executeBrsCommand(db,actor,{operation:'PRIMARY_SCALE',requestId:randomUUID(),planId,revision:plan.revision,eventId:event.id,scaleVersion:event.scaleVersion,primaryMax:event.maxScore,confirmed:true,reason:'Явная шкала новых изолированных тестовых результатов'});
      values={...values,scoringMode:'PRIMARY',primaryScore:values.score};
    }
    if(event?.kind==='HOMEWORK'&&values.submissionTiming===undefined)values={...values,submissionTiming:'ON_TIME'};
  }
  return executeBrsCommand(db,actor,{requestId:randomUUID(),planId,revision:planId?(await full(planId)).revision:undefined,...values});
}
async function model(actor,planId){return serializeWorkspace(await getBrsWorkspace(db,actor,planId));}
try {
  for(const control of ['CREDIT','DIFFERENTIATED','EXAM','DISTRIBUTED'])for(const count of [2,3]){
    const items=template(control,count);assert.equal(items.reduce((sum,m)=>sum+m.seminarMax+m.workMax+m.controlMax,control==='EXAM'?3000:0),10000);
    assert.equal(items.length,count);for(const m of items)assert(Number.isInteger(m.controlMax/2));
  }
  assert.deepEqual(distribute(600,5),[120,120,120,120,120]);assert.equal(distribute(1000,17).reduce((a,b)=>a+b),1000);
  for(const [score,rating,grade]of[[8420,85,'5'],[7010,71,'4'],[4901,50,'3'],[4900,49,'2'],[10000,100,'5']]){assert.equal(finalRating(score),rating);assert.equal(gradeFor('EXAM',rating),grade);}
  assert.equal(gradeFor('CREDIT',finalRating(5910)),'Зачёт');assert.equal(gradeFor('CREDIT',59),'Незачёт');
  assert.equal(parsePoints('7,50'),750);assert.equal(parsePoints('0.01'),1);for(const value of ['-1','1.001','NaN','101'])assert.throws(()=>parsePoints(value));
  const hw={id:'hw',title:'ДЗ',kind:'HOMEWORK',required:true,maxScore:2200,labMinScore:null,labRequiresDefense:true};
  assert.equal(completion(hw),'PENDING');assert.equal(completion({...hw,result:{score:0,passed:null,labStatus:null,deleted:false,submittedOn:'2026-01-01',checkedOn:'2026-01-02'}}),'FAILED');
  assert.equal(completion({...hw,result:{score:1100,passed:null,labStatus:null,deleted:false,submittedOn:'2026-01-01',checkedOn:'2026-01-02'}}),'MET');
  const calc=calculateBrs('CREDIT',[{id:'m',number:1,state:'CLOSED',seminarMax:0,workMax:2200,controlMax:0,events:[hw]}],[],null);assert.equal(calc.total,0);assert.equal(calc.missing,1);assert.equal(calc.ready,false);
  pass('All controls, templates, exact arithmetic, thresholds and missing versus zero');
  await seedBrsDemo(db);
  const fixtureClient=createClient({url:env.DATABASE_URL});
  try {const seedFingerprint=await fingerprint(fixtureClient);await seedBrsDemo(db);assert.equal(await fingerprint(fixtureClient),seedFingerprint);} finally {fixtureClient.close();}
  const [t,d,a,m,admin,staff]=await Promise.all([user('mikhail.sokolov'),user('olga.kuznetsova'),user('alexander.smirnov'),user('maria.volkova'),user('irina.lebedeva'),user('sergey.petrov')]);
  const teacher=await actor(t),dean=await actor(d),alex=await actor(a),maria=await actor(m);
  const plans=await db.brsPlan.findMany({include:{discipline:true}}),exam=plans.find(p=>p.control==='EXAM'),credit=plans.find(p=>p.control==='CREDIT'),rex=plans.find(p=>p.control==='DISTRIBUTED'),diff=plans.find(p=>p.control==='DIFFERENTIATED');
  assert(exam.publishedAt&&credit.publishedAt&&rex.publishedAt);assert.equal(diff.publishedAt,null);
  const own=await model(alex,credit.id);assert.equal(own.selected.students.length,1);assert.equal(own.selected.students[0].id,a.id);assert(!JSON.stringify(await model(maria,credit.id)).includes('приватный комментарий'));assert(!JSON.stringify(await model(dean,credit.id)).includes('приватный комментарий'));
  for(const u of [admin,staff])await reject(()=>getBrsWorkspace(db,u),/Доступ закрыт/);
  await reject(()=>command(alex,credit.id,{operation:'RESULT'}),/только просмотр/);
  await reject(()=>command(teacher,exam.id,{operation:'CONFIRM',studentId:a.id,version:1,reason:'Проверка запрета'}),/недоступна вашей роли/);
  await reject(()=>command(dean,exam.id,{operation:'RESULT',studentId:a.id,eventId:(own.selected.modules[0].events[0].id),score:0}),/недоступна вашей роли|Мероприятие/);
  const emptyDeanUser=await db.user.create({data:{name:'Изолированный деканат',email:'empty-dean@example.test',role:'DEANERY_STAFF',deaneryStaffProfile:{create:{}}}}),emptyDean=await actor(emptyDeanUser);
  assert.equal((await model(emptyDean)).catalog.groups.length,0);await reject(()=>getBrsWorkspace(db,emptyDean,exam.id),/недоступен/);
  const assignment=await db.teachingAssignment.findFirstOrThrow({where:{teacherId:t.id,disciplineId:exam.disciplineId,groupId:exam.groupId}});
  await command(dean,undefined,{operation:'REVOKE_ASSIGN',assignmentId:assignment.id,version:assignment.version,reason:'Проверка отзыва полномочий'});
  await reject(()=>getBrsWorkspace(db,teacher,exam.id),/недоступен|назначение/);
  await command(dean,undefined,{operation:'ASSIGN',groupId:exam.groupId,disciplineId:exam.disciplineId,termId:exam.termId,teacherId:t.id,version:assignment.version+1,reason:'Восстановление тестового назначения'});
  pass('Five roles, private comments, empty deanery and live teaching authority');
  // Build an actual isolated timetable for the missing demo subject, then use
  // the same authoring and publication operations as the deanery UI.
  const room=await db.room.findFirstOrThrow();
  await executeScheduleCommand(db,dean,{operation:'CREATE',groupIds:[diff.groupId],teacherIds:[t.id],disciplineId:diff.disciplineId,roomId:room.id,termId:diff.termId,dayOfWeek:4,start:'20:00',end:'21:00',kind:'PRACTICE',weekPattern:'EVERY',isPublished:true});
  await command(dean,diff.id,{operation:'SYNC',reason:'Согласование изолированного тестового календаря'});
  let diffPlan=await full(diff.id);
  const diffSchedule=(await model(dean,diff.id)).selected.schedule;
  for(const brsModule of diffPlan.modules)for(const event of brsModule.events){
    const pair=diffSchedule.find(pair=>!pair.cancelled&&pair.week===event.week);
    const occurrence=diffPlan.occurrences.find(item=>item.sourceKey===pair.sourceKey);
    await command(dean,diff.id,{operation:'EDIT_EVENT',eventId:event.id,title:event.title,week:pair.week,plannedOn:pair.date,issuedOn:event.kind==='HOMEWORK'?pair.date:null,deadline:event.kind==='HOMEWORK'?pair.date:null,occurrenceId:event.kind==='HOMEWORK'?'':occurrence.id,maxScore:event.maxScore,required:true,labMinScore:null,labRequiresDefense:true});
  }
  diffPlan=await full(diff.id);const draftHW=diffPlan.modules[0].events.find(e=>e.kind==='HOMEWORK');
  const edit={operation:'EDIT_EVENT',eventId:draftHW.id,title:draftHW.title,week:draftHW.week,plannedOn:draftHW.plannedOn.toISOString().slice(0,10),issuedOn:draftHW.issuedOn.toISOString().slice(0,10),deadline:draftHW.deadline.toISOString().slice(0,10),maxScore:draftHW.maxScore-1,required:true};
  await command(dean,diff.id,edit);await reject(()=>command(dean,diff.id,{operation:'PUBLISH'}),/общему фонду/);await command(dean,diff.id,{...edit,maxScore:draftHW.maxScore});
  await command(dean,diff.id,{operation:'PUBLISH'});diffPlan=await full(diff.id);
  await reject(()=>command(dean,diff.id,{...edit,maxScore:draftHW.maxScore}),/неизменяем/);
  for(const brsModule of diffPlan.modules){
    await reject(()=>command(teacher,diff.id,{operation:'MODULE_STATE',moduleId:brsModule.id,state:'CLOSED'}),/автоматически/);
    for(const event of brsModule.events){await command(teacher,diff.id,{operation:'RESULT',studentId:a.id,eventId:event.id,version:0,score:event.maxScore,passed:['INTERIM','FINAL'].includes(event.kind)?true:null,submittedOn:event.kind==='HOMEWORK'?event.deadline.toISOString().slice(0,10):null,checkedOn:event.kind==='HOMEWORK'?event.deadline.toISOString().slice(0,10):null});if(event.kind==='FINAL')await command(teacher,diff.id,{operation:'RESULT',studentId:m.id,eventId:event.id,version:0,score:0,passed:false});}
    assert((await calculateStudent(db,await full(diff.id),a.id)).calculation.modules.find(item=>item.id===brsModule.id).complete);
  }
  await command(teacher,diff.id,{operation:'FINALIZE',studentId:a.id,version:0});assert.equal((await model(alex,diff.id)).selected.students[0].official.grade,'5');
  const english=await db.discipline.findUniqueOrThrow({where:{code:'english'}});
  await command(dean,undefined,{operation:'ASSIGN',groupId:exam.groupId,disciplineId:english.id,termId:exam.termId,teacherId:t.id});
  const exam2=await command(dean,undefined,{operation:'CREATE_PLAN',groupId:exam.groupId,disciplineId:english.id,termId:exam.termId,control:'EXAM',moduleCount:2});
  await command(dean,exam2.planId,{operation:'PUBLISH'});assert.equal((await full(exam2.planId)).modules.reduce((sum,item)=>sum+item.workMax+item.controlMax+item.seminarMax,0),7000);
  pass('Deanery authoring, shared work fund, calendar validation, all four published controls and final approval');
  let current=(await model(teacher,exam.id)).selected.students.find(s=>s.id===a.id);
  await command(dean,exam.id,{operation:'REVOKE',studentId:a.id,version:current.admission.version,reason:'Проверка аудируемого отзыва'});
  assert.equal((await model(alex,exam.id)).selected.students[0].calculation.admissionStatus,'Ожидает подтверждения деканата');
  await reject(()=>command(teacher,exam.id,{operation:'ATTEMPT',studentId:a.id,score:2000,passed:true,heldOn:'2026-12-30',version:0}),/Экзамен недоступен/);
  current=(await model(teacher,exam.id)).selected.students.find(s=>s.id===a.id);
  await command(dean,exam.id,{operation:'CONFIRM',studentId:a.id,version:current.admission.version,reason:'Академические условия проверены'});
  const homework=(await full(exam.id)).modules[0].events.find(e=>e.kind==='HOMEWORK');
  let old=await db.brsResult.findUniqueOrThrow({where:{eventId_studentId:{eventId:homework.id,studentId:a.id}}});
  const oldValues={score:old.score,passed:old.passed,submittedOn:old.submittedOn?.toISOString().slice(0,10),checkedOn:old.checkedOn?.toISOString().slice(0,10),comment:old.comment,commentVisible:old.commentVisible};
  await command(teacher,exam.id,{operation:'RESULT',studentId:a.id,eventId:homework.id,version:old.version,...oldValues,score:100});
  current=(await model(alex,exam.id)).selected.students[0];assert.equal(current.admission.approved,false);assert.equal(current.calculation.admissionStatus,'Не допущен');assert.equal(current.attempts.length,1,'Old attempt must survive invalidation');
  await reject(()=>command(dean,exam.id,{operation:'CONFIRM',studentId:a.id,version:current.admission.version,reason:'Недопустимый обход условий'}),/условия не выполнены/);
  old=await db.brsResult.findUniqueOrThrow({where:{id:old.id}});await command(teacher,exam.id,{operation:'RESULT',studentId:a.id,eventId:homework.id,version:old.version,...oldValues});
  current=(await model(alex,exam.id)).selected.students[0];assert.equal(current.calculation.admissionStatus,'Ожидает подтверждения деканата');
  const stale=(await full(exam.id)).revision,confirmation={operation:'CONFIRM',studentId:a.id,version:current.admission.version,reason:'Проверка гонки подтверждения',revision:stale};
  old=await db.brsResult.findUniqueOrThrow({where:{id:old.id}});await command(teacher,exam.id,{operation:'RESULT',studentId:a.id,eventId:homework.id,version:old.version,...oldValues});
  await reject(()=>command(dean,exam.id,confirmation),/Данные изменились/);
  current=(await model(alex,exam.id)).selected.students[0];await command(dean,exam.id,{operation:'CONFIRM',studentId:a.id,version:current.admission.version,reason:'Свежая проверка академических условий'});
  const admissionVersion=(await model(alex,exam.id)).selected.students[0].admission.version;
  old=await db.brsResult.findUniqueOrThrow({where:{id:old.id}});await command(teacher,exam.id,{operation:'RESULT',studentId:a.id,eventId:homework.id,version:old.version,...oldValues,score:oldValues.score-1});
  current=(await model(alex,exam.id)).selected.students[0];assert.equal(current.admission.approved,true);assert.equal(current.admission.version,admissionVersion,'Still-met conditions retain admission');
  await reject(()=>command(teacher,exam.id,{operation:'ATTEMPT',studentId:a.id,score:3001,passed:true,heldOn:'2026-12-30',version:0}),/диапазона/);
  const duplicate={operation:'ATTEMPT',requestId:randomUUID(),studentId:a.id,score:2600,passed:true,heldOn:'2026-12-30',version:0,revision:(await full(exam.id)).revision};
  const saved=await command(teacher,exam.id,duplicate);assert.equal((await command(teacher,exam.id,duplicate)).objectId,saved.objectId);
  await reject(()=>command(teacher,exam.id,{...duplicate,score:2400}),/Ключ запроса/);
  assert.equal((await db.brsExamAttempt.findMany({where:{planId:exam.id,studentId:a.id}})).length,2);
  pass('Two-stage admission, invalidation, retained history, stale confirmation and 70+30');
  const firstOccurrence=(await full(exam.id)).occurrences[0], totalBeforeAttendance=(await calculateStudent(db,await full(exam.id),a.id)).calculation.total;
  for(const mark of ['PRESENT','ACTIVE','SICK','ABSENT','EXCUSED',null]){
    const oldAttendance=await db.brsAttendance.findUnique({where:{occurrenceId_studentId:{occurrenceId:firstOccurrence.id,studentId:a.id}}});
    await command(teacher,exam.id,{operation:'ATTENDANCE',studentId:a.id,occurrenceId:firstOccurrence.id,version:oldAttendance?.version??0,mark});
  }
  assert.equal((await calculateStudent(db,await full(exam.id),a.id)).calculation.total,totalBeforeAttendance);
  const secondTeacher=await actor(await user('anna.belova'));
  await command(dean,undefined,{operation:'ASSIGN',groupId:exam.groupId,disciplineId:exam.disciplineId,termId:exam.termId,teacherId:secondTeacher.id});
  const protectedRecord=await db.brsResult.findUniqueOrThrow({where:{id:old.id}});
  await reject(()=>command(secondTeacher,exam.id,{operation:'RESULT',studentId:a.id,eventId:homework.id,version:protectedRecord.version,score:0}),/чужую запись/);
  pass('Every attendance mark including empty, no automatic points and foreign-author protection');
  const rexPlan=await full(rex.id),last=rexPlan.modules.at(-1).events.find(e=>e.kind==='FINAL');
  const mariaRex=await calculateStudent(db,rexPlan,m.id);assert.notEqual(mariaRex.calculation.academic.state,'MET');
  await reject(()=>command(teacher,rex.id,{operation:'RESULT',studentId:m.id,eventId:last.id,version:mariaRex.results.find(r=>r.eventId===last.id)?.version??0,score:500,passed:true,reason:'Проверка запрета последнего РК'}),/К последнему РК не допущен/);
  await command(teacher,rex.id,{operation:'ATTEMPT',studentId:m.id,score:600,passed:true,heldOn:'2026-12-30',version:0});
  let rexResult=(await calculateStudent(db,await full(rex.id),m.id)).calculation;assert.equal(rexResult.examScore,600);assert(rexResult.debts.length>0);assert.equal(rexResult.sessionRequired,false);assert(rexResult.total<=10000);
  assert.equal(rexResult.modules.reduce((sum,item)=>sum+item.score,0),rexResult.total,'Module totals must use the same distributed-exam replacement');
  await reject(()=>command(teacher,rex.id,{operation:'ATTEMPT',studentId:m.id,score:last.maxScore+1,passed:true,heldOn:'2026-12-30',version:0}),/диапазона/);
  await command(teacher,rex.id,{operation:'ATTEMPT',studentId:m.id,score:550,passed:true,heldOn:'2026-12-30',version:0});
  assert.equal((await calculateStudent(db,await full(rex.id),m.id)).calculation.examScore,600);
  pass('Distributed exam replaces last control, same maximum, best attempt and independent debts');
  const creditPlan=await full(credit.id),event=creditPlan.modules[0].events.find(e=>e.kind==='INTERIM');
  let record=await db.brsResult.findUniqueOrThrow({where:{eventId_studentId:{eventId:event.id,studentId:a.id}}});
  await reject(()=>command(teacher,credit.id,{operation:'RESULT',studentId:a.id,eventId:event.id,score:event.maxScore+1,version:record.version,reason:'Проверка максимума'}),/диапазона/);
  await reject(()=>command(teacher,credit.id,{operation:'RESULT',studentId:a.id,eventId:event.id,score:0,version:record.version}),/причину изменения/);
  const concurrency={operation:'RESULT',studentId:a.id,eventId:event.id,version:record.version,score:50,reason:'Контролируемая коррекция закрытого модуля',revision:(await full(credit.id)).revision};
  const races=await Promise.allSettled([command(teacher,credit.id,concurrency),command(teacher,credit.id,{...concurrency,score:60})]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await model(alex,credit.id)).selected.students[0].official.needsReview,true);
  record=await db.brsResult.findUniqueOrThrow({where:{id:record.id}});
  await command(teacher,credit.id,{operation:'DELETE_RESULT',studentId:a.id,eventId:event.id,version:record.version,confirmed:true,reason:'Проверка мягкого удаления'});
  const deleted=await db.brsResult.findUniqueOrThrow({where:{id:record.id}});assert(deleted.deleted);
  await command(teacher,credit.id,{operation:'RESULT',studentId:a.id,eventId:event.id,version:deleted.version,score:10,reason:'Восстановление собственной записи'});
  assert.equal((await db.brsResult.findUniqueOrThrow({where:{id:record.id}})).deleted,false);
  assert(await db.brsAudit.count({where:{planId:credit.id,action:'DELETE_RESULT'}}));
  const otherGroup=await db.studyGroup.findUniqueOrThrow({where:{slug:'pi-24-2'}});
  await db.studentProfile.update({where:{userId:a.id},data:{groupId:otherGroup.id}});
  assert((await model(alex,credit.id)).selected.students[0].former);
  const unused=creditPlan.modules[1].events.find(e=>e.kind==='HOMEWORK');await db.brsResult.deleteMany({where:{studentId:a.id,eventId:unused.id}});
  await reject(()=>command(teacher,credit.id,{operation:'RESULT',studentId:a.id,eventId:unused.id,occurrenceId:event.occurrenceId,version:0,score:0,reason:'Проверка подмены исторической записи'}),/не входит/);
  await command(teacher,credit.id,{operation:'RESULT',studentId:a.id,eventId:event.id,version:deleted.version+1,score:11,reason:'Коррекция исторической записи после перевода'});
  assert(!(await model(dean,credit.id)).selected.students.some(s=>s.id===a.id));
  await db.studentProfile.update({where:{userId:a.id},data:{groupId:credit.groupId}});
  pass('Closed-module corrections, soft deletion, audit, concurrency, official review and transfer');
  // Timetable movement preserves the stable source key and frozen maxima.
  const occurrence=creditPlan.occurrences.find(o=>o.id===event.occurrenceId),parts=occurrence.sourceKey.split(':'),entryId=parts[1],sourceDate=parts[2];
  const entry=await db.scheduleEntry.findUniqueOrThrow({where:{id:entryId},include:{lesson:{include:{groups:true,teachers:true}}}});
  const movedDate=new Date(sourceDate);movedDate.setUTCDate(movedDate.getUTCDate()+1);
  const change=await executeScheduleCommand(db,dean,{operation:'REPLACE',entryId,version:entry.version,sourceDate,date:movedDate.toISOString().slice(0,10),groupIds:entry.lesson.groups.map(g=>g.groupId),teacherIds:entry.lesson.teachers.map(t=>t.teacherId),disciplineId:entry.lesson.disciplineId,roomId:entry.roomId,termId:entry.termId,start:'20:00',end:'21:00',kind:entry.lesson.kind,weekPattern:entry.weekPattern,isPublished:true});
  const moved=(await model(teacher,credit.id)).selected.occurrences.find(o=>o.id===occurrence.id);assert.equal(moved.actualDate,movedDate.toISOString().slice(0,10));assert.equal((await full(credit.id)).modules[0].events.find(e=>e.id===event.id).maxScore,event.maxScore);
  await executeScheduleCommand(db,dean,{operation:'CANCEL',entryId,exceptionId:change.objectId,version:(await db.scheduleEntry.findUniqueOrThrow({where:{id:entryId}})).version,sourceDate,confirmed:true});
  assert((await model(teacher,credit.id)).selected.occurrences.find(o=>o.id===occurrence.id).conflict);
  await reject(()=>command(teacher,credit.id,{operation:'ATTENDANCE',studentId:a.id,occurrenceId:occurrence.id,mark:'PRESENT',version:0,reason:'Проверка отменённого занятия'}),/отменённое занятие/);
  pass('Actual timetable movement, cancellations, preserved results and frozen seminar maxima');
  // Current session and deanery assignment are checked again inside each write.
  const department=await db.deaneryDepartmentAssignment.findFirstOrThrow({where:{userId:d.id}});
  await db.deaneryDepartmentAssignment.delete({where:{userId_departmentId:{userId:d.id,departmentId:department.departmentId}}});
  await reject(()=>getBrsWorkspace(db,dean,exam.id),/недоступен|Объект/);
  await db.deaneryDepartmentAssignment.create({data:department});
  await db.session.update({where:{id:teacher.sessionId},data:{createdAt:new Date(Date.now()-9*3600000),expiresAt:new Date(Date.now()+3600000)}});
  await reject(()=>command(teacher,exam.id,{operation:'ATTEMPT',studentId:a.id,score:2000,passed:true,heldOn:'2026-12-30',version:0}),/Сессия завершена/);
  teacher.sessionId=(await actor(t)).sessionId;
  await db.user.update({where:{id:t.id},data:{role:'ADMIN'}});await reject(()=>command(teacher,exam.id,{operation:'ATTEMPT',studentId:a.id,score:2000,passed:true,heldOn:'2026-12-30',version:0}),/Доступ закрыт/);await db.user.update({where:{id:t.id},data:{role:'TEACHER'}});
  pass('Live role, session lifetime and revoked department assignment');
  const refinement=await verifyRefinementRules({db,teacher,dean,alex,maria,pass});
  // Browser and HTTP checks use a dedicated production server and random password.
  const password=randomBytes(24).toString('base64url');await db.account.updateMany({where:{providerId:'credential'},data:{password:await hashPassword(password)}});
  const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,detached:true,env:{...process.env,NODE_ENV:'production',BETTER_AUTH_URL:base,BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),AUTH_TRUST_PROXY:'false'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/auth/get-session')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
  const contexts={};for(const u of [t,d,a,m,admin,staff]){const ctx=await browser.newContext({viewport:{width:1360,height:900},reducedMotion: "reduce"});assert.equal((await ctx.request.post(base+'/api/auth/sign-in/email',{headers:{Origin:base},data:{email:u.email,password}})).status(),200);contexts[u.email]=ctx;}
  const tc=contexts[t.email],dc=contexts[d.email],ac=contexts[a.email],mc=contexts[m.email];
  const expiring=await browser.newContext();assert.equal((await expiring.request.post(base+'/api/auth/sign-in/email',{headers:{Origin:base},data:{email:t.email,password}})).status(),200);
  const expiringSession=(await (await expiring.request.get(base+'/api/auth/get-session')).json()).session;
  const cookie=(await expiring.cookies()).map(item=>item.name+'='+item.value).join('; ');
  const streamCommand=JSON.stringify({operation:'ATTEMPT',requestId:randomUUID(),planId:exam.id,revision:(await full(exam.id)).revision,studentId:a.id,version:0,score:1500,passed:true,heldOn:'2026-12-30'});
  let upload;const slowResponse=new Promise((resolve,reject)=>{upload=httpRequest(base+'/api/brs',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});upload.on('error',reject);upload.write(streamCommand.slice(0,30));});
  await db.session.update({where:{id:expiringSession.id},data:{createdAt:new Date(Date.now()-9*3600000),expiresAt:new Date(Date.now()+3600000)}});upload.end(streamCommand.slice(30));assert.equal(await slowResponse,401);await expiring.close();
  const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(base+'/api/brs')).status(),401);await anonymous.close();
  for(const u of [admin,staff])assert.equal((await contexts[u.email].request.get(base+'/api/brs')).status(),403);
  assert.equal((await ac.request.get(base+'/api/brs?studentId='+m.id)).status(),400);
  assert.equal((await tc.request.post(base+'/api/brs',{headers:{Origin:'https://foreign.example'},data:{operation:'CONFIRM',requestId:randomUUID(),planId:exam.id}})).status(),403);
  assert.equal((await tc.request.post(base+'/api/brs',{headers:{Origin:base},data:{operation:'RESULT',requestId:randomUUID(),authorId:m.id}})).status(),400);
  assert.equal((await tc.request.post(base+'/api/brs',{headers:{Origin:base},data:{operation:'RESULT',requestId:randomUUID(),comment:'x'.repeat(40000)}})).status(),413);
  const payload=await mc.request.get(base+'/api/brs?planId='+credit.id);assert.equal(payload.headers()['cache-control'],'private, no-store');assert(!(await payload.text()).includes('приватный комментарий'));
  async function pageFor(ctx,path){const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Next\.js encountered|Blocking Route|Instant validation|same key|unique.*key/i.test(m.text()))diagnostics.push(m.text());});await page.goto(base+path);await expect(page.locator('main h1')).toBeVisible();return page;}
  const tp=await pageFor(tc,'/teacher/grades?planId='+exam.id);await tp.getByRole('button',{name:new RegExp(a.name+', '+homework.title+',')}).click();
  await tp.getByLabel('Прежние рейтинговые баллы',{exact:true}).fill('8.4');await tp.getByLabel('Состояние сдачи',{exact:true}).selectOption('ON_TIME');await tp.getByLabel('Комментарий',{exact:true}).fill('Сквозной комментарий БРС');await tp.getByRole('checkbox',{name:'Показывать комментарий студенту и деканату'}).check();await tp.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(tp.getByRole('dialog')).not.toBeVisible();
  const ap=await pageFor(ac,'/dashboard/grades?planId='+exam.id);await ap.getByRole('button',{name:new RegExp(a.name+', '+homework.title+',.*'+exam.discipline.title)}).first().click();await expect(ap.getByRole('dialog')).toContainText('Сквозной комментарий БРС');await ap.keyboard.press('Escape');await expect(ap.getByRole('dialog')).not.toBeVisible();
  const dp=await pageFor(dc,'/deanery/admissions?planId='+exam.id);await expect(dp.locator('[data-student="'+a.id+'"]')).toContainText('Допущен');
  const mp=await pageFor(mc,'/dashboard/session?planId='+exam.id);assert(!(await mp.locator('main').innerText()).includes('Сквозной комментарий БРС'));
  await tp.getByRole('button',{name:new RegExp(a.name+', '+homework.title+',')}).click();await tp.getByRole('button',{name:'Удалить результат',exact:true}).click();await expect(tp.getByRole('dialog')).toContainText('Удалить результат?');await tp.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(tp.getByRole('dialog')).not.toBeVisible();
  await dp.getByRole('button',{name:'Обновить',exact:true}).click();await expect(dp.locator('[data-student="'+a.id+'"]')).toContainText('Проверка не завершена');
  await tp.getByRole('button',{name:new RegExp(a.name+', '+homework.title+',')}).click();
  await tp.getByLabel('Прежние рейтинговые баллы',{exact:true}).fill('8.4');await tp.getByLabel('Состояние сдачи',{exact:true}).selectOption('ON_TIME');
  await tp.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(tp.getByRole('dialog')).not.toBeVisible();
  await dp.getByRole('button',{name:'Обновить',exact:true}).click();
  const admissionCard=dp.locator('[data-student="'+a.id+'"]');
  await expect(admissionCard).toContainText('Ожидает подтверждения деканата');
  await admissionCard.getByRole('button',{name:'Подтвердить допуск',exact:true}).click();
  await dp.getByLabel('Основание / причина изменения').fill('Академические условия проверены через форму деканата');
  await dp.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dp.getByRole('dialog')).not.toBeVisible();await expect(admissionCard).toContainText('Допущен');
  const liveGrades=await (await ac.request.get(base+'/api/brs?planId='+exam.id)).json();
  const sessionPage=await pageFor(ac,'/dashboard/session?planId='+exam.id);await expect(sessionPage.locator('main')).toContainText('Допущен');
  assert.equal(liveGrades.selected.students[0].calculation.admissionStatus,'Допущен');
  await admissionCard.getByRole('button',{name:'Отозвать допуск',exact:true}).click();await dp.getByLabel('Основание / причина изменения').fill('Проверка отзыва через настоящую форму');await dp.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dp.getByRole('dialog')).not.toBeVisible();await expect(admissionCard).toContainText('Ожидает подтверждения деканата');
  async function brsNavigate(page,name,title){await page.locator('.brs-workspace:visible .brs-tabs').getByRole('link',{name,exact:true}).click();await expect(page.locator('main h1:visible')).toHaveText(title);}
  const refined=await pageFor(tc,'/teacher/grades?planId='+refinement.id);
  await expect(refined.locator('.brs-teacher-labs')).toBeVisible();
  await refined.screenshot({path:resolve(root,'refined-teacher-journal.png'),fullPage:true});
  assert.equal(await refined.getByRole('button',{name:/Состояние модуля/}).count(),0);
  await refined.getByRole('button',{name:'Настроить первичные баллы: РК 1',exact:true}).click();
  const bounds=await refined.getByRole('dialog').boundingBox();assert(Math.abs(bounds.x+bounds.width/2-680)<3&&Math.abs(bounds.y+bounds.height/2-450)<3,'Dialog is not centered');
  await refined.screenshot({path:resolve(root,'refined-scale-dialog.png')});
  await refined.getByLabel('Максимальный первичный балл',{exact:true}).fill('20');await refined.getByRole('button',{name:'Проверить последствия',exact:true}).click();
  await expect(refined.getByRole('dialog')).toContainText('4,5');await refined.getByRole('checkbox',{name:'Подтверждаю последствия пересчёта'}).check();await refined.getByLabel('Основание изменения шкалы',{exact:true}).fill('Проверка шкалы через форму преподавателя');await refined.getByRole('button',{name:'Сохранить шкалу',exact:true}).click();await expect(refined.getByRole('dialog')).not.toBeVisible();
  await brsNavigate(refined,'Сессия','Сессия');await expect(refined.locator('main h1:visible')).toHaveText('Сессия');
  await brsNavigate(refined,'Успеваемость','Электронный журнал');
  await refined.getByRole('button',{name:new RegExp(a.name+', РК 1,')}).click();await refined.getByLabel('Первичные баллы РК',{exact:true}).fill('16');await refined.getByLabel('Состояние сдачи',{exact:true}).selectOption('LATE');await refined.getByLabel('Основание / причина изменения',{exact:true}).fill('Коррекция ранее утверждённого результата');await refined.getByLabel('Комментарий',{exact:true}).fill('');await refined.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(refined.getByRole('dialog')).not.toBeVisible();
  const expectedNew=(await calculateStudent(db,await full(refinement.id),a.id)).calculation;
  await brsNavigate(refined,'Сессия','Сессия');await expect(refined.locator('.brs-workspace:visible [data-student="'+a.id+'"] .brs-facts dd').nth(1)).toHaveText(points(expectedNew.total)+' / 100');
  const refinedStudent=await pageFor(ac,'/dashboard/grades?planId='+refinement.id);
  assert.equal(await refinedStudent.getByRole('combobox',{name:'Дисциплина',exact:true}).count(),0);
  assert.equal(await refinedStudent.getByRole('link',{name:'На главную кабинета',exact:true}).count(),0);
  assert.equal(await refinedStudent.getByText('ДЗ и лабораторные',{exact:true}).count(),0);
  assert.equal(await refinedStudent.getByText('Экзамен — максимум 30 баллов',{exact:true}).count(),0);
  for(const label of ['Запланирован','Активен','Ожидает закрытия','Закрыт'])assert.equal(await refinedStudent.getByText(label,{exact:true}).count(),0);
  await refinedStudent.locator('.brs-student-full thead th[data-module-total="1"]').hover();assert(await refinedStudent.locator('.brs-student-full .brs-column-active').count()>1);
  await refinedStudent.getByRole('button',{name:'Программирование, итог модуля 1',exact:true}).first().click();await expect(refinedStudent.getByRole('dialog')).toContainText('Работа на семинарах');await refinedStudent.keyboard.press('Escape');
  await refinedStudent.getByText('Лабораторные работы · Программирование',{exact:true}).click();await expect(refinedStudent.locator('.brs-student-labs')).toBeVisible();assert.equal(await refinedStudent.locator('.brs-student-labs tbody tr').count(),3);
  await refinedStudent.getByText('Посещаемость · Программирование',{exact:true}).click();assert(!(await refinedStudent.locator('.brs-own-attendance thead').innerText()).includes(a.name));
  const refinedDean=await pageFor(dc,'/deanery/admissions?planId='+refinement.id);
  await expect(refinedDean.locator('[data-student="'+a.id+'"]')).toContainText('Не допущен');
  await brsNavigate(refinedDean,'Успеваемость','Успеваемость');
  await brsNavigate(refinedStudent,'Сессия','Сессия');await expect(refinedStudent.locator('main h1:visible')).toHaveText('Сессия');
  await brsNavigate(refinedStudent,'Успеваемость','Успеваемость');
  await brsNavigate(refined,'Успеваемость','Электронный журнал');
  await refined.getByRole('button',{name:new RegExp(a.name+', ДЗ 1,')}).click();await refined.getByLabel('Первичные баллы',{exact:true}).fill('36');await refined.getByLabel('Состояние сдачи',{exact:true}).selectOption('ON_TIME');await refined.getByLabel('Основание / причина изменения',{exact:true}).fill('Восстановлены основания допуска после проверки ДЗ');await refined.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(refined.getByRole('dialog')).not.toBeVisible();
  const liveResult=(await calculateStudent(db,await full(refinement.id),a.id)).calculation;
  await brsNavigate(refinedDean,'Допуски','Допуски и сессия');await expect(refinedDean.locator('.brs-workspace:visible [data-student="'+a.id+'"]')).toContainText('Ожидает подтверждения деканата');
  await brsNavigate(refinedStudent,'Сессия','Сессия');await expect(refinedStudent.locator('.brs-workspace:visible [data-student="'+a.id+'"] .brs-facts dd').nth(1)).toHaveText(points(liveResult.total)+' / 100');await expect(refinedStudent.locator('.brs-workspace:visible [data-student="'+a.id+'"]')).toContainText('Ожидает подтверждения деканата');
  await refinedDean.locator('.brs-workspace:visible [data-student="'+a.id+'"]').getByRole('button',{name:'Подтвердить допуск',exact:true}).click();await refinedDean.getByLabel('Основание / причина изменения',{exact:true}).fill('Актуальные основания проверены при переходе без F5');await refinedDean.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(refinedDean.getByRole('dialog')).not.toBeVisible();
  await brsNavigate(refinedStudent,'Успеваемость','Успеваемость');await brsNavigate(refinedStudent,'Сессия','Сессия');await expect(refinedStudent.locator('.brs-workspace:visible [data-student="'+a.id+'"]')).toContainText('Допущен');
  await brsNavigate(refined,'Сессия','Сессия');await expect(refined.locator('.brs-workspace:visible [data-student="'+a.id+'"]').getByRole('button',{name:'Добавить попытку',exact:true})).toBeEnabled();
  await refinedStudent.screenshot({path:resolve(root,'refined-student-desktop.png'),fullPage:true});
  await refined.screenshot({path:resolve(root,'refined-session-desktop.png'),fullPage:true});
  pass('Refinement forms: primary-scale preview, centered dialog, three labs, module columns, private attendance and fresh cached navigation without F5');
  await tp.screenshot({path:resolve(root,'teacher-desktop.png'),fullPage:true});await dp.screenshot({path:resolve(root,'deanery-desktop.png'),fullPage:true});await ap.screenshot({path:resolve(root,'student-desktop.png'),fullPage:true});
  const phone=await browser.newContext({storageState:await ac.storageState(),viewport:{width:360,height:800},reducedMotion:"reduce",isMobile:true,hasTouch:true});
  const mobile=await pageFor(phone,'/dashboard/grades?planId='+credit.id);
  await expect(mobile.locator('.brs-compact')).toBeVisible();
  assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=360 && innerWidth===360),'Mobile page overflow');
  await mobile.screenshot({path:resolve(root,'student-mobile-compact.png'),fullPage:true});
  const fullSwitch=mobile.getByRole('button',{name:'Полный режим',exact:true});
  try { await fullSwitch.click({timeout:5000}); }
  catch(error) {
    await mobile.screenshot({path:resolve(root,'mobile-switch-failure.png')});
    console.info('Mobile failure: '+root);
    console.info(await fullSwitch.evaluate(element=>{const rect=element.getBoundingClientRect();return JSON.stringify({rect:rect.toJSON(),hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML,viewport:{width:innerWidth,height:innerHeight,scrollY,visual:visualViewport?.toJSON?.()}});}));
    throw error;
  }
  await expect(mobile.locator('.brs-full')).toBeVisible();
  assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=360 && innerWidth===360),'Full mode mobile overflow');
  await mobile.screenshot({path:resolve(root,'student-mobile.png'),fullPage:true});
  for(const [name,context,path]of[['teacher',tc,'/teacher/grades'],['deanery',dc,'/deanery/admissions']]){
    const phoneContext=await browser.newContext({storageState:await context.storageState(),viewport:{width:360,height:800},reducedMotion:'reduce',isMobile:true,hasTouch:true});
    const page=await pageFor(phoneContext,path+'?planId='+(name==='teacher'?refinement.id:exam.id));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=360&&innerWidth===360),name+' mobile overflow');await page.screenshot({path:resolve(root,name+'-mobile.png'),fullPage:true});
    if(name==='teacher'){
      await page.getByRole('button',{name:new RegExp(a.name+', РК 1,')}).click();const dialogBounds=await page.getByRole('dialog').boundingBox();assert(dialogBounds.x>=0&&dialogBounds.y>=0&&dialogBounds.x+dialogBounds.width<=360&&dialogBounds.y+dialogBounds.height<=800,'Mobile grading dialog escaped the viewport');await page.screenshot({path:resolve(root,'teacher-grading-mobile.png')});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
    }
    await phoneContext.close();
  }
  assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(diagnostics.length,0,JSON.stringify(diagnostics));
  pass('HTTP guards and real browser scoring, privacy, deletion, shared session state and 360px modes');
  const publicAPI=await fetch(base+'/api/v1/schedule?group=pi-24-1&week=2026-11-09');const publicText=await publicAPI.text();assert(!publicText.includes('Сквозной комментарий'));assert(!publicText.includes('BrsResult'));
  const sqlite=createClient({url:env.DATABASE_URL});await integrity(sqlite);sqlite.close();assert.equal(await fingerprint(source),before,'Main database changed');
  pass('Main database and photos unchanged; isolated integrity verified');
  writeFileSync(resolve(root,'results.json'),JSON.stringify({success:true,results,errors,diagnostics,mainDatabaseUnchanged:true},null,2));console.info('Report: '+root);
} finally {
  if(browser)await browser.close();
  if(child&&child.exitCode===null&&child.signalCode===null)await new Promise((done,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Isolated BRS server did not stop')),5000);
    child.once('exit',()=>{clearTimeout(timer);done();});
    if(!child.kill('SIGTERM')){clearTimeout(timer);done();}
  });
  writeFileSync(resolve(root,'server.log'),logs,{mode:0o600});await db.$disconnect();source.close();
}
