import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {expect} from '@playwright/test';
import {points} from '../src/lib/brs-rules.ts';

export async function prepareStudentUIFixture(db,planId) {
  // A real isolated fixture with two works in one week; no mocked production DTO.
  const events=await db.brsEvent.findMany({where:{module:{planId}},include:{module:true}});
  const interim=events.find(e=>e.kind==='INTERIM'&&e.module.number===1),homework=events.find(e=>e.kind==='HOMEWORK'&&e.module.number===1);
  await db.brsEvent.update({where:{id:homework.id},data:{week:interim.week,plannedOn:interim.plannedOn,issuedOn:interim.plannedOn,deadline:interim.plannedOn}});
}

export async function verifyStudentUI({browser,context,otherContext,pageFor,base,planId,root,pass}) {
  const dto=await (await context.request.get(base+'/api/brs?planId='+planId)).json();
  const course=dto.overview.find(c=>c.id===planId),results=[];
  assert(course.calculation.modules.every(m=>m.complete));
  for(const width of [356,360,1366,1440]) {
    const ctx=await browser.newContext({storageState:{...(await context.storageState()),origins:[]},viewport:{width,height:900},reducedMotion:'reduce',...(width<700?{isMobile:true,hasTouch:true}:{})});
    try {
      const page=await pageFor(ctx,'/dashboard/grades?planId='+planId),mobile=width<700;
      const full=page.locator('.brs-student-full'),list=page.locator('.brs-course-list');
      await expect(page.locator(mobile?'.brs-compact':'.brs-full')).toBeVisible();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflow at '+width);
      const period=await page.getByRole('combobox',{name:'Учебный период',exact:true}).inputValue();
      const moduleBadge=page.locator((mobile?'.brs-compact':'.brs-full')+' .brs-module-summary').first();
      await expect(moduleBadge).toHaveAttribute('data-academic','complete');await expect(moduleBadge).toHaveAccessibleName(/Обязательные работы выполнены/);
      let maxHeight;
      if(mobile) {
        assert.equal(await list.count(),dto.overview.length);
        await expect(list.locator('thead th')).toHaveText(['Неделя','Работа','Результат']);
        assert.equal(await page.locator('.brs-list-event').count(),0);
        const weeks=await list.locator('tbody tr[data-work] td:first-child').allTextContents();assert.deepEqual(weeks.map(Number),[...weeks.map(Number)].sort((a,b)=>a-b));assert(weeks.some((week,index)=>index>0&&week===weeks[index-1]),'Same-week fixture works are missing');
        const rowHeights=await list.locator('tbody tr[data-work]').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));maxHeight=Math.max(...rowHeights);assert(maxHeight<=82,'Tall compact row '+maxHeight);
        const seminar=list.locator('tbody tr').last();await expect(seminar.locator('td').first()).toHaveText('');await expect(seminar).toContainText('Работа на семинарах');
        const seminarScore=course.calculation.modules.reduce((sum,m)=>sum+m.seminarScore,0),seminarMax=course.modules.flatMap(m=>m.events).filter(e=>e.kind==='SEMINAR').reduce((sum,e)=>sum+e.maxScore,0);
        await expect(seminar.locator('td').last()).toContainText(points(seminarScore)+'/'+points(seminarMax));
        assert.equal(await list.getByText(/Срок сдачи не указан|Состояние сдачи не указано/).count(),0);
        await list.locator('tbody tr[data-work] td').last().tap();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
        await page.screenshot({path:resolve(root,'student-list-'+width+'.png'),fullPage:true});
        await page.getByRole('button',{name:'Режим таблицы',exact:true}).click();await expect(page.locator('.brs-full')).toBeVisible();
      } else {
        const heights=await full.locator('tbody > tr').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));maxHeight=Math.max(...heights);assert(maxHeight<=150,'Tall desktop course row '+maxHeight);
        const scroller=page.locator('.brs-full'),sticky=full.locator('tbody .brs-sticky').first();const initial=await sticky.boundingBox();assert(initial.width<=175);
        await scroller.evaluate(el=>el.scrollLeft=160);assert.equal(await scroller.evaluate(el=>el.scrollLeft),160);const moved=await sticky.boundingBox();assert(Math.abs(initial.x-moved.x)<1,'Discipline column moved');await scroller.evaluate(el=>el.scrollLeft=0);
        const card=full.locator('.brs-progress-cell').first(),before=await card.boundingBox();await card.hover();
        await expect(page.locator('.brs-student-full .brs-column-active')).not.toHaveCount(0);
        assert.notEqual(await card.evaluate(el=>getComputedStyle(el).boxShadow),'none','Work has no hover accent');const after=await card.boundingBox();assert(Math.abs(after.width-before.width)<1&&Math.abs(after.height-before.height)<1,'Hover changed geometry');
        await page.screenshot({path:resolve(root,'student-table-hover-'+width+'.png'),fullPage:true});
        await card.click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();await page.mouse.move(1,1);
        await expect(page.locator('.brs-student-full .brs-column-active')).toHaveCount(0);
        assert.equal(await page.locator('.brs-student-progress .brs-selected').count(),0);
        assert.notEqual(await card.locator('xpath=ancestor::td').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 241, 210)','Clicked cell kept yellow');
        await card.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(card).toBeFocused();assert.equal(await card.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
        await page.screenshot({path:resolve(root,'student-table-focus-'+width+'.png')});
        await page.getByRole('button',{name:'Список',exact:true}).click();await expect(page.locator('.brs-compact')).toBeVisible();
      }
      await expect(page.getByRole('combobox',{name:'Учебный период',exact:true})).toHaveValue(period);
      await page.reload();await expect(page.locator(mobile?'.brs-full':'.brs-compact')).toBeVisible();
      const attendance=page.getByRole('region',{name:'Посещаемость',exact:true});assert.equal(await attendance.getByRole('heading',{name:'Посещаемость',exact:true}).count(),1);
      await attendance.locator('summary').first().click();const own=attendance.locator('.brs-own-attendance');await expect(own).toBeVisible();assert.equal(await own.locator('thead th').filter({hasText:dto.selected.students[0].name}).count(),0);
      await own.getByRole('button').first().click();const hint=page.getByRole('dialog',{name:'Отметка занятия',exact:true});await expect(hint).toBeVisible();await expect(hint).toContainText('Присутствовал и работал');assert.equal(await hint.getByText('Посещаемость',{exact:true}).count(),0);assert(!(await hint.innerText()).includes('Остальные отметки'));
      const hintBounds=await hint.boundingBox();assert(hintBounds.width<=280&&hintBounds.height<=180&&hintBounds.x>=0&&hintBounds.x+hintBounds.width<=width);
      await page.screenshot({path:resolve(root,'student-attendance-hint-'+width+'.png')});await page.keyboard.press('Escape');await expect(hint).not.toBeVisible();
      const labs=page.getByRole('region',{name:'Лабораторные работы',exact:true});assert.equal(await labs.locator('details').count(),dto.overview.filter(c=>c.modules.some(m=>m.events.some(e=>e.kind==='LAB'))).length);await labs.locator('summary').first().click();await expect(labs.locator('.brs-student-labs')).toBeVisible();
      assert(!(await page.locator('main').innerText()).includes('Приватный исторический комментарий'));
      results.push({width,defaultView:mobile?'list':'table',maxRowHeight:maxHeight,noOverflow:true});
    } finally {await ctx.close();}
  }
  const other=await pageFor(otherContext,'/dashboard/grades?planId='+planId);await other.getByRole('button',{name:'Список',exact:true}).click();
  assert(await other.locator('.brs-compact .brs-module-summary[data-academic="failed"]').count()>0,'Known failed work did not produce a red module');
  assert(await other.locator('.brs-compact .brs-module-summary[data-academic="pending"]').count()>0,'Unassessed module did not stay neutral');
  await other.screenshot({path:resolve(root,'student-failed-and-pending.png'),fullPage:true});await other.close();
  pass('Student UI: compact three-column course tables, actual same-week works, seminar summary, semantic groups, academic colors, transient hover/focus and private attendance hints', {viewports:results});
}
