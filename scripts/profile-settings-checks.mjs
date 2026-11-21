import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { newPasswordError } from '../src/lib/password-strength.ts';

// Called only by the navigation harness against its newly migrated test DB.
export async function verifyProfileSettings({ page, context, db, actor, home, base, password, root, settle }) {
  const user = await db.user.findUniqueOrThrow({ where: { email: actor.email } });
  const foreign = await db.user.findUniqueOrThrow({ where: { email: 'maria.volkova@example.test' } });
  const foreignAccount = await db.account.findFirstOrThrow({ where: { userId: foreign.id, providerId: 'credential' } });
  const resetLimits = () => db.rateLimit.deleteMany();
  await page.goto(base + home + '/profile'); await settle(page);
  const triggers = page.locator('.profile-settings-trigger');
  await expect(triggers).toHaveCount(2);
  await expect(triggers.nth(0)).toHaveText('Настройки уведомлений');
  await expect(triggers.nth(1)).toHaveText('Безопасность');
  for (const trigger of await triggers.all()) {
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.focus(); await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space'); await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
  const notifications = page.locator('.notification-settings');
  await triggers.nth(0).click();
  await expect(notifications.locator('input')).not.toHaveCount(0);
  const saved = await (await context.request.get(base + '/api/notifications?view=settings')).json();
  for (const box of await notifications.getByRole('checkbox').all()) await box.setChecked(!(await box.isChecked()));
  await notifications.getByRole('button').click();
  await expect(notifications.getByRole('status')).toHaveText('Настройки сохранены.');
  await page.reload(); await settle(page); await triggers.nth(0).click();
  const changed = await (await context.request.get(base + '/api/notifications?view=settings')).json();
  assert.notDeepEqual(changed.optionalCategories, saved.optionalCategories);
  assert.notDeepEqual(changed.emailCategories, saved.emailCategories);
  assert.equal(changed.personalEmail, !saved.personalEmail);
  await context.request.post(base + '/api/notifications', { headers: { Origin: base }, data: { operation: 'SETTINGS', optionalCategories: saved.optionalCategories, emailCategories: saved.emailCategories, personalEmail: saved.personalEmail } });
  await triggers.nth(1).click();
  const form = page.locator('.password-settings'), inputs = form.locator('input');
  await expect(form).toContainText('От 8 до 128 символов.');
  await expect(inputs.nth(0)).toHaveAttribute('autocomplete', 'current-password');
  for (const i of [1, 2]) await expect(inputs.nth(i)).toHaveAttribute('autocomplete', 'new-password');
  for (const theme of ['light', 'dark']) for (const width of [346, 360, 390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.theme-toggle').click();
    await page.getByRole('menuitemradio', { name: theme === 'light' ? 'Светлая' : 'Тёмная', exact: true }).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${actor.role} ${theme} ${width} overflow`);
    await expect(form.getByRole('button', { name: 'Изменить пароль', exact: true })).toBeVisible();
    if (actor.role === 'STUDENT') await page.screenshot({ path: resolve(root, `profile-settings-${theme}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  let newPassword;
  do { newPassword = randomBytes(6).toString('base64url'); } while (newPasswordError(newPassword));
  assert.equal(newPassword.length, 8);
  const tooShortPassword = newPassword.slice(0, 7);
  const fill = async (current, next, confirmation = next) => { for (const [i, value] of [current, next, confirmation].entries()) await inputs.nth(i).fill(value); };
  const submit = () => form.getByRole('button', { name: 'Изменить пароль', exact: true }).click();
  async function fieldError(name, text) {
    const field = form.locator(`input[name="${name}"]`);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const error = field.locator('xpath=ancestor::div[contains(@class,"password-settings-field")]').getByRole('alert');
    await expect(error).toHaveText(text);
    assert((await field.getAttribute('aria-describedby')).split(' ').includes(await error.getAttribute('id')));
  }
  await fill(password, newPassword, newPassword + 'x'); await submit(); await fieldError('confirmation', 'Пароли не совпадают');
  await fill(password, tooShortPassword); await submit(); await fieldError('newPassword', 'Пароль должен содержать не менее 8 символов');
  if (actor.role === 'STUDENT') {
    await page.setViewportSize({ width: 346, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await form.screenshot({ path: resolve(root, 'password-field-error-346.png') });
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  await fill(password, 'x'.repeat(129)); await submit(); await fieldError('newPassword', 'Пароль должен содержать не более 128 символов');
  await fill('x'.repeat(129), newPassword); await submit(); await fieldError('currentPassword', 'Пароль должен содержать не более 128 символов');
  await fill(password, 'password123'); await submit(); await fieldError('newPassword', 'Этот пароль слишком простой. Придумайте другой');
  await expect(inputs.nth(1)).toHaveValue('password123');
  await fill(password, password); await submit(); await fieldError('newPassword', 'Новый пароль должен отличаться от текущего');
  // A server response is translated by code only; its internal message is never rendered.
  for (const [code, text] of [
    ['PASSWORD_TOO_SHORT', 'Пароль должен содержать не менее 8 символов'],
    ['PASSWORD_TOO_LONG', 'Пароль должен содержать не более 128 символов'],
    ['PASSWORD_TOO_WEAK', 'Этот пароль слишком простой. Придумайте другой'],
    ['PASSWORD_UNCHANGED', 'Новый пароль должен отличаться от текущего'],
  ]) {
    await page.route('**/api/auth/change-password', route => route.fulfill({ status: 400, json: { code, message: 'INTERNAL_TRACE_DO_NOT_DISPLAY' } }));
    await fill(password, newPassword); await submit(); await fieldError('newPassword', text);
    await expect(inputs.nth(0)).toHaveValue(password); await expect(inputs.nth(1)).toHaveValue(newPassword);
    await expect(form).not.toContainText('INTERNAL_TRACE_DO_NOT_DISPLAY');
    await page.unroute('**/api/auth/change-password');
  }
  await resetLimits();
  await fill('wrong-current-password', newPassword); await submit(); await fieldError('currentPassword', 'Неверный текущий пароль');
  const change = (c, data, origin = base) => c.request.post(base + '/api/auth/change-password', { headers: { Origin: origin }, data });
  const body = { currentPassword: password, newPassword, revokeOtherSessions: true };
  const anonymous = await context.browser().newContext(), other = await context.browser().newContext();
  try {
    assert.equal((await change(anonymous, body)).status(), 401);
    assert.equal((await change(context, body, 'https://evil.test')).status(), 403);
    const tooShort = await change(context, { ...body, newPassword: tooShortPassword });
    assert.equal(tooShort.status(), 400);
    assert.equal((await tooShort.json()).code, 'PASSWORD_TOO_SHORT');
    assert.equal((await change(context, { ...body, newPassword: 'x'.repeat(129) })).status(), 400);
    for (const weak of ['12345678', '123456789', 'qwerty123', 'password123', '11111111', 'aaaaaaaa', 'p@ssw0rd123', 'abcabcabc']) {
      await resetLimits();
      const denied = await change(context, { ...body, newPassword: weak });
      assert.equal(denied.status(), 400);
      assert.equal((await denied.json()).code, 'PASSWORD_TOO_WEAK');
    }
    await resetLimits();
    for (let n = 0; n < 5; n++) assert.equal((await change(context, { ...body, currentPassword: 'wrong-current-password' })).status(), 400);
    assert.equal((await change(context, body)).status(), 429);
    await resetLimits();
    assert.equal((await other.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: actor.email, password } })).status(), 200);
    const session = (await (await context.request.get(base + '/api/auth/get-session')).json()).session;
    const createdAt = new Date(Date.now() - 2 * 3600000), expiresAt = new Date(createdAt.getTime() + 8 * 3600000);
    await db.session.update({ where: { id: session.id }, data: { createdAt, expiresAt } });
    let requests = 0;
    await page.route('**/api/auth/change-password', async route => { requests++; await new Promise(r => setTimeout(r, 400)); await route.continue(); });
    await fill(password, newPassword);
    await submit();
    await expect(form.getByRole('button', { name: 'Изменяем пароль…' })).toBeDisabled();
    await form.evaluate(el => { el.requestSubmit(); el.requestSubmit(); });
    await expect(form.getByRole('status')).toHaveText('Пароль успешно изменён');
    assert.equal(requests, 1); await page.unroute('**/api/auth/change-password');
    for (const input of await inputs.all()) await expect(input).toHaveValue('');
    const active = await (await context.request.get(base + '/api/auth/get-session')).json();
    assert(active && active.user.id === user.id);
    assert.equal(new Date(active.session.createdAt).getTime(), createdAt.getTime());
    assert.equal(new Date(active.session.expiresAt).getTime(), expiresAt.getTime());
    assert.equal(await (await other.request.get(base + '/api/auth/get-session')).json(), null);
    assert.equal(await db.session.count({ where: { userId: user.id } }), 1);
    await resetLimits();
    assert.equal((await anonymous.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: actor.email, password } })).status(), 401);
    assert.equal((await anonymous.request.post(base + '/api/auth/sign-in/email', { headers: { Origin: base }, data: { email: actor.email, password: newPassword } })).status(), 200);
    // Extra owner parameters cannot select a different account; only the session owner changes.
    assert.equal((await change(context, { currentPassword: newPassword, newPassword: password, revokeOtherSessions: false, userId: foreign.id, email: foreign.email })).status(), 200);
    assert.equal((await db.account.findUniqueOrThrow({ where: { id: foreignAccount.id } })).password, foreignAccount.password);
    assert.equal(await (await anonymous.request.get(base + '/api/auth/get-session')).json(), null);
    const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: 'credential' } });
    await db.account.update({ where: { id: account.id }, data: { password: null } });
    try {
      await page.reload(); await settle(page); await triggers.nth(1).click();
      await expect(page.locator('.profile-settings')).toContainText('локальный пароль не задан');
      await expect(page.locator('.password-settings')).toHaveCount(0);
    } finally { await db.account.update({ where: { id: account.id }, data: { password: account.password } }); }
    // An expired absolute lifetime cannot be bypassed via password rotation.
    const current = (await (await context.request.get(base + '/api/auth/get-session')).json()).session;
    await db.session.update({ where: { id: current.id }, data: { createdAt: new Date(Date.now() - 9 * 3600000), expiresAt: new Date(Date.now() + 3600000) } });
    assert.equal((await change(context, body)).status(), 401);
    await db.session.update({ where: { id: current.id }, data: { createdAt, expiresAt } });
  } finally { await anonymous.close(); await other.close(); await resetLimits(); }
}
