import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {expect} from '@playwright/test';

export async function verifyFinalForms({browser,tc,ac,pageFor,base,fixture,examPlanId,root,pass}) {
  const teacher=await pageFor(tc,'/teacher/grades?planId='+fixture.id);
  const studentContext=await browser.newContext({storageState:{...(await ac.storageState()),origins:[]},viewport:{width:1366,height:900},reducedMotion:'reduce'});
  const student=await pageFor(studentContext,'/dashboard/grades?planId='+fixture.id);
  const assertOptional=async page=>{assert.equal(await page.getByRole('dialog').locator('textarea[required]').count(),0,'Teacher form requires free text');};
  const confirm=async page=>{const check=page.getByRole('dialog').getByRole('checkbox',{name:/Подтверждаю/});assert.equal(await check.count(),0);};
  const save=async page=>{await page.getByRole('dialog').getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();};
  const hw=()=>teacher.locator('.brs-journal tbody tr').first().getByRole('button',{name:/ДЗ1,/});
  try {
    const contrast=await teacher.locator('.brs-journal').evaluate(table=>{
      const ratio=(a,b)=>{const luminance=color=>{const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return .2126*values[0]+.7152*values[1]+.0722*values[2];};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const heading=getComputedStyle(table.querySelector('thead tr:last-child th:nth-child(2)')),button=getComputedStyle(table.querySelector('tbody tr:first-child td button'));
      return {text:ratio(heading.color,heading.backgroundColor),boundary:ratio(button.borderTopColor,button.backgroundColor)};
    });
    assert(contrast.text>=4.5&&contrast.boundary>=3,'Insufficient text or interactive boundary contrast: '+JSON.stringify(contrast));

    for(const [name,selector] of [['journal','.brs-journal'],['labs','.brs-teacher-labs'],['attendance','.brs-cross-table']]) {
      const table=name==='attendance'?teacher.locator(selector).last():teacher.locator(selector),cell=table.locator('tbody tr').first().locator('td').first(),button=cell.getByRole('button').first();
      await button.scrollIntoViewIfNeeded();await teacher.waitForTimeout(120);const before=await cell.boundingBox(), rowPeer=table.locator('tbody tr').first().locator('th.brs-sticky'), colPeer=table.locator('tbody tr').nth(1).locator('td').first();const rowColor=await rowPeer.evaluate(el=>getComputedStyle(el).backgroundColor), colColor=await colPeer.evaluate(el=>getComputedStyle(el).backgroundColor);await button.hover();await expect(cell).toHaveClass(/brs-cross-cell/);assert.notEqual(await rowPeer.evaluate(el=>getComputedStyle(el).backgroundColor),rowColor,'Row not visibly highlighted');assert.notEqual(await colPeer.evaluate(el=>getComputedStyle(el).backgroundColor),colColor,'Column not visibly highlighted');
      await expect(table.locator('tbody tr.brs-cross-row')).toHaveCount(1);assert(await table.locator('.brs-cross-col').count()>=2);
      const after=await cell.boundingBox();assert(Math.abs(after.width-before.width)<1&&Math.abs(after.height-before.height)<1,'Hover changed cell geometry');
      await teacher.screenshot({path:resolve(root,'teacher-cross-'+name+'.png')});
      await button.click();await expect(teacher.getByRole('dialog')).toBeVisible();await teacher.keyboard.press('Escape');await expect(table.locator('.brs-cross-cell, .brs-cross-row, .brs-cross-col')).toHaveCount(0);await teacher.mouse.move(1,1);
      await expect(table.locator('.brs-cross-cell, .brs-cross-row, .brs-cross-col')).toHaveCount(0);
    }
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
    await teacher.getByLabel('Состояние сдачи',{exact:true}).selectOption('ON_TIME');await teacher.getByLabel('Баллы БРС',{exact:true}).fill('0.01');await teacher.getByRole('dialog').getByLabel('Комментарий (необязательно)',{exact:true}).fill(comment);await teacher.getByRole('checkbox',{name:'Показывать комментарий студенту и деканату'}).check();await confirm(teacher);await save(teacher);
    await student.locator('.desktop-sidebar').getByRole('link',{name:'Сессия',exact:true}).click();await expect(student.locator('main h1:visible')).toHaveText('Сессия');await expect(student).toHaveURL(new RegExp('planId='+fixture.id));
    await expect(student.locator('.brs-workspace:visible')).toContainText('Действительный итог отсутствует');await expect(student.locator('.brs-workspace:visible')).not.toContainText('Исторический снимок');await expect(student.locator('.brs-workspace:visible')).not.toContainText('Зачёт');await expect(student.locator('.brs-workspace:visible').getByRole('heading',{name:'Задолженности',exact:true})).toBeVisible();
    const dto=await (await studentContext.request.get(base+'/api/brs?planId='+fixture.id)).json();assert(dto.selected.students[0].calculation.rating>=60);assert(!dto.selected.students[0].official.valid);assert.equal(dto.selected.students[0].official.grade,'Зачёт');
    await student.locator('.desktop-sidebar').getByRole('link',{name:'Успеваемость',exact:true}).click();await expect(student.locator('main h1:visible')).toHaveText('Успеваемость');await expect(student.locator('.brs-workspace:visible')).toContainText('Действительный итог отсутствует');
    const workRow=student.locator('.brs-compact tr[data-work="'+fixture.homeworkId+'"]');await expect(workRow).not.toContainText('Есть задолженность');await expect(student.locator('.brs-compact .brs-module-summary[data-academic="failed"]').first()).toContainText('Есть задолженность');
    const phone=await browser.newContext({storageState:{...(await studentContext.storageState()),origins:[]},viewport:{width:360,height:800},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    try {
      const page=await pageFor(phone,'/dashboard/grades?planId='+fixture.id);await expect(page.getByRole('button',{name:'Список',exact:true})).toHaveAttribute('aria-pressed','true');
      await page.locator('tr[data-work="'+fixture.homeworkId+'"] td').last().tap();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('.brs-comment')).toContainText(comment);assert.equal(await page.getByRole('dialog').locator('img').count(),0);assert.equal(await page.locator('.brs-comment').evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'Long comment overflow');
      await page.screenshot({path:resolve(root,'long-comment-360.png')});await page.keyboard.press('Escape');await page.locator('.brs-compact .brs-module-summary').first().tap();await expect(page.getByRole('dialog').getByRole('heading',{name:'Задолженности',exact:true})).toBeVisible();await page.screenshot({path:resolve(root,'module-debt-360.png')});await page.keyboard.press('Escape');await page.close();
    }finally{await phone.close();}
    await hw().click();await assertOptional(teacher);await teacher.getByRole('button',{name:'Удалить результат',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    await hw().click();await assertOptional(teacher);await teacher.getByRole('button',{name:'Восстановить результат',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    await hw().click();await teacher.getByLabel('Состояние сдачи',{exact:true}).selectOption('ON_TIME');await teacher.getByLabel('Баллы БРС',{exact:true}).fill('12');await teacher.getByRole('dialog').getByLabel('Комментарий (необязательно)',{exact:true}).fill('');await save(teacher);
    const lab=teacher.locator('.brs-teacher-labs tbody tr').first().getByRole('button').first();await lab.click();await assertOptional(teacher);await teacher.keyboard.press('Escape');
    await teacher.getByRole('button',{name:'Настроить работу: РК1',exact:true}).click();await assertOptional(teacher);await teacher.keyboard.press('Escape');
    await teacher.getByRole('button',{name:/^Посещаемость Александр/}).first().click();await assertOptional(teacher);await teacher.getByRole('dialog').getByRole('button',{name:'✓ — присутствовал',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    await teacher.getByRole('button',{name:/^Посещаемость Александр/}).first().click();await assertOptional(teacher);await teacher.getByRole('dialog').getByRole('button',{name:'✓✓ — присутствовал и работал',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    await teacher.locator('.brs-tabs').getByRole('link',{name:'Сессия',exact:true}).click();await expect(teacher.locator('main h1:visible')).toHaveText('Сессия');await teacher.locator('.brs-workspace:visible').getByRole('button',{name:'Зафиксировать итог',exact:true}).first().click();await expect(teacher.locator('.brs-workspace:visible')).toContainText('Изменения сохранены.');
    const current=await (await studentContext.request.get(base+'/api/brs?planId='+fixture.id)).json();assert(current.selected.students[0].official.valid);assert.equal(current.selected.students[0].official.grade,'Зачёт');
    await teacher.goto(base+'/teacher/session?planId='+examPlanId);await expect(teacher.locator('main h1:visible')).toHaveText('Сессия');
    const examCard=teacher.locator('[data-student="'+current.selected.students[0].id+'"]');await examCard.getByRole('button',{name:'Добавить попытку',exact:true}).click();await assertOptional(teacher);await teacher.getByLabel('Баллы экзамена',{exact:true}).fill('21.5');await teacher.getByLabel('Фактическая дата экзамена',{exact:true}).fill('2027-04-26');await confirm(teacher);await save(teacher);
    await examCard.getByRole('button',{name:'Исправить',exact:true}).last().click();await assertOptional(teacher);await teacher.getByLabel('Баллы экзамена',{exact:true}).fill('22');await confirm(teacher);await save(teacher);
    await examCard.getByRole('button',{name:'Исправить',exact:true}).last().click();await assertOptional(teacher);await teacher.getByRole('button',{name:'Удалить попытку',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();await examCard.getByRole('button',{name:'Исправить',exact:true}).last().click();await teacher.getByRole('button',{name:'Восстановить попытку',exact:true}).click();await expect(teacher.getByRole('dialog')).not.toBeVisible();
    pass('Final forms: distinct RK/module sections, visible debt and invalid historical credit after a teacher edit without F5, sidebar context, active modes, multiline safe comments at 360px and optional teacher text without confirmations');
  }finally{await studentContext.close();await teacher.close();}
}
