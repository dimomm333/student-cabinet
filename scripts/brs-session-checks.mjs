import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { points } from '../src/lib/brs-rules.ts';

const sessionPath = '/dashboard/session';
const courseCard = (page, plan) => page.locator(`.brs-workspace:visible .brs-session-course[data-plan="${plan.id}"]`);

export async function verifyStudentSession({ browser, ac, mc, pageFor, base, exam, credit, rex, diff, negativePlan, emptyStudent, password, root, pass }) {
  const page = await pageFor(ac, sessionPath + '?planId=' + exam.id);
  const cards = page.locator('.brs-workspace:visible .brs-session-course');
  const openCards = page.locator('.brs-workspace:visible .brs-session-course[open]');
  const examCard = courseCard(page, exam), diffCard = courseCard(page, diff);
  await expect(page.locator('.brs-tabs')).toHaveCount(0);
  await expect(page.getByLabel('Дисциплина', { exact: true })).toHaveCount(0);
  await expect(cards.first()).toHaveAttribute('data-plan', rex.id);
  await expect(cards.nth(1)).toHaveAttribute('data-plan', exam.id);
  await expect(openCards).toHaveCount(0);
  for (const [plan, title] of [[exam, 'Экзамен'], [credit, 'Зачёт'], [rex, 'Сессионный экзамен'], [diff, 'Дифференцированный зачёт']]) {
    await expect(courseCard(page, plan).locator('summary .brs-badge')).toHaveText(title);
  }
  await expect(examCard.locator('summary time')).toHaveText('02.01.2099');
  await expect(diffCard.locator('summary')).toContainText('Итог: 5');
  await expect(diffCard.getByText('Дата не назначена')).toBeHidden();
  await diffCard.locator('summary').click();
  await expect(diffCard.getByText('Дата не назначена')).toBeVisible();
  await expect(diffCard.getByText('Экзаменационные баллы')).toHaveCount(0);
  await examCard.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(openCards).toHaveCount(2);
  await diffCard.locator('summary').click();
  await expect(examCard).toHaveAttribute('open', '');

  const dto = await (await ac.request.get(base + '/api/brs?planId=' + exam.id)).json();
  const { calculation, attempts, teachers } = dto.overview.find(course => course.id === exam.id);
  const facts = examCard.locator('dl');
  const fact = label => facts.locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
  await expect(fact('Баллы за семестр')).toHaveText(`${points(calculation.semesterScore)} / ${points(calculation.semesterMax)}`);
  await expect(fact('Экзаменационные баллы')).toHaveText(`${points(calculation.examScore)} / ${points(calculation.examMax)}`);
  assert(teachers.length > 0);
  await expect(fact(teachers.length === 1 ? 'Преподаватель дисциплины' : 'Преподаватели дисциплины')).toHaveText(teachers.join(', '));
  assert(attempts.length >= 3);
  await expect(examCard.locator('.brs-session-attempts li')).toHaveCount(attempts.length);
  await expect(examCard.locator('.brs-text-comment').filter({ hasText: /^Экзаменационная попытка$/ })).toBeVisible();
  await expect(examCard.getByText(/· Не сдан$/)).toBeVisible();
  assert(!JSON.stringify(dto).includes('Закрытый комментарий к попытке'));

  const other = await pageFor(mc, sessionPath + '?planId=' + exam.id);
  const otherExam = courseCard(other, exam);
  await otherExam.locator('summary').click();
  await expect(otherExam.locator('.brs-admission strong')).toHaveText(/Не допущен|Проверка не завершена|Ожидает подтверждения/);
  await expect(otherExam.getByText('Попыток пока нет.')).toBeVisible();

  await page.getByLabel('Учебный период').selectOption(negativePlan.termId);
  await expect(page).toHaveURL(new RegExp('planId=' + negativePlan.id));
  await expect(courseCard(page, negativePlan).locator('summary')).toContainText('Итог: Незачёт');
  await expect(openCards).toHaveCount(0);

  const phone = await browser.newContext({ storageState: await ac.storageState(), viewport: { width: 346, height: 800 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const empty = await browser.newContext();
  try {
    const mobile = await pageFor(phone, sessionPath + '?planId=' + exam.id);
    for (const theme of ['light', 'dark']) {
      await mobile.emulateMedia({ colorScheme: theme });
      await expect(mobile.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(courseCard(mobile, diff).locator('summary')).toBeVisible();
      const summary = courseCard(mobile, exam).locator('summary');
      await summary.tap();
      await expect(courseCard(mobile, exam).locator('.brs-session-attempts')).toBeVisible();
      assert(await mobile.evaluate(() => innerWidth === 346 && document.documentElement.scrollWidth <= innerWidth), `Session overflows at 346px in ${theme}`);
      await mobile.screenshot({ path: resolve(root, `student-session-346-${theme}.png`), fullPage: true });
      await summary.tap();
    }
    const signIn = await empty.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: emptyStudent.email, password } });
    assert.equal(signIn.status(), 200);
    const emptyPage = await pageFor(empty, sessionPath);
    await expect(emptyPage.getByText('Дисциплин для сессии пока нет.')).toBeVisible();
    await expect(emptyPage.locator('.brs-session-course, .brs-tabs')).toHaveCount(0);
    assert.equal((await empty.request.get(base + '/api/brs?planId=' + exam.id)).status(), 403);
  } finally {
    await phone.close();
    await empty.close();
    await other.close();
    await page.close();
  }
  pass('Student session: four controls, dates and ordering, independent disclosures, admission and attempt privacy, official grades, empty session and both themes at 346px');
}
