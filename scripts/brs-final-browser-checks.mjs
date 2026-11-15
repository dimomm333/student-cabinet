import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {expect} from '@playwright/test';

export async function verifyFinalForms({browser,tc,ac,pageFor,base,fixture,examPlanId,root,pass}) {
  const teacher=await pageFor(tc,'/teacher/grades?planId='+fixture.id);
  const studentContext=await browser.newContext({storageState:{...(await ac.storageState()),origins:[]},viewport:{width:1366,height:900},reducedMotion:'reduce'});
  const student=await pageFor(studentContext,'/dashboard/grades?planId='+fixture.id);
  const assertOptional=async page=>{assert.equal(await page.getByRole('dialog').locator('textarea[required]').count(),0,'Teacher form requires free text');};
  const confirm=async page=>{const check=page.getByRole('dialog').getByRole('checkbox',{name:'Подтверждаю действие и сохранение истории изменений',exact:true});if(await check.count())await check.check();};
  const save=async page=>{await page.getByRole('dialog').getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();};
  const hw=()=>teacher.locator('.brs-journal tbody tr').first().getByRole('button',{name:/ДЗ1,/});
  try {
    assert.equal(await student.locator('.brs-tabs').count(),0);
    await expect(student.getByRole('button',{name:'Режим таблицы',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(student.locator('.brs-full')).toContainText('РК2/М1');await expect(student.locator('.brs-full')).toContainText('РК4/М2');
    await student.locator('.brs-full .brs-module-summary').first().click();const dialog=student.getByRole('dialog');
    await expect(dialog.getByRole('heading',{level:2})).toHaveText('РК2 / Итоги модуля 1');await expect(dialog.getByRole('heading',{name:'Рубежный контроль №2',exact:true})).toBeVisible();await expect(dialog.getByRole('heading',{name:'Итоги модуля 1',exact:true})).toBeVisible();
    assert.equal(await dialog.locator('.brs-module-breakdown tbody tr').count(),5);assert.equal(await dialog.getByRole('heading',{name:'Задолженности',exact:true}).count(),0);assert(!(await dialog.innerText()).includes('Александр Смирнов'));
    await dialog.locator('.brs-module-breakdown tfoot').getByText('50/50',{exact:true}).waitFor();await student.screenshot({path:resolve(root,'rk-and-module-details.png')});await student.keyboard.press('Escape');
    await student.getByRole('button',{name:'Список',exact:true}).click();await expect(student.getByRole('button',{name:'Список',exact:true})).toHaveAttribute('aria-pressed','true');await expect(student.locator('.brs-compact')).toContainText('РК2/М1');
    await hw().click();await assertOptional(teacher);
    const comment='Первая строка\nВторая строка\nhttps://example.test/'+ 'длинныйтекст'.repeat(45)+'\n<img src=x onerror="alert(1)">';
    await teacher.getByLabel('Состояние сдачи',{exact:true}).selectOption('ON_TIME');await teacher.getByLabel('Баллы БРС',{exact:true}).fill('0.01');await teacher.getByLabel('Комментарий',{exact:true}).fill(comment);await teacher.getByRole('checkbox',{name:'Показывать комментарий студенту и деканату'}).check();await confirm(teacher);await save(teacher);
    await student.locator('.desktop-sidebar').getByRole('link',{name:'Сессия',exact:true}).click();await expect(student.locator('main h1:visible')).toHaveText('Сессия');await expect(student).toHaveURL(new RegExp('planId='+fixture.id));
    await expect(student.locator('.brs-workspace:visible')).toContainText('Зачёт требует пересмотра');await expect(student.locator('.brs-workspace:visible').getByRole('heading',{name:'Задолженности',exact:true})).toBeVisible();
    const dto=await (await studentContext.request.get(base+'/api/brs?planId='+fixture.id)).json();assert(dto.selected.students[0].calculation.rating>=60);assert(!dto.selected.students[0].official.valid);assert.equal(dto.selected.students[0].official.grade,'Зачёт');
    await student.locator('.desktop-sidebar').getByRole('link',{name:'Успеваемость',exact:true}).click();await expect(student.locator('main h1:visible')).toHaveText('Успеваемость');await expect(student.locator('.brs-workspace:visible')).toContainText('Зачёт требует пересмотра');
    const phone=await browser.newContext({storageState:{...(await studentContext.storageState()),origins:[]},viewport:{width:360,height:800},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    try {
      const page=await pageFor(phone,'/dashboard/grades?planId='+fixture.id);await expect(page.getByRole('button',{name:'Список',exact:true})).toHaveAttribute('aria-pressed','true');
      await page.locator('tr[data-work="'+fixture.homeworkId+'"] td').last().tap();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('.brs-comment')).toContainText(comment);assert.equal(await page.getByRole('dialog').locator('img').count(),0);assert.equal(await page.locator('.brs-comment').evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'Long comment overflow');
      await page.screenshot({path:resolve(root,'long-comment-360.png')});await page.keyboard.press('Escape');await page.locator('.brs-compact .brs-module-summary').first().tap();await expect(page.getByRole('dialog').getByRole('heading',{name:'Задолженности',exact:true})).toBeVisible();await page.screenshot({path:resolve(root,'module-debt-360.png')});await page.keyboard.press('Escape');await page.close();
    }finally{await phone.close();}
    await hw().click();await assertOptional(teacher);await teacher.getByRole('button',{name:'Удалить результат',exact:true}).click();await assertOptional(teacher);await confirm(teacher);await teacher.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    await hw().click();await assertOptional(teacher);await teacher.getByLabel('Состояние сдачи',{exact:true}).selectOption('ON_TIME');await teacher.getByLabel('Баллы БРС',{exact:true}).fill('12');await teacher.getByLabel('Комментарий',{exact:true}).fill('');await confirm(teacher);await save(teacher);
    const lab=teacher.locator('.brs-teacher-labs tbody tr').first().getByRole('button').first();await lab.click();await assertOptional(teacher);await teacher.keyboard.press('Escape');
    await teacher.getByRole('button',{name:'Настроить работу: РК1',exact:true}).click();await assertOptional(teacher);await teacher.keyboard.press('Escape');
    await teacher.getByRole('button',{name:/^Посещаемость Александр/}).first().click();await assertOptional(teacher);await teacher.getByRole('checkbox',{name:'Подтверждаю исправление отметки',exact:true}).check();await teacher.getByRole('dialog').getByRole('button',{name:'✓ — присутствовал',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    await teacher.getByRole('button',{name:/^Посещаемость Александр/}).first().click();await assertOptional(teacher);await teacher.getByRole('checkbox',{name:'Подтверждаю исправление отметки',exact:true}).check();await teacher.getByRole('dialog').getByRole('button',{name:'✓✓ — присутствовал и работал',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    await teacher.locator('.brs-tabs').getByRole('link',{name:'Сессия',exact:true}).click();await expect(teacher.locator('main h1:visible')).toHaveText('Сессия');await teacher.locator('.brs-workspace:visible').getByRole('button',{name:'Зафиксировать итог',exact:true}).first().click();await assertOptional(teacher);await confirm(teacher);await save(teacher);
    const current=await (await studentContext.request.get(base+'/api/brs?planId='+fixture.id)).json();assert(current.selected.students[0].official.valid);assert.equal(current.selected.students[0].official.grade,'Зачёт');
    await teacher.goto(base+'/teacher/session?planId='+examPlanId);await expect(teacher.locator('main h1:visible')).toHaveText('Сессия');
    const examCard=teacher.locator('[data-student="'+current.selected.students[0].id+'"]');await examCard.getByRole('button',{name:'Добавить попытку',exact:true}).click();await assertOptional(teacher);await teacher.getByLabel('Баллы экзамена',{exact:true}).fill('21.5');await teacher.getByLabel('Фактическая дата экзамена',{exact:true}).fill('2027-04-26');await confirm(teacher);await save(teacher);
    await examCard.getByRole('button',{name:'Исправить',exact:true}).last().click();await assertOptional(teacher);await teacher.getByLabel('Баллы экзамена',{exact:true}).fill('22');await confirm(teacher);await save(teacher);
    await examCard.getByRole('button',{name:'Исправить',exact:true}).last().click();await assertOptional(teacher);await teacher.getByRole('button',{name:'Удалить попытку',exact:true}).click();await assertOptional(teacher);await confirm(teacher);await teacher.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    pass('Final forms: distinct RK/module sections, visible debt and invalid historical credit after a teacher edit without F5, sidebar context, active modes, multiline safe comments at 360px and optional teacher text with confirmations');
  }finally{await studentContext.close();await teacher.close();}
}
