import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { snapshot, integrity, preserved } from './database-snapshot.mjs';

mkdirSync('.local', { recursive: true, mode: 0o700 });
const root = mkdtempSync(resolve('.local/notifications-migration-'));
const source = createClient({ url: getDatabaseUrl() });
function migrate(env) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Notification migration failed; private subprocess output suppressed.');
}
try {
  await integrity(source);
  const backup = resolve(root, 'before.db'), trialFile = resolve(root, 'trial.db');
  await source.execute({ sql: 'VACUUM INTO ?', args: [backup] });
  const copy = createClient({ url: 'file:' + backup.replaceAll('\\', '/') });
  const before = await snapshot(copy);
  await copy.execute({ sql: 'VACUUM INTO ?', args: [trialFile] }); copy.close();
  const env = { ...process.env, DATABASE_URL: 'file:' + trialFile.replaceAll('\\', '/') };
  const trial = createClient({ url: env.DATABASE_URL });
  migrate(env); const after = await snapshot(trial); preserved(before, after); await integrity(trial);
  const once = await snapshot(trial, true); migrate(env); assert.deepEqual(await snapshot(trial, true), once);
  const migratedEvents = Number((await trial.execute("SELECT COUNT(*) AS n FROM NotificationEvent WHERE source = 'SERVICES'")).rows[0].n);
  const serviceEvents = Number((await trial.execute('SELECT COUNT(*) AS n FROM ServiceEvent')).rows[0].n);
  assert.equal(migratedEvents, serviceEvents);
  if (!before.Notification) {
    assert.equal(Number((await trial.execute('SELECT COUNT(*) AS n FROM Notification WHERE readAt IS NULL')).rows[0].n), 0);
    assert.equal(Number((await trial.execute('SELECT COUNT(*) AS n FROM NotificationEmail')).rows[0].n), 0);
  }
  trial.close();
  if (process.argv.includes('--apply')) {
    assert.deepEqual(await snapshot(source), before, 'Source changed since backup; stop writers and retry.');
    migrate(process.env); preserved(before, await snapshot(source)); await integrity(source);
  }
  const result = { applied: process.argv.includes('--apply'), consistentBackup: true, trialMigration: true, originalRowsPreserved: true, idempotent: true, existingServiceEvents: serviceEvents, noHistoricalMail: true, integrity: 'ok' };
  writeFileSync(resolve(root, 'results.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.info(JSON.stringify(result)); console.info('Private backup/report: ' + root);
} finally { source.close(); }
