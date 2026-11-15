import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { calculateStudent, planInclude } from '../src/lib/brs-repository.ts';
const db=createPrismaClient();let reviewed=0;
try {
  await db.$transaction(async tx=>{
    await tx.scheduleWriteState.upsert({where:{id:'schedule'},create:{id:'schedule'},update:{revision:{increment:0}}});
    const finals=await tx.brsFinal.findMany();
    for(const final of finals){
      const requestId='seminar-policy-v2-'+final.id;
      if(await tx.brsAudit.findUnique({where:{actorId_requestId:{actorId:final.authorId,requestId}}}))continue;
      const plan=await tx.brsPlan.findUniqueOrThrow({where:{id:final.planId},include:planInclude});
      const {calculation}=await calculateStudent(tx,plan,final.studentId);
      if(calculation.exactTotal.numerator===String(final.score)&&calculation.exactTotal.denominator==='1'&&calculation.rating===final.rating)continue;
      const after=await tx.brsFinal.update({where:{id:final.id},data:{needsReview:true,version:{increment:1}}});
      await tx.brsPlan.update({where:{id:plan.id},data:{revision:{increment:1}}});
      await tx.brsAudit.create({data:{actorId:final.authorId,planId:plan.id,objectId:final.studentId,action:'SEMINAR_POLICY_CHANGE',requestId,commandHash:'seminar-attendance-policy-v2',beforeJson:JSON.stringify(final),afterJson:JSON.stringify({official:after,calculation}),reason:'Автоматическая служебная пометка: пользователь изменил правило семинаров на начисление по посещаемости. Утверждённые баллы не изменены; необходим отдельный пересмотр.'}});
      reviewed++;
    }
  },{timeout:60000,maxWait:15000});
  console.info(JSON.stringify({officialSnapshotsPreserved:true,markedForReview:reviewed}));
} finally {await db.$disconnect();}
