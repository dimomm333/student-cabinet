import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import sharp from 'sharp';
import { prepareOfficialPhoto } from '../src/lib/student-photo.ts';

export async function verifyStudentProfile({page,context,db,user,foreign,base,settle,field,password}) {
  const profile = await db.studentProfile.findUniqueOrThrow({where:{userId:user.id}});
  const group = await db.studyGroup.findUniqueOrThrow({where:{id:profile.groupId}});
  const originalPhoto=await db.studentOfficialPhoto.findUnique({where:{userId:user.id}});
  const fixture={lastName:'Тестов',firstName:'Александр',middleName:'Сергеевич',gender:'MALE',citizenship:'Тестовое гражданство',contactPhone:'+7 000 123-45-67',educationLevel:'Бакалавриат',fundingBasis:'Бюджет',enrolledAt:new Date('2024-09-01T00:00:00Z'),expectedGraduationYear:2028,educationStatus:'STUDYING',personalFileNumber:'FIXTURE-PRIVATE-2024',residenceStatus:'RESIDENT',dormitory:'Учебное общежитие № 2',dormitoryRoom:'315',institute:'Институт цифровых технологий',program:'Неактуальное название программы',groupName:'Неактуальная группа',course:99,studyMode:'Очная форма'};
  await db.studentProfile.update({where:{userId:user.id},data:fixture});
  const photo=await prepareOfficialPhoto(await sharp({create:{width:144,height:192,channels:3,background:'#52694a'}}).png().toBuffer(),'image/png');
  const foreignPhoto=await prepareOfficialPhoto(await sharp({create:{width:144,height:192,channels:3,background:'#756380'}}).png().toBuffer(),'image/png');
  await db.studentOfficialPhoto.upsert({where:{userId:user.id},update:photo,create:{userId:user.id,...photo}});
  await db.studentOfficialPhoto.upsert({where:{userId:foreign.id},update:foreignPhoto,create:{userId:foreign.id,...foreignPhoto}});
  await page.reload(); await settle(page);
  assert.equal(await page.locator('.student-profile input, .student-profile select, .student-profile textarea, .student-profile button, .student-profile form').evaluateAll(elements => elements.filter(e => !e.closest('.profile-settings')).length),0,'Official student profile must be read-only');
  const expected=[['Фамилия','Тестов'],['Имя','Александр'],['Отчество','Сергеевич'],['Пол','Мужской'],['Гражданство',fixture.citizenship],['Контактный телефон',fixture.contactPhone],['Университетская электронная почта',user.email],['Институт',fixture.institute],['Образовательная программа',group.programme],['Уровень образования','Бакалавриат'],['Учебная группа',group.code],['Курс',String(group.course)],['Форма обучения',fixture.studyMode],['Основа обучения','Бюджет'],['Дата зачисления','1 сентября 2024 г.'],['Предполагаемый год окончания','2028'],['Статус обучения','Обучается'],['Номер личного дела',fixture.personalFileNumber],['Статус проживания','Требуется сверка'],['Общежитие','Не указано'],['Комната','Не указано'],['Роль','Студент']];
  for(const [label,value] of expected)await expect(field(label)).toHaveText(value);
  await expect(page.locator('.student-profile-identity h2')).toHaveText('Тестов Александр Сергеевич');
  for(const title of ['Личные данные','Обучение','Документы','Общежитие','Учётная запись'])await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(page.locator('.student-profile')).not.toContainText('Номер студенческого билета');
  await expect(page.locator('.student-profile')).not.toContainText('Подтверждение почты');
  await expect(page.getByRole('link',{name:'На главную кабинета',exact:true})).toHaveCount(0);
  await expect(page.locator('.student-profile-help')).toContainText('после проверки заявления');
  await expect(page.locator('.student-profile-help a')).toHaveAttribute('href','/dashboard/services?service=personal-change');
  await expect(page.locator('.services-military')).toContainText('Сведения не предоставлены');
  await expect(page.locator('.services-military a')).toHaveAttribute('href','/dashboard/services?service=military-change');
  const img=page.locator('.student-portrait img');
  await expect(img).toBeVisible();
  await expect.poll(()=>img.evaluate(image=>image.complete && image.naturalWidth>0)).toBe(true);
  const response=await context.request.get(base+'/api/student/profile/photo');
  assert.equal(response.status(),200); assert.equal(response.headers()['content-type'],'image/jpeg');
  assert.match(response.headers()['cache-control'],/no-store/); assert.equal(response.headers()['x-content-type-options'],'nosniff');
  assert.deepEqual(await response.body(),Buffer.from(photo.content));
  const foreignContext=await context.browser().newContext();
  try {
    const login=await foreignContext.request.post(base+'/api/auth/sign-in/email',{headers:{Origin:base},data:{email:foreign.email,password}});
    assert.equal(login.status(),200);
    const theirs=await foreignContext.request.get(base+'/api/student/profile/photo');
    assert.equal(theirs.status(),200);
    assert.deepEqual(await theirs.body(),Buffer.from(foreignPhoto.content));
    assert.notDeepEqual(await theirs.body(),Buffer.from(photo.content));
    assert.equal((await foreignContext.request.get(base+'/api/student/profile/photo?userId='+user.id)).status(),400);
  } finally { await foreignContext.close(); }
  for(const suffix of ['?userId='+foreign.id,'?id='+foreign.id,'?email='+foreign.email])assert.equal((await context.request.get(base+'/api/student/profile/photo'+suffix)).status(),400);
  assert.equal((await context.request.get(base+'/api/student/profile/photo/'+foreign.id)).status(),404);
  const saved=await db.studentProfile.findUnique({where:{userId:user.id}});
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await context.request.fetch(base+'/api/student/profile/photo',{method,data:{userId:user.id,content:'bad'}})).status(),405);
  assert.equal((await context.request.post(base+'/api/auth/update-user',{headers:{Origin:base},data:{name:'HACK',role:'ADMIN',studentProfile:{educationStatus:'GRADUATED'}}})).status(),404);
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await context.request.fetch(base+'/api/student/profile',{method,data:{userId:foreign.id,educationStatus:'GRADUATED'}})).status(),404);
  assert.deepEqual(await db.studentProfile.findUnique({where:{userId:user.id}}),saved);
  assert.deepEqual(await (await context.request.get(base+'/api/student/profile/photo')).body(),Buffer.from(photo.content));
  for(const path of ['/api/v1/groups','/api/v1/teachers','/api/v1/schedule?group=pi-24-1&week=2026-11-09','/','/schedule?group=pi-24-1&week=2026-11-09']) {
    const publicResponse=await context.request.get(base+path);
    assert.equal(publicResponse.status(),200);
    const text=await publicResponse.text();
    for(const secret of [fixture.personalFileNumber,fixture.citizenship,fixture.contactPhone,'officialPhoto','dormitoryRoom','lastName'])assert(!text.includes(secret),'Private field in public response: '+path);
  }
  for(const [educationStatus,label] of Object.entries({STUDYING:'Обучается',ACADEMIC_LEAVE:'В академическом отпуске',EXPELLED:'Отчислен',GRADUATED:'Завершил обучение',TRANSFERRED:'Переведён в другой университет'})) {
    await db.studentProfile.update({where:{userId:user.id},data:{educationStatus}});
    await page.reload(); await settle(page);
    await expect(field('Статус обучения')).toHaveText(label);
    await expect(page.locator('.student-status')).toContainText(label);
  }
  for(const [residenceStatus,label] of [[null,'Нет данных'],['NON_RESIDENT','Не проживает'],['RESIDENT','Требуется сверка']]) {
    await db.studentProfile.update({where:{userId:user.id},data:{residenceStatus,dormitory:residenceStatus==='RESIDENT'?fixture.dormitory:null,dormitoryRoom:residenceStatus==='RESIDENT'?'315':null}});
    await page.reload(); await settle(page);
    await expect(field('Статус проживания')).toHaveText(label);
    await expect(field('Общежитие')).toHaveText('Не указано');
    await expect(field('Комната')).toHaveText('Не указано');
  }
  const missing=Object.fromEntries(Object.keys(fixture).map(key=>[key,null]));
  await db.studentProfile.update({where:{userId:user.id},data:{...missing,groupId:null}});
  await db.studentOfficialPhoto.delete({where:{userId:user.id}});
  await page.reload(); await settle(page);
  for(const [label] of expected.filter(([label])=>!['Контактный телефон','Университетская электронная почта','Роль','Статус проживания'].includes(label)))await expect(field(label)).toHaveText('Не указано');
  await expect(field('Статус проживания')).toHaveText('Нет данных');
  await expect(field('Контактный телефон')).toHaveCount(0);
  await expect(page.locator('.student-portrait-placeholder')).toBeVisible();
  assert.equal((await context.request.get(base+'/api/student/profile/photo')).status(),404);
  const emptyStrings=Object.fromEntries(Object.entries(fixture).filter(([,value])=>typeof value==='string').filter(([key])=>!['gender','educationStatus','residenceStatus'].includes(key)).map(([key])=>[key,'']));
  await db.studentProfile.update({where:{userId:user.id},data:emptyStrings});
  await page.reload(); await settle(page);
  for(const label of ['Фамилия','Имя','Отчество','Гражданство','Институт','Образовательная программа','Уровень образования','Учебная группа','Форма обучения','Основа обучения','Номер личного дела','Общежитие','Комната'])await expect(field(label)).toHaveText('Не указано');
  await db.studentProfile.delete({where:{userId:user.id}});
  await page.reload(); await settle(page);
  await expect(field('Фамилия')).toHaveText('Не указано');
  await expect(field('Университетская электронная почта')).toHaveText(user.email);
  await db.studentProfile.create({data:profile});
  if(originalPhoto)await db.studentOfficialPhoto.create({data:originalPhoto});
  await page.reload(); await settle(page);
}
