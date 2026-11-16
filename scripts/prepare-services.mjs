import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { snapshot, integrity, preserved } from './database-snapshot.mjs';

mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/services-migration-'));
const source = createClient({ url: getDatabaseUrl() });
function run(env) {
  for (const args of [['node_modules/prisma/build/index.js', 'migrate', 'deploy'], ['--conditions=react-server', 'scripts/seed-services.mjs']]) {
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, 'Services migration/seed failed; sensitive subprocess output suppressed.');
  }
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
  run(env); preserved(before, await snapshot(trial)); await integrity(trial);
  const once = await snapshot(trial); run(env); assert.deepEqual(await snapshot(trial), once); trial.close();
  if (process.argv.includes('--apply')) {
    assert.deepEqual(await snapshot(source), before, 'Source changed since backup; stop writers and retry.');
    run(process.env); preserved(before, await snapshot(source)); await integrity(source);
  }
  const result = { applied: process.argv.includes('--apply'), consistentBackup: true, trialMigration: true, originalRowsPreserved: true, seedIdempotent: true, integrity: 'ok' };
  writeFileSync(resolve(root, 'results.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.info(JSON.stringify(result)); console.info('Private backup/report: ' + root);
} finally { source.close(); }
