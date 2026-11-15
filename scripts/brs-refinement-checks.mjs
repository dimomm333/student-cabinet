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
  await save(id,{operation:'EDIT_EVENT',eventId:hw.id,title:hw.title,week:hw.week,plannedOn:d(hw.plannedOn),issuedOn:d(hw.issuedOn),deadline:d(hw.deadline),maxScore:300,required:true},dean);
  for(const [i,maxScore]of[300,400,500].entries()){
    const occurrence=plan.occurrences.filter(o=>o.kind==='LAB')[i];
    await save(id,{operation:'ADD_WORK',moduleId:first.id,kind:'LAB',title:'ЛР '+(i+1),week:i+1,plannedOn:d(occurrence.date),occurrenceId:occurrence.id,maxScore,required:true,labMinScore:0,labRequiresDefense:true},dean);
  }
  await save(id,{operation:'PUBLISH'},dean);plan=await full(id);
  assert.equal(plan.modules[0].events.filter(e=>['HOMEWORK','LAB'].includes(e.kind)).reduce((sum,e)=>sum+e.maxScore,0),1500);
  const interim=plan.modules[0].events.find(e=>e.kind==='INTERIM'),labs=plan.modules[0].events.filter(e=>e.kind==='LAB');
  for(const brsModule of plan.modules)for(const event of brsModule.events){
    if(event.kind==='SEMINAR')continue;
    const primaryMax=event.id===interim.id?2000:event.kind==='HOMEWORK'?3000:event.kind==='LAB'?[2000,1500,2500][labs.findIndex(l=>l.id===event.id)]:1000;
    await save(id,{operation:'PRIMARY_SCALE',eventId:event.id,scaleVersion:event.scaleVersion,primaryMax});
    const primaryScore=event.id===interim.id?1200:event.id===hw.id?2400:primaryMax;
    await save(id,{operation:'RESULT',studentId:alex.id,eventId:event.id,version:0,scoringMode:'PRIMARY',primaryScore,submissionTiming:event.kind==='HOMEWORK'?'EARLY':null,passed:['INTERIM','FINAL'].includes(event.kind)?true:null,labStatus:event.kind==='LAB'?'DEFENDED':null,performedOn:event.kind==='LAB'?d(event.plannedOn):null,defendedOn:event.kind==='LAB'?d(event.plannedOn):null,comment:''});
  }
  plan=await full(id);
  const calc=async()=>calculateStudent(db,await full(id),alex.id);
  const seminar=plan.modules[0].events.find(e=>e.kind==='SEMINAR');
  const secondSeminar=plan.modules[0].events.filter(e=>e.kind==='SEMINAR')[1];
  await assert.rejects(()=>save(id,{operation:'RELINK',eventId:secondSeminar.id,occurrenceId:seminar.occurrenceId,reason:'Проверка запрета повторного начисления'},dean),/Двойное начисление/);
  await db.brsResult.create({data:{eventId:seminar.id,studentId:alex.id,authorId:teacher.id,score:seminar.maxScore}});
  let previous=(await calc()).calculation.total;
  for(const mark of ['PRESENT','ACTIVE','SICK','ABSENT','EXCUSED',null]){
    const row=await db.brsAttendance.findUnique({where:{occurrenceId_studentId:{occurrenceId:seminar.occurrenceId,studentId:alex.id}}});
    await save(id,{operation:'ATTENDANCE',occurrenceId:seminar.occurrenceId,studentId:alex.id,version:row?.version??0,mark});
    const c=(await calc()).calculation;
    assert.equal(c.modules[0].seminarScore,mark==='ACTIVE'?seminar.maxScore:0);
    assert.equal(c.modules[0].seminarMissing,mark===null?8:7);
    if(mark==='PRESENT')previous=c.total;if(mark==='ACTIVE')assert.equal(c.total,previous+seminar.maxScore);
  }
  await assert.rejects(()=>save(id,{operation:'RESULT',eventId:seminar.id,studentId:alex.id,version:1,scoringMode:'LEGACY',score:seminar.maxScore}),/определяются посещаемостью/);
  for(const e of plan.modules.flatMap(m=>m.events).filter(e=>e.kind==='SEMINAR')){
    const row=await db.brsAttendance.findUnique({where:{occurrenceId_studentId:{occurrenceId:e.occurrenceId,studentId:alex.id}}});await save(id,{operation:'ATTENDANCE',occurrenceId:e.occurrenceId,studentId:alex.id,version:row?.version??0,mark:'ACTIVE'});
  }
  let current=await calc();assert.equal(current.calculation.academic.state,'MET');assert(current.calculation.modules.every(m=>m.complete));assert(plan.modules.every(m=>m.state==='PLANNED'));
  assert.equal(current.results.find(r=>r.eventId===interim.id).score,450);
  const hwRecord=current.results.find(r=>r.eventId===hw.id);assert.equal(hwRecord.score,240);assert.equal(hwRecord.submittedOn,null);assert.equal(hwRecord.comment,'');assert.equal(workStatus(hw,hwRecord),'Сдано досрочно');
  await db.brsEvent.update({where:{id:hw.id},data:{deadline:new Date('2027-02-01')}});assert.equal(workStatus({...hw,deadline:new Date('2027-02-01')},hwRecord),'Сдано досрочно');
  await save(id,{operation:'CONFIRM',studentId:alex.id,version:0,reason:'Проверка автоматического допуска'},dean);
  await save(id,{operation:'ATTEMPT',studentId:alex.id,version:0,score:2000,passed:true,heldOn:'2027-04-26'});
  assert((await calc()).calculation.ready,'Finalization must not require a global module switch');
  await save(id,{operation:'FINALIZE',studentId:alex.id,version:0});
  const official=await db.brsFinal.findUniqueOrThrow({where:{planId_studentId:{planId:id,studentId:alex.id}}});
  let event=(await full(id)).modules[0].events.find(e=>e.id===interim.id);
  await assert.rejects(()=>save(id,{operation:'PRIMARY_SCALE',eventId:event.id,scaleVersion:event.scaleVersion,primaryMax:4000}),/причину|Подтвердите/);
  const preview=await save(id,{operation:'PREVIEW_SCALE',eventId:event.id,scaleVersion:event.scaleVersion,primaryMax:4000});assert.equal(preview.preview.rows[0].after,225);
  await save(id,{operation:'PRIMARY_SCALE',eventId:event.id,scaleVersion:event.scaleVersion,primaryMax:4000,confirmed:true,reason:'Подтверждённый пересчёт первичного максимума'});
  assert((await calc()).admission.approved,'Passed RK does not invent a numeric threshold');
  const officialAfter=await db.brsFinal.findUniqueOrThrow({where:{id:official.id}});assert.equal(officialAfter.score,official.score);assert(officialAfter.needsReview);
  event=(await full(id)).modules[0].events.find(e=>e.id===hw.id);
  await assert.rejects(()=>save(id,{operation:'PRIMARY_SCALE',eventId:event.id,scaleVersion:event.scaleVersion,primaryMax:2000,confirmed:true,reason:'Слишком маленький максимум'}),/меньше уже выставленного/);
  await save(id,{operation:'PRIMARY_SCALE',eventId:event.id,scaleVersion:event.scaleVersion,primaryMax:6000,confirmed:true,reason:'Проверка утраты оснований после пересчёта'});assert.equal((await calc()).admission.approved,false);assert.equal((await calc()).calculation.academic.state,'FAILED');
  await assert.rejects(()=>save(id,{operation:'RESULT',eventId:event.id,studentId:alex.id,version:(current.results.find(r=>r.eventId===hw.id)).version,scoringMode:'PRIMARY',primaryScore:-1,reason:'Проверка границ'}),/изменились|диапазона/);
  await assert.rejects(()=>save(id,{operation:'PRIMARY_SCALE',eventId:event.id,scaleVersion:event.scaleVersion,primaryMax:0}),/положительным|от 0,01|изменились/);
  await assert.rejects(()=>save(id,{operation:'PRIMARY_SCALE',eventId:event.id,scaleVersion:event.scaleVersion,primaryMax:3000},dean),/недоступна вашей роли/);
  const currentHW=(await full(id)).modules[0].events.find(e=>e.id===hw.id),currentRow=(await calc()).results.find(r=>r.eventId===hw.id);
  for(const primaryScore of [-1,currentHW.primaryMax+1,1.5])await assert.rejects(()=>save(id,{operation:'RESULT',eventId:hw.id,studentId:alex.id,version:currentRow.version,scoringMode:'PRIMARY',primaryScore,submissionTiming:'ON_TIME',reason:'Проверка допустимого первичного диапазона'}),/диапазона/);
  for(const primaryMax of [0,-1])await assert.rejects(()=>save(id,{operation:'PRIMARY_SCALE',eventId:hw.id,scaleVersion:currentHW.scaleVersion,primaryMax}),/от 0,01/);
  await assert.rejects(()=>save(id,{operation:'PRIMARY_SCALE',eventId:hw.id,scaleVersion:currentHW.scaleVersion,primaryMax:6000,maxScore:9999}),/Рейтинговый максимум/);
  await save(id,{operation:'RESULT',eventId:hw.id,studentId:alex.id,version:currentRow.version,scoringMode:'PRIMARY',primaryScore:0,submissionTiming:'LATE',reason:'Явно выставленный нулевой первичный результат',comment:''});assert.equal((await calc()).results.find(r=>r.eventId===hw.id).score,0);
  await save(id,{operation:'RESULT',eventId:hw.id,studentId:alex.id,version:currentRow.version+1,scoringMode:'PRIMARY',primaryScore:2400,submissionTiming:'LATE',reason:'Восстановление тестового первичного результата',comment:''});
  // A historical lab status is retained until an authorized correction.
  await db.brsResult.create({data:{eventId:labs[0].id,studentId:maria.id,authorId:teacher.id,score:150,labStatus:'IN_PROGRESS',comment:'Приватный исторический комментарий'}});
  const legacyLab=await db.brsResult.findUniqueOrThrow({where:{eventId_studentId:{eventId:labs[0].id,studentId:maria.id}}}),labScale=(await full(id)).modules[0].events.find(e=>e.id===labs[0].id);
  await save(id,{operation:'PRIMARY_SCALE',eventId:labScale.id,scaleVersion:labScale.scaleVersion,primaryMax:4000,confirmed:true,reason:'Проверка сохранности прямой исторической лабораторной оценки'});
  const legacyAfter=await db.brsResult.findUniqueOrThrow({where:{id:legacyLab.id}});assert.equal(legacyAfter.score,150);assert.equal(legacyAfter.primaryMax,null);assert.equal(legacyAfter.primaryScore,null);assert.equal(legacyAfter.labStatus,'IN_PROGRESS');assert.equal(legacyAfter.version,legacyLab.version);
  await save(id,{operation:'RESULT',eventId:labs[0].id,studentId:maria.id,version:legacyLab.version,scoringMode:'LEGACY',score:175,labStatus:'COMPLETED',performedOn:d(labs[0].plannedOn),comment:''});
  await save(id,{operation:'DELETE_RESULT',eventId:labs[0].id,studentId:maria.id,version:legacyLab.version+1,confirmed:true});assert((await db.brsResult.findUniqueOrThrow({where:{id:legacyLab.id}})).deleted);
  await save(id,{operation:'RESULT',eventId:labs[0].id,studentId:maria.id,version:legacyLab.version+2,scoringMode:'LEGACY',score:150,labStatus:'FAILED',comment:''});
  assert.equal((await db.brsResult.findUniqueOrThrow({where:{id:legacyLab.id}})).deleted,false);
  assert(await db.brsAudit.count({where:{planId:id,action:'DELETE_RESULT',beforeJson:{contains:legacyLab.id}}}));
  await assert.rejects(()=>save(id,{operation:'RESULT',eventId:labs[1].id,studentId:maria.id,version:0,scoringMode:'PRIMARY',primaryScore:1501,labStatus:'COMPLETED'}),/диапазона/);
  await assert.rejects(()=>save(id,{operation:'RESULT',eventId:labs[1].id,studentId:maria.id,version:0,scoringMode:'PRIMARY',primaryScore:100,labStatus:'IN_PROGRESS'}),/Некорректный статус/);
  const racePlan=await full(id),raceEvent=racePlan.modules[0].events.find(e=>e.id===interim.id),raceRow=(await calc()).results.find(r=>r.eventId===interim.id);
  const races=await Promise.allSettled([
    save(id,{operation:'PRIMARY_SCALE',revision:racePlan.revision,eventId:interim.id,scaleVersion:raceEvent.scaleVersion,primaryMax:3000,confirmed:true,reason:'Конкурентная критическая перенастройка шкалы'}),
    save(id,{operation:'RESULT',revision:racePlan.revision,eventId:interim.id,studentId:alex.id,version:raceRow.version,scoringMode:'PRIMARY',primaryScore:1000,passed:true,submissionTiming:'ON_TIME',reason:'Конкурентная корректировка первичного результата'})
  ]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1,'Concurrent scale/result changes must not both overwrite the same revision');
  let resetEvent=(await full(id)).modules[0].events.find(e=>e.id===interim.id);await save(id,{operation:'PRIMARY_SCALE',eventId:interim.id,scaleVersion:resetEvent.scaleVersion,primaryMax:4000,confirmed:true,reason:'Восстановление изолированной тестовой шкалы после гонки'});
  const resetRow=(await calc()).results.find(r=>r.eventId===interim.id);await save(id,{operation:'RESULT',eventId:interim.id,studentId:alex.id,version:resetRow.version,scoringMode:'PRIMARY',primaryScore:1200,passed:true,submissionTiming:'ON_TIME',reason:'Восстановление изолированного тестового результата после гонки'});
  let homeworkScale=(await full(id)).modules[0].events.find(e=>e.id===hw.id);
  await save(id,{operation:'PRIMARY_SCALE',eventId:hw.id,scaleVersion:homeworkScale.scaleVersion,primaryMax:3000,confirmed:true,reason:'Подготовка согласованного официального снимка для проверки перепривязки'});
  const oldFinal=await db.brsFinal.findUniqueOrThrow({where:{planId_studentId:{planId:id,studentId:alex.id}}});await save(id,{operation:'FINALIZE',studentId:alex.id,version:oldFinal.version,reason:'Явная фиксация тестового итога до изменения календарной привязки'});
  const protectedFinal=await db.brsFinal.findUniqueOrThrow({where:{id:oldFinal.id}}),beforeRelink=(await calc()).calculation;
  await executeScheduleCommand(db,dean,{operation:'EXTRA',groupIds:[group.id],teacherIds:[teacher.id],disciplineId:discipline.id,roomId:room.id,termId:term.id,date:'2027-01-06',start:'20:00',end:'21:00',kind:'PRACTICE',weekPattern:'EVERY',isPublished:true});
  await save(id,{operation:'SYNC',reason:'Добавлено настоящее дополнительное занятие в изолированной фикстуре'},dean);
  const extra=(await full(id)).occurrences.find(o=>d(o.date)==='2027-01-06');
  await save(id,{operation:'RELINK',eventId:seminar.id,occurrenceId:extra.id,reason:'Контролируемая перепривязка семинара с сохранением истории'},dean);
  const relinkedFinal=await db.brsFinal.findUniqueOrThrow({where:{id:oldFinal.id}});assert(relinkedFinal.needsReview);assert.equal(relinkedFinal.score,protectedFinal.score);assert.equal((await calc()).calculation.total,beforeRelink.total-seminar.maxScore);
  assert.equal((await db.brsAttendance.findUniqueOrThrow({where:{occurrenceId_studentId:{occurrenceId:seminar.occurrenceId,studentId:alex.id}}})).mark,'ACTIVE');
  await save(id,{operation:'RELINK',eventId:seminar.id,occurrenceId:seminar.occurrenceId,reason:'Восстановление исходной привязки изолированного семинара'},dean);
  homeworkScale=(await full(id)).modules[0].events.find(e=>e.id===hw.id);await save(id,{operation:'PRIMARY_SCALE',eventId:hw.id,scaleVersion:homeworkScale.scaleVersion,primaryMax:6000,confirmed:true,reason:'Восстановление проверки недопуска в изолированной фикстуре'});
  const studentDTO=serializeWorkspace(await getBrsWorkspace(db,alex,id));assert(!JSON.stringify(studentDTO).includes('Приватный исторический комментарий'));assert(!JSON.stringify(studentDTO.overview).includes('В работе'));
  const audits=await db.brsAudit.findMany({where:{planId:id,action:'PRIMARY_SCALE'}});assert(audits.some(row=>row.beforeJson?.includes('primaryScore')&&row.afterJson?.includes('preview')));
  pass('Refinements: exact primary arithmetic, three labs, binary seminars, manual timing, automatic completion, scale consequences and preserved official history');
  return {id,homeworkId:hw.id,interimId:interim.id,labId:labs[0].id};
}
