import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {executeBrsCommand} from '../src/lib/brs-commands.ts';
import {calculateStudent,planInclude,serializeWorkspace,getBrsWorkspace} from '../src/lib/brs-repository.ts';
import {executeScheduleCommand} from '../src/lib/schedule-editor-repository.ts';
import {converted,roundedHundredths} from '../src/lib/brs-exact.ts';
import {calculateBrs,workStatus} from '../src/lib/brs-rules.ts';

export async function verifyRefinementRules({db,teacher,dean,alex,maria,pass}){
  assert.equal(roundedHundredths(converted(1200,2000,750)),450);assert.equal(roundedHundredths(converted(2400,3000,2200)),1760);
  const zero={passed:true,labStatus:null,deleted:false};
  const precise=calculateBrs('DIFFERENTIATED',[{id:'m',number:1,state:'ACTIVE',seminarMax:0,workMax:10000,controlMax:0,events:[{id:'old',title:'old',kind:'HOMEWORK',maxScore:8500,required:false,labMinScore:null,labRequiresDefense:false,result:{...zero,score:8500}},...Array.from({length:3},(_,i)=>({id:String(i),title:'tiny',kind:'LAB',maxScore:1,required:false,labMinScore:null,labRequiresDefense:false,result:{...zero,score:0,primaryScore:1,primaryMax:3}}))]}],[],null);
  assert.equal(precise.total,8501);assert.equal(precise.rating,86);assert.deepEqual(precise.exactTotal,{numerator:'8501',denominator:'1'});
  const group=await db.studyGroup.findUniqueOrThrow({where:{slug:'pi-24-1'}}),discipline=await db.discipline.findUniqueOrThrow({where:{code:'programming'}}),room=await db.room.findFirstOrThrow();
  const term=await db.academicTerm.create({data:{code:'brs-refinement-fixture',name:'Изолированная проверка первичных баллов',startsOn:new Date('2027-01-04'),endsOn:new Date('2027-04-25'),firstNumeratorMonday:new Date('2027-01-04'),isPublished:true}});
  const full=id=>db.brsPlan.findUniqueOrThrow({where:{id},include:planInclude});
  const save=async(id,values,who=teacher)=>executeBrsCommand(db,who,{requestId:randomUUID(),planId:id,revision:id?(await full(id)).revision:undefined,...values});
  await executeScheduleCommand(db,dean,{operation:'CREATE',groupIds:[group.id],teacherIds:[teacher.id],disciplineId:discipline.id,roomId:room.id,termId:term.id,dayOfWeek:1,start:'20:00',end:'21:00',kind:'PRACTICE',weekPattern:'EVERY',isPublished:true});
  await executeScheduleCommand(db,dean,{operation:'CREATE',groupIds:[group.id],teacherIds:[teacher.id],disciplineId:discipline.id,roomId:room.id,termId:term.id,dayOfWeek:2,start:'20:00',end:'21:00',kind:'LAB',weekPattern:'EVERY',isPublished:true});
  await save(undefined,{operation:'ASSIGN',groupId:group.id,disciplineId:discipline.id,termId:term.id,teacherId:teacher.id},dean);
  const created=await save(undefined,{operation:'CREATE_PLAN',groupId:group.id,disciplineId:discipline.id,termId:term.id,control:'EXAM',moduleCount:2},dean),id=created.planId;
  let plan=await full(id);const first=plan.modules[0],hw=first.events.find(e=>e.kind==='HOMEWORK'),d=value=>value?.toISOString().slice(0,10);
  await save(id,{operation:'EDIT_EVENT',eventId:hw.id,title:hw.title,week:hw.week,plannedOn:d(hw.plannedOn),issuedOn:d(hw.issuedOn),deadline:d(hw.deadline),maxScore:301,required:true},dean);
  for(const [i,maxScore]of[300,400,499].entries()){
    const occurrence=plan.occurrences.filter(o=>o.kind==='LAB')[i];
    await save(id,{operation:'ADD_WORK',moduleId:first.id,kind:'LAB',title:'ЛР '+(i+1),week:i+1,plannedOn:d(occurrence.date),occurrenceId:occurrence.id,maxScore,required:true,labMinScore:0,labRequiresDefense:true},dean);
  }
  await save(id,{operation:'PUBLISH'},dean);plan=await full(id);
  assert.equal(plan.modules[0].events.filter(e=>['HOMEWORK','LAB'].includes(e.kind)).reduce((sum,e)=>sum+e.maxScore,0),1500);
  const interim=plan.modules[0].events.find(e=>e.kind==='INTERIM'),labs=plan.modules[0].events.filter(e=>e.kind==='LAB');

  const calc=async()=>calculateStudent(db,await full(id),alex.id);
  const setting=async(eventId,scoringMode,primaryMax)=>{const e=(await full(id)).modules.flatMap(m=>m.events).find(e=>e.id===eventId);return save(id,{operation:'GRADING_SETTINGS',eventId,scaleVersion:e.scaleVersion,scoringMode,primaryMax});};
  const result=async(eventId,values,student=alex)=>{const e=(await full(id)).modules.flatMap(m=>m.events).find(e=>e.id===eventId),old=await db.brsResult.findUnique({where:{eventId_studentId:{eventId,studentId:student.id}}});return save(id,{operation:'RESULT',eventId,studentId:student.id,version:old?.version??0,scoringMode:e.scoringMode,reason:'Явная правка изолированного результата',...values});};
  for(const brsModule of plan.modules)for(const event of brsModule.events){
    if(event.kind==='SEMINAR')continue;
    const primaryMax=event.id===interim.id?2000:event.kind==='HOMEWORK'?3000:event.kind==='LAB'?[2000,1500,2500][labs.findIndex(l=>l.id===event.id)]:1000;
    await setting(event.id,'PRIMARY',primaryMax);
    await result(event.id,{primaryScore:event.id===interim.id?1200:event.id===hw.id?2400:primaryMax,submissionTiming:'EARLY',labStatus:event.kind==='LAB'?'DEFENDED':null,performedOn:event.kind==='LAB'?d(event.plannedOn):null,defendedOn:event.kind==='LAB'?d(event.plannedOn):null,comment:''});
  }
  plan=await full(id);
  const seminar=plan.modules[0].events.find(e=>e.kind==='SEMINAR'),secondSeminar=plan.modules[0].events.filter(e=>e.kind==='SEMINAR')[1];
  await assert.rejects(()=>save(id,{operation:'RELINK',eventId:secondSeminar.id,occurrenceId:seminar.occurrenceId,reason:'Запрет повторного начисления'},dean),/Двойное начисление/);
  await db.brsResult.create({data:{eventId:seminar.id,studentId:alex.id,authorId:teacher.id,score:seminar.maxScore}});
  for(const mark of ['PRESENT','ACTIVE','SICK','ABSENT','EXCUSED',null]){
    const row=await db.brsAttendance.findUnique({where:{occurrenceId_studentId:{occurrenceId:seminar.occurrenceId,studentId:alex.id}}});
    await save(id,{operation:'ATTENDANCE',occurrenceId:seminar.occurrenceId,studentId:alex.id,version:row?.version??0,mark});
    const c=(await calc()).calculation;assert.equal(c.modules[0].seminarScore,mark==='ACTIVE'?seminar.maxScore:0);assert.equal(c.modules[0].seminarMissing,mark===null?8:7);
  }
  await assert.rejects(()=>result(seminar.id,{score:10}),/определяются посещаемостью/);
  for(const e of plan.modules.flatMap(m=>m.events).filter(e=>e.kind==='SEMINAR')){
    const row=await db.brsAttendance.findUnique({where:{occurrenceId_studentId:{occurrenceId:e.occurrenceId,studentId:alex.id}}});await save(id,{operation:'ATTENDANCE',occurrenceId:e.occurrenceId,studentId:alex.id,version:row?.version??0,mark:'ACTIVE'});
  }
  let current=await calc();assert.equal(current.calculation.academic.state,'MET');assert(current.calculation.modules.every(m=>m.complete));assert(plan.modules.every(m=>m.state==='PLANNED'));
  assert.equal(current.results.find(r=>r.eventId===interim.id).score,450);
  const hwRecord=current.results.find(r=>r.eventId===hw.id);assert.equal(hwRecord.submittedOn,null);assert.equal(hwRecord.comment,'');assert.equal(workStatus(hw,hwRecord),'Сдано досрочно');
  await save(id,{operation:'CONFIRM',studentId:alex.id,version:0,reason:'Проверка автоматического допуска'},dean);
  await save(id,{operation:'ATTEMPT',studentId:alex.id,version:0,score:2000,passed:true,heldOn:'2027-04-26'});
  assert((await calc()).calculation.ready);
  await save(id,{operation:'FINALIZE',studentId:alex.id,version:0});
  const baseline=await calc(),official=await db.brsFinal.findUniqueOrThrow({where:{planId_studentId:{planId:id,studentId:alex.id}}});
  const baselineResults=await db.brsResult.findMany({where:{event:{module:{planId:id}}},orderBy:{id:'asc'}});
  for(const [mode,max]of[['PRIMARY',3000],['RATING',null],['PRIMARY',100]]){
    await setting(interim.id,mode,max);
    assert.deepEqual(await db.brsResult.findMany({where:{event:{module:{planId:id}}},orderBy:{id:'asc'}}),baselineResults,'Settings must never rewrite results, timestamps or versions');
    assert.deepEqual((await calc()).calculation,baseline.calculation);assert.deepEqual((await calc()).admission,baseline.admission);
    assert.deepEqual(await db.brsFinal.findUniqueOrThrow({where:{id:official.id}}),official);
  }
  await setting(interim.id,'PRIMARY',3000);
  await result(interim.id,{primaryScore:1200,submissionTiming:'ON_TIME',passed:true});
  current=await calc();assert.equal(current.results.find(r=>r.eventId===interim.id).score,300);assert.equal(current.calculation.academic.state,'FAILED');assert(!current.admission.approved);
  assert((await db.brsFinal.findUniqueOrThrow({where:{id:official.id}})).needsReview);
  await setting(interim.id,'RATING',null);
  for(const score of [-1,751,1.5])await assert.rejects(()=>result(interim.id,{score,submissionTiming:'ON_TIME'}),/диапазона/);
  await result(interim.id,{score:374,submissionTiming:'ON_TIME',passed:true});assert.equal((await calc()).calculation.academic.state,'FAILED');
  await result(interim.id,{score:375,submissionTiming:'ON_TIME',passed:false});assert.equal((await calc()).calculation.academic.state,'MET');
  assert.equal((await calc()).results.find(r=>r.eventId===interim.id).passed,true,'Client cannot contradict numeric success');
  await result(interim.id,{score:0,submissionTiming:'EARLY'});assert.equal((await calc()).results.find(r=>r.eventId===interim.id).score,0);
  await assert.rejects(()=>result(interim.id,{submissionTiming:'NOT_SUBMITTED'}),/аннулирование/);
  await result(interim.id,{submissionTiming:'NOT_SUBMITTED',confirmed:true});
  current=await calc();const noScore=current.results.find(r=>r.eventId===interim.id);assert.equal(noScore.score,null);assert.equal(noScore.passed,null);assert.equal(current.calculation.academic.state,'PENDING');
  await result(interim.id,{submissionTiming:'LATE',score:0,primaryScore:999999});
  let late=(await calc()).results.find(r=>r.eventId===interim.id);assert.equal(late.score,375);assert.equal(late.scoreSource,'LATE');assert.equal(late.primaryScore,null);assert.equal(late.primaryMax,null);assert.equal(late.passed,true);
  await setting(interim.id,'PRIMARY',2000);assert.deepEqual((await calc()).results.find(r=>r.id===late.id),late);
  await result(interim.id,{primaryScore:1200,submissionTiming:'ON_TIME'});
  for(const primaryMax of [0,-1,1.5,100000000])await assert.rejects(()=>setting(hw.id,'PRIMARY',primaryMax),/от 0,01/);
  const e=(await full(id)).modules[0].events.find(e=>e.id===hw.id);
  await assert.rejects(()=>save(id,{operation:'GRADING_SETTINGS',eventId:hw.id,scaleVersion:e.scaleVersion,scoringMode:'RATING',maxScore:9999}),/Рейтинговый максимум/);
  await assert.rejects(()=>save(id,{operation:'GRADING_SETTINGS',eventId:hw.id,scaleVersion:e.scaleVersion,scoringMode:'RATING'},dean),/недоступна вашей роли/);
  for(const primaryScore of [-1,3001,1.5])await assert.rejects(()=>result(hw.id,{primaryScore,submissionTiming:'ON_TIME'}),/диапазона/);

  await result(hw.id,{submissionTiming:'LATE'});
  const odd=(await calc()).results.find(r=>r.eventId===hw.id);assert.equal(odd.exactNumerator,'301');assert.equal(odd.exactDenominator,'2');assert.equal(odd.scoreSource,'LATE');assert.equal(odd.primaryScore,null);assert.equal(odd.passed,true);
  const oddCalc=(await calc()).calculation;assert(oddCalc.modules.every(m=>m.complete),'Exact half, even below stored-cent precision, must pass');
  await result(hw.id,{primaryScore:2400,submissionTiming:'EARLY'});
  await result(interim.id,{primaryScore:100},maria);
  const fresh=await db.brsResult.findUniqueOrThrow({where:{eventId_studentId:{eventId:interim.id,studentId:maria.id}}});assert.equal(fresh.submissionTiming,'NOT_SUBMITTED');assert.equal(fresh.score,null);assert.equal(fresh.primaryScore,null);
  const historical=await db.brsResult.create({data:{eventId:hw.id,studentId:maria.id,authorId:teacher.id,score:10,submissionTiming:'LATE'}});
  await setting(hw.id,'RATING',null);assert.deepEqual(await db.brsResult.findUniqueOrThrow({where:{id:historical.id}}),historical);
  await result(hw.id,{submissionTiming:'LATE'},maria);assert.equal((await db.brsResult.findUniqueOrThrow({where:{id:historical.id}})).exactNumerator,'301');
  await setting(hw.id,'PRIMARY',3000);
  // Historical marks, including LATE and IN_PROGRESS, are untouched by settings.
  await db.brsResult.create({data:{eventId:labs[0].id,studentId:maria.id,authorId:teacher.id,score:150,labStatus:'IN_PROGRESS',comment:'Приватный исторический комментарий'}});
  const legacyLab=await db.brsResult.findUniqueOrThrow({where:{eventId_studentId:{eventId:labs[0].id,studentId:maria.id}}});
  await setting(labs[0].id,'RATING',null);assert.deepEqual(await db.brsResult.findUniqueOrThrow({where:{id:legacyLab.id}}),legacyLab);
  await result(labs[0].id,{score:175,labStatus:'COMPLETED',performedOn:d(labs[0].plannedOn),comment:''},maria);
  await save(id,{operation:'DELETE_RESULT',eventId:labs[0].id,studentId:maria.id,version:legacyLab.version+1,confirmed:true});
  await result(labs[0].id,{score:150,labStatus:'FAILED',comment:''},maria);assert(!(await db.brsResult.findUniqueOrThrow({where:{id:legacyLab.id}})).deleted);
  await assert.rejects(()=>result(labs[1].id,{primaryScore:100,labStatus:'IN_PROGRESS'},maria),/Некорректный статус/);
  const racePlan=await full(id),raceEvent=racePlan.modules[0].events.find(e=>e.id===interim.id),raceRow=(await calc()).results.find(r=>r.eventId===interim.id);
  const races=await Promise.allSettled([
    save(id,{operation:'GRADING_SETTINGS',revision:racePlan.revision,eventId:interim.id,scaleVersion:raceEvent.scaleVersion,scoringMode:'PRIMARY',primaryMax:3000}),
    save(id,{operation:'RESULT',revision:racePlan.revision,eventId:interim.id,studentId:alex.id,version:raceRow.version,scoringMode:'PRIMARY',primaryScore:1000,submissionTiming:'ON_TIME',reason:'Конкурентная явная корректировка'})
  ]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  await setting(interim.id,'PRIMARY',2000);await result(interim.id,{primaryScore:1200,submissionTiming:'ON_TIME'});
  // Preserve the previous official-protection regression when a seminar is rebound.
  const oldFinal=await db.brsFinal.findUniqueOrThrow({where:{id:official.id}});
  await save(id,{operation:'FINALIZE',studentId:alex.id,version:oldFinal.version,reason:'Повторная фиксация изолированного итога'});
  const protectedFinal=await db.brsFinal.findUniqueOrThrow({where:{id:official.id}}),beforeRelink=(await calc()).calculation;
  await executeScheduleCommand(db,dean,{operation:'EXTRA',groupIds:[group.id],teacherIds:[teacher.id],disciplineId:discipline.id,roomId:room.id,termId:term.id,date:'2027-01-06',start:'20:00',end:'21:00',kind:'PRACTICE',weekPattern:'EVERY',isPublished:true});
  await save(id,{operation:'SYNC',reason:'Дополнительное занятие изолированной фикстуры'},dean);
  const extra=(await full(id)).occurrences.find(o=>d(o.date)==='2027-01-06');
  await save(id,{operation:'RELINK',eventId:seminar.id,occurrenceId:extra.id,reason:'Явная перепривязка семинара'},dean);
  const relinked=await db.brsFinal.findUniqueOrThrow({where:{id:official.id}});assert(relinked.needsReview);assert.equal(relinked.score,protectedFinal.score);assert.equal((await calc()).calculation.total,beforeRelink.total-seminar.maxScore);
  await save(id,{operation:'RELINK',eventId:seminar.id,occurrenceId:seminar.occurrenceId,reason:'Восстановление привязки фикстуры'},dean);
  // Browser fixture: a deficient HW, not a setting change, invalidates admission.
  await setting(hw.id,'PRIMARY',6000);const hwBefore=(await calc()).results.find(r=>r.eventId===hw.id);assert.equal(hwBefore.primaryMax,3000);
  await result(hw.id,{primaryScore:2400,submissionTiming:'ON_TIME'});
  assert.equal((await calc()).calculation.academic.state,'FAILED');
  const dto=serializeWorkspace(await getBrsWorkspace(db,alex,id));assert(!JSON.stringify(dto).includes('Приватный исторический комментарий'));assert(!JSON.stringify(dto.overview).includes('В работе'));
  const audits=await db.brsAudit.findMany({where:{planId:id,action:'GRADING_SETTINGS'}});assert(audits.every(row=>!row.afterJson.includes('results')));
  pass('Frozen score snapshots, direct and primary input, late fixed half, automatic 50% success, binary attendance, three labs, audit and concurrent settings');
  return {id,homeworkId:hw.id,interimId:interim.id,labId:labs[0].id};
}
