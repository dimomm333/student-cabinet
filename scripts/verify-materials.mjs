import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { crc32, deflateRawSync } from 'node:zlib';
import { createClient } from '@libsql/client';
import { chromium, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import sharp from 'sharp';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { provisionTestDatabase } from './test-fixtures.mjs';
import { fingerprint, integrity } from './database-snapshot.mjs';
import { seedBrsDemo } from '../prisma/brs-demo.ts';
import { executeMaterialCommand, listMaterials, downloadMaterial } from '../src/lib/materials-repository.ts';
import { receiveMaterialFile, readMaterialBlob, removeMaterialBlob } from '../src/lib/materials-storage.ts';
import { listNotifications, savePreferences } from '../src/lib/notifications-repository.ts';
import { allNotificationCategories } from '../src/lib/notifications-shared.ts';
import { verifyResponsiveMaterials } from './materials-responsive-checks.mjs';

mkdirSync('.local',{recursive:true});
const root=mkdtempSync(resolve('.local/materials-test-')), source=createClient({url:getDatabaseUrl()}), before=await fingerprint(source);
const env=provisionTestDatabase(resolve(root,'test.db')); process.env.DATABASE_URL=env.DATABASE_URL;
process.env.MATERIALS_STORAGE_DIR=resolve(root,'files'); env.MATERIALS_STORAGE_DIR=process.env.MATERIALS_STORAGE_DIR;
process.env.MATERIALS_MAX_FILE_MB='32'; env.MATERIALS_MAX_FILE_MB='32';
const db=createPrismaClient(), results=[], diagnostics=[], layoutMetrics=[], password=randomBytes(24).toString('base64url');
let browser,child,logs='';
const pass=name=>{results.push(name);console.info('PASS: '+name);};
async function actor(u) { const s=await db.session.create({data:{userId:u.id,token:randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+3600000)}});return {id:u.id,sessionId:s.id}; }
function zip(entries) {
  const parts=[],central=[];let offset=0;
  for(const [name,input] of entries) {
    const bytes=Buffer.from(input), n=Buffer.from(name), packed=deflateRawSync(bytes), crc=crc32(bytes), local=Buffer.alloc(30), dir=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(n.length,26);
    dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(8,10);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(packed.length,20);dir.writeUInt32LE(bytes.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);
    parts.push(local,n,packed);central.push(dir,n);offset+=local.length+n.length+packed.length;
  }
  const dirs=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dirs.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,dirs,end]);
}
function cfb(streamName) {
  const b=Buffer.alloc(2048);Buffer.from('d0cf11e0a1b11ae1','hex').copy(b);b.writeUInt16LE(0x3e,24);b.writeUInt16LE(3,26);b.writeUInt16LE(0xfffe,28);b.writeUInt16LE(9,30);b.writeUInt16LE(6,32);b.writeUInt32LE(1,44);b.writeUInt32LE(0,48);b.writeUInt32LE(4096,56);b.writeUInt32LE(0xfffffffe,60);b.writeUInt32LE(0xfffffffe,68);
  for(let p=76;p<512;p+=4)b.writeUInt32LE(0xffffffff,p);b.writeUInt32LE(1,76);
  function entry(offset,name,type,child) {const text=Buffer.from(name+'\0','utf16le');text.copy(b,offset);b.writeUInt16LE(text.length,offset+64);b[offset+66]=type;b[offset+67]=1;b.writeUInt32LE(0xffffffff,offset+68);b.writeUInt32LE(0xffffffff,offset+72);b.writeUInt32LE(child,offset+76);b.writeUInt32LE(0xfffffffe,offset+116);}
  entry(512,'Root Entry',5,1);entry(640,streamName,2,0xffffffff);
  for(let p=1024;p<1536;p+=4)b.writeUInt32LE(0xffffffff,p);b.writeUInt32LE(0xfffffffe,1024);b.writeUInt32LE(0xfffffffd,1028);return b;
}
async function staged(name,bytes) { return receiveMaterialFile(new Request('http://test.invalid',{method:'POST',headers:{'x-file-name':encodeURIComponent(name)},body:bytes})); }
async function freePort() {const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
try {
  await seedBrsDemo(db);
  const [student,maria,teacher,admin,staff,dean]=await Promise.all(['alexander.smirnov','maria.volkova','mikhail.sokolov','irina.lebedeva','sergey.petrov','olga.kuznetsova'].map(email=>db.user.findUniqueOrThrow({where:{email:email+'@example.test'}})));
  const a=await actor(student),t=await actor(teacher),m=await actor(maria);
  const assignment=await db.teachingAssignment.findFirstOrThrow({where:{teacherId:teacher.id,isActive:true},include:{group:true,term:true}});
  const {disciplineId,termId,groupId}=assignment,scope={disciplineId,termId};
  const subgroup=await db.studyGroup.create({data:{slug:'materials-sub',code:'Материалы-подгруппа',parentId:groupId,programme:assignment.group.programme,course:2}});
  const foreign=await db.studyGroup.create({data:{slug:'materials-foreign',code:'Материалы-чужая',programme:'Чужая',course:2}});
  await db.studentProfile.update({where:{userId:student.id},data:{groupId:subgroup.id}});
  await db.studentProfile.update({where:{userId:maria.id},data:{groupId:foreign.id}});
  const command=(operation,extra={})=>({...scope,...extra,operation,requestId:randomUUID()});
  const run=(operation,extra={})=>executeMaterialCommand(db,t,command(operation,extra));
  const folder=await run('CREATE_FOLDER',{name:'Пределы',category:'LECTURES'});
  const subfolder=await run('CREATE_FOLDER',{name:'Подпапка',category:'LECTURES',parentId:folder.id});
  await assert.rejects(()=>run('EDIT_FOLDER',{id:folder.id,version:1,name:'Цикл',category:'LECTURES',parentId:subfolder.id}),/Циклическое/);
  await assert.rejects(()=>run('DELETE_FOLDER',{id:folder.id,version:1,confirmed:true}),/не пуста/);
  const linkCommand=command('CREATE_LINK',{title:'Учебная ссылка',description:'Описание',url:'https://example.org/course',category:'LECTURES',folderId:subfolder.id,groupIds:[groupId,subgroup.id]});
  const link=await executeMaterialCommand(db,t,linkCommand); assert.deepEqual(await executeMaterialCommand(db,t,linkCommand),link);
  await assert.rejects(()=>executeMaterialCommand(db,t,{...linkCommand,title:'Подмена'}),/Ключ/);
  await assert.rejects(()=>run('CREATE_LINK',{...linkCommand,requestId:randomUUID(),groupIds:[foreign.id]}),/Назначение/);
  await assert.rejects(()=>run('CREATE_LINK',{...linkCommand,requestId:randomUUID(),url:'javascript:alert(1)'}),/HTTP/);
  assert.equal((await listMaterials(db,a,scope)).items.length,0);assert.equal(await db.notificationEvent.count({where:{source:'MATERIALS'}}),0);
  pass('Folders, subfolders, cycles, nonempty deletion, draft privacy, real assignments, multiple targets and idempotency');

  const pdf=await PDFDocument.create(),p=pdf.addPage();p.drawText('Lecture 1');
  const annotation=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[20,20,120,60],A:{S:'URI',URI:PDFString.of('https://example.org')}}));p.node.set(PDFName.of('Annots'),pdf.context.obj([annotation]));
  const pdfBytes=Buffer.from(await pdf.save());
  const samples=[['Лекция 1.pdf',pdfBytes],['Текст.txt',Buffer.from('Учебный материал')],['Изображение.png',await sharp({create:{width:20,height:20,channels:3,background:'#245b45'}}).png().toBuffer()],['Фото.jpg',await sharp({create:{width:20,height:20,channels:3,background:'#245b45'}}).jpeg().toBuffer()],['Архив.zip',zip([['notes.txt','Учебные заметки']])]];
  samples.push(['Unicode.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from('Текст Windows','utf16le')])],['Старый формат.doc',cfb('WordDocument')],['Старый формат.ppt',cfb('PowerPoint Document')],['Старый формат.xls',cfb('Workbook')]);
  for(const [ext,main,type,xml] of [['docx','word/document.xml','wordprocessingml.document','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'],['pptx','ppt/presentation.xml','presentationml.presentation','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'],['xlsx','xl/workbook.xml','spreadsheetml.sheet','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>']]) samples.push(['Документ.'+ext,zip([['[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`],[main,xml]])]);
  const uploaded=[];
  for(const [name,bytes] of samples) {
    const file=await staged(name,bytes),c=command('UPLOAD',{title:name==='Текст.txt'?' ':name,category:'LECTURES',groupIds:[groupId,subgroup.id],folderId:subfolder.id});
    const item=await executeMaterialCommand(db,t,c,file);uploaded.push(item.id);
    assert((await readMaterialBlob(file.key)).equals(bytes));
    const again=await staged(name,bytes);assert.deepEqual(await executeMaterialCommand(db,t,c,again),item);await removeMaterialBlob(again.key);
  }
  for(const [name,bytes] of [['fake.pdf',Buffer.from('MZ fake')],['bad.txt',Buffer.from('<html><script>bad</script></html>')],['../evil.txt',Buffer.from('bad')],['escape.zip',zip([['../../evil.txt','bad']])],['bomb.zip',zip([['huge.txt',Buffer.alloc(2*1048576)]])],['fake.docx',zip([['notes.txt','not office']])],['wrong.doc',cfb('Workbook')],['self-extractor.zip',Buffer.concat([Buffer.from('MZ'),zip([['text.txt','text']])])]]) await assert.rejects(()=>staged(name,bytes));
  await assert.rejects(()=>receiveMaterialFile(new Request('http://test.invalid',{method:'POST',headers:{'x-file-name':'large.txt','content-length':String(33*1048576)},body:'x'})),/превышает/);
  pass('PDF hyperlinks, Office Open XML, text, images and ZIP; streaming storage, retries, spoofed types, traversal and ZIP bomb limits');
  const publication=command('PUBLISH',{items:[link.id,...uploaded].map(id=>({id,version:1}))});
  await savePreferences(db,a,{optionalCategories:allNotificationCategories,emailCategories:['STUDY'],personalEmail:true});
  await executeMaterialCommand(db,t,publication);await executeMaterialCommand(db,t,publication);
  assert.equal(await db.notificationEvent.count({where:{source:'MATERIALS'}}),1);
  assert.equal(await db.notification.count({where:{recipientId:student.id,event:{source:'MATERIALS'}}}),1);
  assert.equal(await db.notificationEmail.count({where:{notification:{recipientId:student.id,event:{source:'MATERIALS'}}}}),1);
  assert.equal((await listMaterials(db,a,scope)).items.length,samples.length+1);
  assert((await listMaterials(db,a,{...scope,q:'текст'})).items.some(item=>item.title==='Текст' && item.file.name==='Текст.txt'));
  await assert.rejects(()=>listMaterials(db,m,scope),/недоступна/);
  const download=await downloadMaterial(db,a,uploaded[0]);assert((await readMaterialBlob(download.key)).equals(pdfBytes));
  await assert.rejects(()=>downloadMaterial(db,m,uploaded[0]),/недоступен/);
  await assert.rejects(()=>executeMaterialCommand(db,a,command('PUBLISH',{items:[{id:link.id,version:2}]})),/преподавателю/);
  await assert.rejects(()=>run('EDIT',{id:link.id,version:1,...linkCommand}),/изменены/);
  const edits=await Promise.allSettled([run('EDIT',{...linkCommand,id:link.id,version:2,title:'Первая правка'}),run('EDIT',{...linkCommand,id:link.id,version:2,title:'Вторая правка'})]);
  assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);
  await run('UNPUBLISH',{id:uploaded[0],version:2});await assert.rejects(()=>downloadMaterial(db,a,uploaded[0]),/недоступен/);
  await run('PUBLISH',{items:[{id:uploaded[0],version:3}]});assert.equal(await db.notificationEvent.count({where:{source:'MATERIALS'}}),1);
  for(const u of [admin,staff,dean]) {const ua=await actor(u);await assert.rejects(()=>listMaterials(db,ua),/не предоставлен/);await assert.rejects(()=>downloadMaterial(db,ua,uploaded[0]),/не предоставлен/);}
  const historical=await db.academicTerm.create({data:{code:'materials-archive',name:'Весна 2025',startsOn:new Date('2025-02-01'),endsOn:new Date('2025-06-30'),firstNumeratorMonday:new Date('2025-02-03')}});
  const oldAssignment=await db.teachingAssignment.create({data:{teacherId:teacher.id,disciplineId,termId:historical.id,groupId}});
  const oldCommand={...linkCommand,requestId:randomUUID(),termId:historical.id,folderId:null,title:'Архивный материал'};
  const old=await executeMaterialCommand(db,t,oldCommand);await executeMaterialCommand(db,t,{...command('PUBLISH',{items:[{id:old.id,version:1}]}),termId:historical.id});
  await db.teachingAssignment.update({where:{id:oldAssignment.id},data:{isActive:false}});
  assert((await listMaterials(db,a,{disciplineId,termId:historical.id})).items.some(m=>m.id===old.id));
  assert.equal((await listMaterials(db,t,{disciplineId,termId:historical.id})).items[0].editable,false);
  await assert.rejects(()=>executeMaterialCommand(db,t,{...oldCommand,operation:'EDIT',requestId:randomUUID(),id:old.id,version:2}),/Назначение/);
  await db.teachingAssignment.update({where:{id:assignment.id},data:{isActive:false}});
  await assert.rejects(()=>run('UNPUBLISH',{id:uploaded[0],version:4}),/Назначение/);
  await db.teachingAssignment.update({where:{id:assignment.id},data:{isActive:true}});
  pass('One publication event and email outbox, ownership, all five roles, conflicts, unpublish, republish, archive and revoked assignments');

  // Two independently assigned groups share one logical record and physical file.
  const extraAssignment=await db.teachingAssignment.create({data:{teacherId:teacher.id,disciplineId,termId,groupId:foreign.id}});
  const shared=await run('CREATE_LINK',{title:'Две группы',url:'https://example.org/shared',category:'OTHER',groupIds:[groupId,foreign.id]});
  await run('PUBLISH',{items:[{id:shared.id,version:1}]});
  assert((await listMaterials(db,m,scope)).items.some(item=>item.id===shared.id));
  await run('DELETE',{id:shared.id,version:2,confirmed:true});
  assert(!(await listNotifications(db,m)).items.some(n=>n.source==='MATERIALS'));
  await db.teachingAssignment.update({where:{id:extraAssignment.id},data:{isActive:false}});
  const sibling=await db.studyGroup.create({data:{slug:'materials-sibling',code:'Соседняя подгруппа',programme:assignment.group.programme,course:2,parentId:groupId}});
  await db.studentProfile.update({where:{userId:maria.id},data:{groupId:sibling.id}});
  const subgroupBlob=await staged('Только подгруппа.txt',Buffer.from('Материал подгруппы'));
  const subgroupMaterial=await executeMaterialCommand(db,t,command('UPLOAD',{title:'Только своей подгруппе',category:'LABS',groupIds:[subgroup.id]}),subgroupBlob);
  await run('PUBLISH',{items:[{id:subgroupMaterial.id,version:1}]});
  assert((await listMaterials(db,a,scope)).items.some(i=>i.id===subgroupMaterial.id));
  assert(!(await listMaterials(db,m,scope)).items.some(i=>i.id===subgroupMaterial.id));await assert.rejects(()=>downloadMaterial(db,m,subgroupMaterial.id),/недоступен/);
  await db.studentProfile.update({where:{userId:student.id},data:{groupId}});await assert.rejects(()=>downloadMaterial(db,a,subgroupMaterial.id),/недоступен/);
  await db.studentProfile.update({where:{userId:student.id},data:{groupId:subgroup.id}});await db.studentProfile.update({where:{userId:maria.id},data:{groupId:foreign.id}});
  await run('EDIT_FOLDER',{id:subfolder.id,version:1,name:'Переименованная подпапка',category:'LECTURES',parentId:null});
  await run('DELETE_FOLDER',{id:folder.id,version:1,confirmed:true});
  assert.equal(await db.learningMaterial.count({where:{folderId:subfolder.id,deletedAt:null}}),samples.length+1);
  // The API paginates before serialization; drafts remain invisible to students.
  const manyIds=Array.from({length:55},()=>randomUUID());
  await db.learningMaterial.createMany({data:manyIds.map((id,i)=>({id,...scope,authorId:teacher.id,title:'Пагинация '+i,searchTitle:'пагинация '+i,category:'OTHER',url:'https://example.org/page',status:'DRAFT'}))});
  const many=await listMaterials(db,t,{...scope,q:'ПАГИНАЦИЯ'});assert.equal(many.total,55);assert.equal(many.items.length,50);assert.equal((await listMaterials(db,t,{...scope,q:'пагинация',page:1})).items.length,5);
  assert.equal((await listMaterials(db,a,{...scope,q:'ПАГИНАЦИЯ'})).total,0);
  await db.learningMaterial.deleteMany({where:{id:{in:manyIds}}});
  const anotherTeacher=await db.user.create({data:{name:'Другой преподаватель',email:'materials-teacher@example.test',role:'TEACHER'}}),otherActor=await actor(anotherTeacher);
  await db.teachingAssignment.create({data:{teacherId:anotherTeacher.id,...scope,groupId}});
  await assert.rejects(()=>executeMaterialCommand(db,otherActor,command('UNPUBLISH',{id:uploaded[0],version:4})),/недоступен/);
  const expired=await actor(teacher);await db.session.update({where:{id:expired.sessionId},data:{expiresAt:new Date(Date.now()-1000)}});
  await assert.rejects(()=>executeMaterialCommand(db,expired,command('CREATE_LINK',{...linkCommand})),/Сессия/);
  const eventsBeforeBrowser=await db.notificationEvent.count({where:{source:'MATERIALS'}});
  pass('Two independent groups, source revocation, safe folder moves/deletion, pagination, Russian case-insensitive search, foreign teacher and expired session');

  await db.account.updateMany({where:{providerId:'credential'},data:{password:await hashPassword(password)}});
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,NODE_ENV:'production',BETTER_AUTH_URL:base,BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),AUTH_TRUST_PROXY:'false',AUTH_PROXY_SECRET:''}});
  child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
  assert.equal((await fetch(base+'/api/materials')).status,401);
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
  async function signed(u) {
    const context=await browser.newContext({viewport:{width:1366,height:900}});
    const login=await context.request.post(base+'/api/auth/sign-in/email',{headers:{Origin:base},data:{email:u.email,password}});assert.equal(login.status(),200);
    const page=await context.newPage();page.on('pageerror',e=>diagnostics.push(e.message));page.on('console',msg=>{if(/hydration|Next\.js encountered|Blocking Route|Instant validation|uncached data|unstable value/i.test(msg.text()))diagnostics.push(msg.text());});page.on('dialog',dialog=>dialog.accept());return {context,page};
  }
  const teacherBrowser=await signed(teacher),page=teacherBrowser.page,context=teacherBrowser.context;
  assert.equal((await context.request.post(base+'/api/materials',{headers:{Origin:'https://evil.test'},data:linkCommand})).status(),403);
  const framed=(c,bytes)=>{const json=Buffer.from(JSON.stringify(c)),prefix=Buffer.alloc(4);prefix.writeUInt32BE(json.length);return Buffer.concat([prefix,json,bytes]);};
  const longMetadata=command('UPLOAD',{title:'Длинные параметры',description:'Кириллическое описание '.repeat(160),category:'OTHER',groupIds:[groupId]});
  const largeMetadataResponse=await context.request.post(base+'/api/materials?upload=1',{headers:{Origin:base,'X-File-Name':encodeURIComponent('Параметры.txt'),'Content-Type':'application/octet-stream'},data:framed(longMetadata,Buffer.from('Текст документа'))});assert.equal(largeMetadataResponse.status(),200);
  await run('DELETE',{id:(await largeMetadataResponse.json()).id,version:1,confirmed:true});
  const foreignUpload=await context.request.post(base+'/api/materials?upload=1',{headers:{Origin:base,'X-File-Name':'foreign.txt','Content-Type':'application/octet-stream'},data:framed({...longMetadata,requestId:randomUUID(),groupIds:[foreign.id]},Buffer.from('No access'))});assert.equal(foreignUpload.status(),403);
  const courseUrl='?'+new URLSearchParams(scope);
  await page.goto(base+'/teacher/materials'+courseUrl);await expect(page.getByRole('button',{name:'Добавить материалы'})).toBeVisible();
  await page.getByRole('button',{name:'Добавить материалы'}).click();
  const network=await context.newCDPSession(page);await network.send('Network.enable');await network.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1000000,uploadThroughput:16000});
  await page.locator('input[type=file]').setInputFiles([{name:'Браузерная лекция с очень длинным названием для проверки отображения документа на телефоне.txt',mimeType:'text/plain',buffer:Buffer.from('Первая браузерная лекция')},{name:'Браузерная практика.txt',mimeType:'text/plain',buffer:Buffer.from('Вторая браузерная лекция')}]);
  await page.getByRole('button',{name:'Сохранить черновики',exact:true}).click();await expect(page.getByRole('button',{name:'Опубликовать пакет (2)'})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Опубликовать пакет (2)'}).click();await expect(page.getByText('Материалы опубликованы одним пакетом.')).toBeVisible();
  await network.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  assert.equal(await db.notificationEvent.count({where:{source:'MATERIALS'}}),eventsBeforeBrowser+1);
  const browserMaterial=await db.learningMaterial.findFirstOrThrow({where:{title:{startsWith:'Браузерная лекция'}}});
  assert(!browserMaterial.title.endsWith('.txt'));
  await expect(page.locator('.material-card').filter({hasText:browserMaterial.title}).getByRole('heading')).toHaveText(browserMaterial.title);
  const manualTitle='Авторское название — Оригинал.txt';
  await page.getByRole('button',{name:'Добавить материалы'}).click();await page.getByLabel('Название материала',{exact:true}).fill(manualTitle);
  await page.locator('input[type=file]').setInputFiles([{name:'Оригинал.txt',mimeType:'text/plain',buffer:Buffer.from('Оригинальный файл')},{name:'Дополнение.txt',mimeType:'text/plain',buffer:Buffer.from('Дополнительный файл')}]);
  await page.getByRole('button',{name:'Сохранить черновики',exact:true}).click();await expect(page.getByRole('button',{name:'Опубликовать пакет (2)'})).toBeVisible({timeout:30000});await page.getByRole('button',{name:'Опубликовать пакет (2)'}).click();
  await expect(page.locator('.material-card').getByRole('heading',{name:manualTitle,exact:true})).toHaveCount(2);
  const originalCard=()=>page.locator('.material-card').filter({has:page.locator('.material-filename',{hasText:/^Оригинал\.txt$/})});
  await expect(originalCard()).toContainText('Опубликован');
  await originalCard().getByRole('button',{name:'Изменить / переместить'}).click();await expect(page.getByLabel('Название материала',{exact:true})).toHaveValue(manualTitle);
  await page.getByLabel('Название материала',{exact:true}).fill('');await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await expect(originalCard().getByRole('heading')).toHaveText('Оригинал');
  await expect(page.locator('.material-card').getByRole('heading',{name:manualTitle,exact:true})).toHaveCount(1);
  assert.equal((await db.learningMaterial.findFirstOrThrow({where:{file:{name:'Оригинал.txt'}}})).title,'Оригинал');
  await page.getByRole('button',{name:'+ Создать',exact:true}).click();await page.getByLabel('Название папки',{exact:true}).fill('Браузерная папка');await page.getByRole('button',{name:'Сохранить папку'}).click();
  await expect(page.getByRole('button',{name:'Изменить папку Браузерная папка',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Изменить папку Браузерная папка',exact:true}).click();await page.getByLabel('Название папки',{exact:true}).fill('Браузерная папка 2');await page.getByRole('button',{name:'Сохранить папку'}).click();
  await page.getByRole('button',{name:'Добавить материалы'}).click();await page.getByLabel('Название материала',{exact:true}).fill('Браузерный ресурс');await page.getByLabel('Внешняя ссылка',{exact:true}).fill('https://example.org/learning');
  const uiFolder=await db.materialFolder.findFirstOrThrow({where:{name:'Браузерная папка 2'}});await page.getByLabel('Папка материала',{exact:true}).selectOption(uiFolder.id);
  await page.getByRole('button',{name:'Сохранить черновики',exact:true}).click();
  const uiCard=()=>page.locator('.material-card').filter({has:page.getByRole('heading',{name:'Браузерный ресурс',exact:true})});
  await expect(uiCard()).toBeVisible();await uiCard().getByRole('button',{name:'Опубликовать',exact:true}).click();await expect(uiCard()).toContainText('Опубликован');
  await uiCard().getByRole('button',{name:'Изменить / переместить'}).click();await page.getByLabel('Категория материала',{exact:true}).selectOption('LABS');await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await expect(uiCard()).toContainText('Лабораторные');
  await uiCard().getByRole('button',{name:'Снять публикацию'}).click();await expect(uiCard()).toContainText('Черновик');
  await uiCard().getByRole('button',{name:'Удалить',exact:true}).click();await expect(uiCard()).toHaveCount(0);
  await page.getByRole('button',{name:'Изменить папку Браузерная папка 2',exact:true}).click();await page.getByRole('button',{name:'Удалить папку',exact:true}).click();await expect(page.getByRole('button',{name:'Изменить папку Браузерная папка 2',exact:true})).toHaveCount(0);
  pass('Teacher browser CRUD: folder create/rename/delete, external link, publish, edit/move, unpublish and confirmed deletion');
  const studentBrowser=await signed(student),sp=studentBrowser.page;
  await sp.goto(base+'/dashboard/materials'+courseUrl);await expect(sp.locator('.material-card').filter({hasText:browserMaterial.title})).toBeVisible();
  await expect(sp.locator('.material-card').getByRole('heading',{name:manualTitle,exact:true})).toHaveCount(1);
  await expect(sp.locator('.material-card').getByRole('heading',{name:'Оригинал',exact:true})).toHaveCount(1);
  await sp.getByRole('searchbox').fill(manualTitle);await expect(sp.locator('.material-card')).toHaveCount(1);await expect(sp.locator('.material-card h3')).toHaveText(manualTitle);await sp.getByRole('searchbox').fill('');
  assert.equal(await sp.getByRole('button',{name:'Добавить материалы'}).count(),0);
  const response=await studentBrowser.context.request.get(base+'/api/materials?file='+browserMaterial.id);assert.equal(response.status(),200);assert.match(response.headers()['content-disposition'],/^attachment/);assert.match(response.headers()['cache-control'],/no-store/);assert.equal((await response.body()).toString(),'Первая браузерная лекция');
  assert(response.headers()['content-disposition'].includes(encodeURIComponent((await db.materialFile.findUniqueOrThrow({where:{id:browserMaterial.fileId}})).name)));
  await sp.getByRole('searchbox').fill('Браузерная практика');await expect(sp.locator('.material-card')).toHaveCount(1);
  await sp.getByRole('searchbox').fill('Нет такого материала');await expect(sp.getByRole('heading',{name:'Материалы не найдены'})).toBeVisible();
  await sp.getByRole('searchbox').fill('');
  const notice=(await listNotifications(db,a)).items.find(n=>n.source==='MATERIALS'&&n.href.includes(browserMaterial.id));assert(notice);
  await sp.goto(base+notice.href);await expect(sp.locator('.material-focused')).toContainText(browserMaterial.title);
  await sp.goto(base+'/dashboard/materials'+courseUrl);await expect(sp.locator('.material-card')).not.toHaveCount(0);
  for(const width of [346,360,768,1366]) {
    for(const [role,p] of [['student',sp],['teacher',page]]) {
      await p.setViewportSize({width,height:900});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:resolve(root,`${role}-${width}.png`),fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const metrics=await p.locator('.materials-workspace').evaluate(el=>{const card=[...el.querySelectorAll('.material-card')].find(c=>c.querySelector('h3').textContent==='Браузерная практика');return {cardHeight:card.getBoundingClientRect().height,firstFileTop:el.querySelector('.material-card').getBoundingClientRect().top,filtersHeight:el.querySelector('.materials-tabs').getBoundingClientRect().height};});
      assert(metrics.cardHeight<=(role==='student'?180:width===1366?180:250),`${role} ${width}px: ordinary file rows became too tall`);
      assert(metrics.filtersHeight<=50,`${role} ${width}px: categories wrapped into multiple rows`);
      layoutMetrics.push({role,width,...metrics});
    }
  }
  await verifyResponsiveMaterials({studentPage:sp,teacherPage:page,base,courseUrl,termId,browserTitle:browserMaterial.title,root,pass});
  await sp.goto(base+'/dashboard/materials'+courseUrl);await expect(sp.locator('.material-card')).not.toHaveCount(0);
  await studentBrowser.context.setOffline(true);await sp.getByRole('button',{name:'Обновить',exact:true}).click();await expect(sp.locator('.materials-workspace [role=alert]')).toBeVisible();await studentBrowser.context.setOffline(false);await sp.getByRole('button',{name:'Обновить',exact:true}).click();await expect(sp.locator('.materials-workspace [role=alert]')).toHaveCount(0);
  const foreignBrowser=await signed(maria);assert.equal((await foreignBrowser.context.request.get(base+'/api/materials?file='+browserMaterial.id)).status(),404);
  for(const u of [admin,staff,dean]) {const b=await signed(u);assert.equal((await b.context.request.get(base+'/api/materials')).status(),403);await b.context.close();}
  assert.equal(diagnostics.length,0,diagnostics.join('\n'));assert(!/Next\.js encountered|Blocking Route|Instant validation/i.test(logs));
  pass('Production browser: batch upload, real progress, publication, authorized download, foreign denial, search, notification deep link, network recovery and 360/1366px');
  const check=createClient({url:env.DATABASE_URL});await integrity(check);check.close();
} finally {
  if(browser)await browser.close();
  if(child){const exited=new Promise(r=>child.once('exit',r));child.kill();await Promise.race([exited,new Promise(r=>setTimeout(r,5000))]);}
  await db.$disconnect();assert.equal(await fingerprint(source),before,'Main database changed');source.close();
  writeFileSync(resolve(root,'results.json'),JSON.stringify({results,diagnostics,layoutMetrics,sourceUnchanged:true},null,2),{mode:0o600});console.info('Materials report: '+root);
}
