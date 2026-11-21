import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { betterAuth } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { newPasswordError } from '../src/lib/password-strength.ts';
import { provisionTestDatabase } from './test-fixtures.mjs';

// The application's extensionless TS imports normally resolve via Next.
// Restrict this test-only Node resolver to relative imports inside src/.
const sourceRoot = new URL('../src/', import.meta.url).href;
const resolver = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
} });
mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/password-policy-'));
const source = createClient({ url: getDatabaseUrl() });
async function fingerprint() {
  const rows = [];
  for (const { name } of (await source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows) {
    rows.push([name, (await source.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows]);
  }
  return createHash('sha256').update(JSON.stringify(rows, (_, v) => typeof v === 'bigint' ? String(v) : v)).digest('hex');
}
const before = await fingerprint();
process.env.DATABASE_URL = provisionTestDatabase(resolve(root, 'test.db')).DATABASE_URL;
assert(process.env.DATABASE_URL.includes('/.local/password-policy-'));
Object.assign(process.env, { BETTER_AUTH_URL: 'http://localhost:3000', BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_TRUST_PROXY: 'false', AUTH_PROXY_SECRET: '' });
const { auth } = await import('../src/lib/auth.ts');
const { prisma: db } = await import('../src/lib/prisma.ts');
const results = [];
function pass(name) { results.push(name); console.info('PASS: ' + name); }
const weakPasswords = ['12345678', '123456789', 'qwerty123', 'password123', '11111111', 'aaaaaaaa', 'p@ssw0rd123', 'abcabcabc', 'asdfghjk'];
let strong;
do { strong = randomBytes(6).toString('base64url'); } while (newPasswordError(strong));
assert.equal(strong.length, 8);
async function denied(operation, code) {
  await assert.rejects(operation, error => error.body?.code === code);
}
const baseHeaders = { origin: process.env.BETTER_AUTH_URL };
async function login(email, password) {
  const result = await auth.api.signInEmail({ headers: baseHeaders, body: { email, password }, returnHeaders: true });
  return new Headers({ ...baseHeaders, cookie: result.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') });
}
try {
  for (const p of weakPasswords) assert.equal(newPasswordError(p), 'PASSWORD_TOO_WEAK');
  assert.equal(newPasswordError(strong.slice(0, 7)), 'PASSWORD_TOO_SHORT');
  assert.equal(newPasswordError('x'.repeat(129)), 'PASSWORD_TOO_LONG');
  assert.equal(newPasswordError('harbor violin lantern meadow'), null);
  assert.equal(newPasswordError('тихий парус за далекой луной'), null);
  pass('Local dictionaries/patterns, 7/8/129 boundaries, English and Russian passphrases without character-class rules');

  const user = await db.user.findUniqueOrThrow({ where: { email: 'alexander.smirnov@example.test' } });
  // Existing weak credentials remain usable: policy runs only for new passwords.
  await db.account.updateMany({ where: { userId: user.id, providerId: 'credential' }, data: { password: await hashPassword('12345678') } });
  const headers = await login(user.email, '12345678');
  const otherHeaders = await login(user.email, '12345678');
  pass('Existing weak password still signs in');
  for (const p of weakPasswords) await denied(() => auth.api.changePassword({ headers, body: { currentPassword: '12345678', newPassword: p === '12345678' ? '123456789' : p } }), 'PASSWORD_TOO_WEAK');
  await denied(() => auth.api.changePassword({ headers, body: { currentPassword: '12345678', newPassword: strong.slice(0, 7) } }), 'PASSWORD_TOO_SHORT');
  await denied(() => auth.api.changePassword({ headers, body: { currentPassword: 'wrong', newPassword: strong } }), 'INVALID_PASSWORD');
  const changed = await auth.api.changePassword({ headers, body: { currentPassword: '12345678', newPassword: strong, revokeOtherSessions: false }, returnHeaders: true });
  const currentHeaders = new Headers({ ...baseHeaders, cookie: changed.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') });
  assert(await auth.api.getSession({ headers: currentHeaders }));
  assert.equal(await auth.api.getSession({ headers: otherHeaders }), null);
  await denied(() => auth.api.signInEmail({ headers: baseHeaders, body: { email: user.email, password: '12345678' } }), 'INVALID_EMAIL_OR_PASSWORD');
  await login(user.email, strong);
  pass('Actual auth.api changePassword enforces policy, verifies old password, accepts 8, revokes other sessions and permits only new login');

  const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: 'credential' } });
  await db.account.update({ where: { id: account.id }, data: { password: null } });
  for (const p of weakPasswords) await denied(() => auth.api.setPassword({ headers: currentHeaders, body: { newPassword: p } }), 'PASSWORD_TOO_WEAK');
  await denied(() => auth.api.setPassword({ headers: currentHeaders, body: { newPassword: strong.slice(0, 7) } }), 'PASSWORD_TOO_SHORT');
  await auth.api.setPassword({ headers: currentHeaders, body: { newPassword: strong } });
  await login(user.email, strong);
  pass('Pathless server-only auth.api.setPassword uses the same policy');

  const token = randomBytes(24).toString('hex');
  await db.verification.create({ data: { identifier: 'reset-password:' + token, value: user.id, expiresAt: new Date(Date.now() + 60000) } });
  for (const p of weakPasswords) await denied(() => auth.api.resetPassword({ headers: baseHeaders, body: { token, newPassword: p } }), 'PASSWORD_TOO_WEAK');
  const phrase = 'harbor violin lantern meadow';
  await auth.api.resetPassword({ headers: baseHeaders, body: { token, newPassword: phrase } });
  await login(user.email, phrase);
  pass('Actual auth.api.resetPassword rejects weak passwords and accepts a lowercase passphrase');

  // Registration stays disabled in production. Enable it only in a separate
  // test instance, using the real application hooks, adapter and policy.
  assert.equal(auth.options.emailAndPassword.disableSignUp, true);
  const registration = betterAuth({ ...auth.options, emailAndPassword: { ...auth.options.emailAndPassword, disableSignUp: false } });
  const email = randomBytes(8).toString('hex') + '@example.test';
  for (const p of weakPasswords) await denied(() => registration.api.signUpEmail({ headers: baseHeaders, body: { email, name: 'Policy test', password: p } }), 'PASSWORD_TOO_WEAK');
  await denied(() => registration.api.signUpEmail({ headers: baseHeaders, body: { email, name: 'Policy test', password: strong.slice(0, 7) } }), 'PASSWORD_TOO_SHORT');
  await registration.api.signUpEmail({ headers: baseHeaders, body: { email, name: 'Policy test', password: strong } });
  await login(email, strong);
  pass('Registration uses the same rule; production registration remains disabled');
} finally {
  await db.$disconnect();
  const sourceUnchanged = await fingerprint() === before;
  source.close(); resolver.deregister();
  writeFileSync(resolve(root, 'results.json'), JSON.stringify({ results, sourceUnchanged }, null, 2), { mode: 0o600 });
  assert(sourceUnchanged, 'Main database changed');
  console.info('Password policy report: ' + root);
}
