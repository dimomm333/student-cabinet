import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

async function withinViewport(page) {
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow: '+page.url());
  const escaped=await page.locator('.materials-tree, .material-card, .materials-composer, .materials-tabs, .materials-search').evaluateAll(elements=>elements.filter(el=>{const r=el.getBoundingClientRect();return r.width && (r.left < -1 || r.right > innerWidth+1);}).map(el=>el.className));
  assert.deepEqual(escaped,[],'A materials panel escaped the viewport');
}
export async function verifyResponsiveMaterials({studentPage,teacherPage,base,courseUrl,termId,browserTitle,root,pass}) {
  await teacherPage.goto(base+'/teacher/materials'+courseUrl);await expect(teacherPage.locator('.materials-heading h2')).toBeVisible();
  const courseTitle=await teacherPage.locator('.materials-heading h2').innerText();
  for(const width of [346,360,768,1366]) {
    for(const [role,page,home] of [['student',studentPage,'/dashboard'],['teacher',teacherPage,'/teacher']]) {
      await page.setViewportSize({width,height:900});
      await page.goto(base+home+'/materials');await page.getByLabel('Учебный год и семестр').selectOption(termId);
      await page.locator('.materials-course').filter({has:page.getByRole('heading',{name:courseTitle,exact:true})}).click();
      await expect(page.getByRole('heading',{name:browserTitle,exact:true})).toBeVisible();await withinViewport(page);
      // The last category must be reachable by keyboard in the horizontal strip.
      const other=page.getByRole('button',{name:'Прочее',exact:true});await other.focus();await other.press('Enter');await expect(other).toHaveAttribute('aria-pressed','true');
      await expect(page.getByRole('heading',{name:'Материалы не найдены',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Лабораторные',exact:true}).click();await expect(page.getByRole('heading',{name:'Только своей подгруппе',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Лекции',exact:true}).click();await expect(page.getByRole('heading',{name:browserTitle,exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Переименованная подпапка',exact:true}).click();await expect(page.getByRole('heading',{name:browserTitle,exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Лекция 1.pdf',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Все материалы',exact:true}).click();await expect(page.getByRole('heading',{name:browserTitle,exact:true})).toBeVisible();
      await page.getByRole('searchbox').fill('Браузерная практика');await expect(page.locator('.material-card')).toHaveCount(1);
      const card=page.locator('.material-card');await card.locator('summary').focus();await card.locator('summary').press('Enter');await expect(card.locator('details')).toHaveAttribute('open','');await expect(card.locator('.material-filename')).toHaveText('Браузерная практика.txt');await withinViewport(page);
      await page.screenshot({path:resolve(root,`${role}-details-${width}.png`),fullPage:true});
      await card.locator('summary').press('Enter');await expect(card.locator('details')).not.toHaveAttribute('open','');
      const targets=await card.locator('.materials-actions > a, .materials-actions > button, summary, .material-select').evaluateAll(elements=>elements.map(el=>({text:el.textContent.trim(),height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width})));
      assert(targets.every(t=>t.height>=43.5 && t.width>=43.5),'Touch targets are too small: '+JSON.stringify(targets));
      await page.getByRole('searchbox').fill('');await expect(page.getByRole('heading',{name:browserTitle,exact:true})).toBeVisible();
      await page.screenshot({path:resolve(root,`${role}-list-${width}.png`),fullPage:true});await withinViewport(page);
    }
    const p=teacherPage,s=studentPage,title=`Материал экрана ${width}`;
    await p.getByRole('button',{name:'Все категории',exact:true}).click();await expect(p.getByRole('heading',{name:browserTitle,exact:true})).toBeVisible();
    await p.getByRole('button',{name:'+ Создать',exact:true}).click();await p.getByLabel('Название папки',{exact:true}).fill(`Папка ${width}`);await p.getByRole('button',{name:'Сохранить папку',exact:true}).click();
    await p.getByRole('button',{name:`Изменить папку Папка ${width}`,exact:true}).click();await p.getByLabel('Название папки',{exact:true}).fill(`Папка ${width} — архив`);await withinViewport(p);await p.getByRole('button',{name:'Сохранить папку',exact:true}).click();
    await expect(p.getByRole('button',{name:`Изменить папку Папка ${width} — архив`,exact:true})).toBeVisible();
    await p.getByRole('button',{name:'Добавить материалы',exact:true}).click();await p.getByLabel('Название материала',{exact:true}).fill(title);await p.getByLabel('Описание',{exact:true}).fill('Проверка компактного редактора, групп и настоящей загрузки.');
    const groupChoice=p.locator('.materials-groups input[type=checkbox]').first();await groupChoice.uncheck();await groupChoice.check();
    await p.getByLabel('Категория материала',{exact:true}).selectOption('PRACTICE');
    await p.locator('input[type=file]').setInputFiles({name:`Практика ${width} с длинным именем документа для проверки мобильного списка.txt`,mimeType:'text/plain',buffer:Buffer.from('Проверка '+width)});
    await withinViewport(p);await p.screenshot({path:resolve(root,`teacher-editor-${width}.png`),fullPage:true});
    await p.getByRole('button',{name:'Сохранить черновики',exact:true}).click();await expect(p.getByRole('button',{name:'Опубликовать пакет (1)',exact:true})).toBeVisible({timeout:30000});await p.getByRole('button',{name:'Опубликовать пакет (1)',exact:true}).click();
    const row=()=>p.locator('.material-card').filter({has:p.getByRole('heading',{name:title,exact:true})});await expect(row()).toContainText('Опубликован');
    await row().getByRole('checkbox').check();await expect(p.getByText('Выбрано: 1',{exact:true})).toBeVisible();await row().getByRole('checkbox').uncheck();
    await s.getByRole('button',{name:'Практики',exact:true}).click();await expect(s.getByRole('heading',{name:title,exact:true})).toBeVisible();
    const download=await Promise.all([s.waitForEvent('download'),s.locator('.material-card').filter({has:s.getByRole('heading',{name:title,exact:true})}).getByRole('link',{name:'Скачать',exact:true}).click()]);
    assert(download[0].suggestedFilename().startsWith(`Практика ${width}`));assert.equal(await download[0].failure(),null);
    await row().getByRole('button',{name:'Изменить / переместить',exact:true}).click();await p.getByLabel('Описание',{exact:true}).fill('Изменено на ширине '+width);await p.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await expect(row()).toContainText('Изменено на ширине '+width);
    await row().getByRole('button',{name:'Снять публикацию',exact:true}).click();await expect(row()).toContainText('Черновик');await row().getByRole('button',{name:'Удалить',exact:true}).click();await expect(row()).toHaveCount(0);
    await p.getByRole('button',{name:`Изменить папку Папка ${width} — архив`,exact:true}).click();await p.getByRole('button',{name:'Удалить папку',exact:true}).click();await expect(p.getByRole('button',{name:`Изменить папку Папка ${width} — архив`,exact:true})).toHaveCount(0);
    await s.getByRole('button',{name:'Обновить',exact:true}).click();await expect(s.getByRole('heading',{name:title,exact:true})).toHaveCount(0);
    // Real menu/home return, not just a direct URL render.
    for(const [page,home] of [[p,'/teacher'],[s,'/dashboard']]) {await page.getByRole('link',{name:'← На главную кабинета',exact:true}).click();await expect(page).toHaveURL(base+home);}
    pass(`Responsive materials ${width}px: catalogue, tabs, folders, search, details/keyboard, 44px targets, editor, upload, publish, download, edit, unpublish, delete and home navigation`);
  }
}
