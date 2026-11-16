import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {executeBrsCommand} from '../src/lib/brs-commands.ts';
import {calculateStudent,getBrsWorkspace,planInclude,serializeWorkspace} from '../src/lib/brs-repository.ts';
import {calculateBrs,numberControlModules,workTitle,officialState} from '../src/lib/brs-rules.ts';
import {reconcileOfficialFinals} from '../src/lib/brs-final-review.ts';
import {executeScheduleCommand} from '../src/lib/schedule-editor-repository.ts';

export async function verifyFinalRules({db,teacher,dean,alex,admin,staff,pass}) {
  for(const count of [2,3]){
    const modules=Array.from({length:count},(_,i)=>({number:i+1,events:[{id:`i${i}`,kind:'INTERIM',title:'old',number:i+1,week:2},{id:`f${i}`,kind:'FINAL',title:'old',number:i+1,week:4}]}));
    const numbered=numberControlModules(modules),labels=numbered.flatMap(m=>m.events.map(e=>workTitle(e)));
    assert.deepEqual(labels,count===2?['РК1','РК2/М1','РК3','РК4/М2']:['РК1','РК2/М1','РК3','РК4/М2','РК5','РК6/М3']);
    modules[0].events[0].week=30;modules[0].events.reverse();assert.deepEqual(numberControlModules(modules).flatMap(m=>m.events.map(e=>[e.id,e.controlNumber])).sort(),numbered.flatMap(m=>m.events.map(e=>[e.id,e.controlNumber])).sort());
    modules[0].events.push({id:'extra',kind:'INTERIM',title:'extra',number:3,week:9});assert.equal(new Set(numberControlModules(modules).flatMap(m=>m.events.map(e=>e.controlNumber))).size,count*2+1);
  }
  const full=id=>db.brsPlan.findUniqueOrThrow({where:{id},include:planInclude});
  const save=async(id,values,actor=teacher)=>executeBrsCommand(db,actor,{requestId:randomUUID(),planId:id,revision:id?(await full(id)).revision:undefined,...values});
  const group=await db.studyGroup.findUniqueOrThrow({where:{slug:'pi-24-1'}}),room=await db.room.findFirstOrThrow();
  const discipline=await db.discipline.create({data:{code:'brs-final-consistency',title:'Изолированная проверка зачёта'}});
  const term=await db.academicTerm.create({data:{code:'brs-finals-2025',name:'Изолированная проверка итогов 2025',startsOn:new Date('2025-01-06'),endsOn:new Date('2025-04-27'),firstNumeratorMonday:new Date('2025-01-06'),isPublished:true}});
  for(const [dayOfWeek,kind]of [[5,'PRACTICE'],[4,'LAB']])await executeScheduleCommand(db,dean,{operation:'CREATE',groupIds:[group.id],teacherIds:[teacher.id],disciplineId:discipline.id,roomId:room.id,termId:term.id,dayOfWeek,start:'20:00',end:'21:00',kind,weekPattern:'EVERY',isPublished:true});
  await save(undefined,{operation:'ASSIGN',groupId:group.id,disciplineId:discipline.id,termId:term.id,teacherId:teacher.id},dean);
  const id=(await save(undefined,{operation:'CREATE_PLAN',groupId:group.id,disciplineId:discipline.id,termId:term.id,control:'CREDIT',moduleCount:2},dean)).planId;
  let plan=await full(id);const first=plan.modules[0],hw=first.events.find(e=>e.kind==='HOMEWORK'),labOccurrence=plan.occurrences.find(o=>o.kind==='LAB');
  const day=d=>d?.toISOString().slice(0,10);
  await save(id,{operation:'EDIT_EVENT',eventId:hw.id,title:hw.title,week:hw.week,plannedOn:day(hw.plannedOn),issuedOn:day(hw.issuedOn),deadline:day(hw.deadline),maxScore:1200,required:true},dean);
  await save(id,{operation:'ADD_WORK',moduleId:first.id,kind:'LAB',title:'ЛР 1',week:1,plannedOn:day(labOccurrence.date),occurrenceId:labOccurrence.id,maxScore:1000,required:true,labMinScore:0,labRequiresDefense:true},dean);
  await save(id,{operation:'PUBLISH'},dean);plan=await full(id);
  const calc=async()=>calculateStudent(db,await full(id),alex.id),dto=async()=>serializeWorkspace(await getBrsWorkspace(db,alex,id));
  const setResult=async(event,values)=>{const current=await db.brsEvent.findUniqueOrThrow({where:{id:event.id}}),old=await db.brsResult.findUnique({where:{eventId_studentId:{eventId:event.id,studentId:alex.id}}});return save(id,{operation:'RESULT',eventId:event.id,studentId:alex.id,version:old?.version??0,scoringMode:'RATING',submissionTiming:'ON_TIME',score:current.maxScore,...values});};
  for(const event of plan.modules.flatMap(m=>m.events)){
    if(event.kind==='SEMINAR')await save(id,{operation:'ATTENDANCE',occurrenceId:event.occurrenceId,studentId:alex.id,version:0,mark:'ACTIVE'});
    else await setResult(event,event.kind==='LAB'?{labStatus:'DEFENDED',performedOn:day(event.plannedOn),defendedOn:day(event.plannedOn)}:{});
  }
  let c=await calc();assert.equal(c.calculation.total,10000);assert(c.calculation.ready);
  await save(id,{operation:'FINALIZE',studentId:alex.id,version:0});
  let final=await db.brsFinal.findUniqueOrThrow({where:{planId_studentId:{planId:id,studentId:alex.id}}});const originalScore=final.score;
  assert((await dto()).selected.students[0].official.valid);
  await setResult(hw,{score:1,comment:'',reason:''});c=await calc();assert(c.calculation.rating>=60);assert(!c.calculation.ready);assert(c.calculation.confirmedDebts.some(i=>i.id===hw.id));
  await assert.rejects(()=>save(id,{operation:'FINALIZE',studentId:alex.id,version:final.version+1,score:10000,passed:true}),/фиксации|обязательные/);
  let invalid=(await dto()).selected.students[0].official;assert(!invalid.valid);assert.match(invalid.status,/требует пересмотра/);assert.equal(invalid.score,originalScore);
  // An old incorrect flag must not make the snapshot valid even before reconciliation.
  await db.brsFinal.update({where:{id:final.id},data:{needsReview:false}});assert(!(await dto()).selected.students[0].official.valid);
  const auditCount=await db.brsAudit.count(),reviews=await reconcileOfficialFinals(db);assert(reviews.ids.includes(final.id));assert.equal((await db.brsFinal.findUniqueOrThrow({where:{id:final.id}})).score,originalScore);
  const once=await db.brsAudit.count();assert(once>auditCount);assert.equal((await reconcileOfficialFinals(db)).markedForReview,0);assert.equal(await db.brsAudit.count(),once);
  await setResult(hw,{});final=await db.brsFinal.findUniqueOrThrow({where:{id:final.id}});await save(id,{operation:'FINALIZE',studentId:alex.id,version:final.version});assert((await dto()).selected.students[0].official.valid);
  const control=plan.modules[0].events.find(e=>e.kind==='FINAL'),lab=plan.modules[0].events.find(e=>e.kind==='LAB');
  await setResult(control,{score:0});assert((await calc()).calculation.rating>=60);assert(!(await calc()).calculation.ready);await assert.rejects(async()=>save(id,{operation:'FINALIZE',studentId:alex.id,version:(await db.brsFinal.findUniqueOrThrow({where:{id:final.id}})).version}),/фиксации|обязательные/);await setResult(control,{});
  await setResult(lab,{labStatus:'COMPLETED',performedOn:day(lab.plannedOn),defendedOn:null});c=await calc();assert(c.calculation.confirmedDebts.some(i=>i.id===lab.id));assert(!c.calculation.ready);
  await setResult(lab,{labStatus:'DEFENDED',performedOn:day(lab.plannedOn),defendedOn:day(lab.plannedOn)});
  const savedHW=await db.brsResult.findUniqueOrThrow({where:{eventId_studentId:{eventId:hw.id,studentId:alex.id}}});await save(id,{operation:'DELETE_RESULT',eventId:hw.id,studentId:alex.id,version:savedHW.version,reason:''});assert(!(await calc()).calculation.ready);assert((await calc()).calculation.waiting.some(i=>i.id===hw.id));
  const restore={operation:'RESTORE_RESULT',eventId:hw.id,studentId:alex.id,version:savedHW.version+1};
  await assert.rejects(()=>save(id,restore,dean),/недоступна вашей роли/);
  await assert.rejects(()=>save(id,restore,alex),/Студенту|Доступ/);
  for(const user of [admin,staff])await assert.rejects(()=>save(id,restore,{id:user.id,role:user.role}),/Доступ закрыт/);
  const other=await db.user.findUniqueOrThrow({where:{email:'anna.belova@example.test'}});
  const otherSession=await db.session.create({data:{userId:other.id,token:randomUUID(),expiresAt:new Date(Date.now()+3600000)}});
  await save(undefined,{operation:'ASSIGN',groupId:group.id,disciplineId:discipline.id,termId:term.id,teacherId:other.id},dean);
  await assert.rejects(()=>save(id,restore,{id:other.id,role:'TEACHER',sessionId:otherSession.id}),/чужую запись/);
  const onceCommand={...restore,requestId:randomUUID(),planId:id,revision:(await full(id)).revision};
  const firstRestore=await executeBrsCommand(db,teacher,onceCommand),retryRestore=await executeBrsCommand(db,teacher,onceCommand);assert.equal(firstRestore.objectId,retryRestore.objectId);
  const restored=await db.brsResult.findUniqueOrThrow({where:{id:savedHW.id}});assert.equal(restored.score,savedHW.score);assert.equal(restored.primaryMax,savedHW.primaryMax);assert.equal(restored.version,savedHW.version+2);assert.equal(await db.brsAudit.count({where:{planId:id,action:'RESTORE_RESULT'}}),1);
  final=await db.brsFinal.findUniqueOrThrow({where:{id:final.id}});await save(id,{operation:'FINALIZE',studentId:alex.id,version:final.version,reason:''});
  // The same final validity rule applies to all four controls; a session attempt
  // never erases a debt on another required work.
  for(const p of await db.brsPlan.findMany({where:{publishedAt:{not:null}},include:planInclude})){
    const own=await calculateStudent(db,p,alex.id),changed=structuredClone(own.modules),target=changed.flatMap(m=>m.events).find(e=>e.kind==='HOMEWORK');
    target.result={...target.result,score:0,primaryScore:null,primaryMax:null,exactNumerator:'0',exactDenominator:'1',submissionTiming:'ON_TIME',passed:true,deleted:false};
    const bad=calculateBrs(p.control,changed,own.attempts,own.admission,'2026-11-15');assert(!bad.ready);assert(!officialState({score:bad.total,rating:bad.rating,grade:p.control==='CREDIT'?'Зачёт':'5',needsReview:false},bad).valid);
    if(p.control!=='CREDIT'){
      const work=p.modules.flatMap(m=>m.events).find(e=>e.kind==='HOMEWORK'),prior=await db.brsResult.findUnique({where:{eventId_studentId:{eventId:work.id,studentId:alex.id}}});
      const record=prior?await db.brsResult.update({where:{id:prior.id},data:{score:0,primaryScore:null,primaryMax:null,exactNumerator:'0',exactDenominator:'1',submissionTiming:'ON_TIME',deleted:false}}):await db.brsResult.create({data:{eventId:work.id,studentId:alex.id,authorId:teacher.id,score:0,submissionTiming:'ON_TIME'}});
      try{const snapshot=await db.brsFinal.findUnique({where:{planId_studentId:{planId:p.id,studentId:alex.id}}});await assert.rejects(()=>save(p.id,{operation:'FINALIZE',studentId:alex.id,version:snapshot?.version??0,score:10000,passed:true}),/фиксации|обязательные/);}finally{if(prior)await db.brsResult.update({where:{id:prior.id},data:prior});else await db.brsResult.delete({where:{id:record.id}});}
    }
  }
  const noMinimum=structuredClone((await calc()).modules);for(const m of noMinimum)for(const e of m.events)e.result={score:e.kind==='SEMINAR'?0:e.maxScore/2,passed:true,labStatus:'DEFENDED',performedOn:'2025-01-01',defendedOn:'2025-01-01',submissionTiming:'ON_TIME',deleted:false};
  const below=calculateBrs('CREDIT',noMinimum,[],null,'2026-11-15');assert(below.ready);assert(below.rating<60);assert.equal(below.provisionalGrade,'Незачёт');
  pass('Stable RK numbering for 2/3 modules, credit 60+ with mandatory conditions, stale official read guards, audit reconciliation, empty teacher text without confirmation, and all-control debt regression');
  return {id,homeworkId:hw.id,finalEventId:control.id};
}
