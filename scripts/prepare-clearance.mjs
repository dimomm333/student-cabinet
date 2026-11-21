// Same preserving migration workflow as the existing modules. Never seeds users.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { snapshot, integrity } from './database-snapshot.mjs';
import { dormMoneyIndexes, verifyDormRubles } from './dormitory-money-migration.mjs';
mkdirSync('.local', { recursive: true, mode: 0o700 });
const moduleName = process.argv.includes('--dormitory') ? 'dormitory' : process.argv.includes('--passes') ? 'passes' : 'clearance';
const root = mkdtempSync(resolve('.local/' + moduleName + '-migration-')), source = createClient({ url: getDatabaseUrl() });
function migrate(env) { const r = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, 'Migration failed; private output suppressed.'); }
try {
  await integrity(source);
  const backup = resolve(root, 'before.db'), trialFile = resolve(root, 'trial.db');
  await source.execute({ sql: 'VACUUM INTO ?', args: [backup] });
  const copy = createClient({ url: 'file:' + backup.replaceAll('\\', '/') });
  const before = await snapshot(copy), indexes = await dormMoneyIndexes(copy);
  await copy.execute({ sql: 'VACUUM INTO ?', args: [trialFile] }); copy.close();
  const env = { ...process.env, DATABASE_URL: 'file:' + trialFile.replaceAll('\\', '/') }, trial = createClient({ url: env.DATABASE_URL });
  migrate(env);
  const dormMoneyRows = verifyDormRubles(before, await snapshot(trial));
  if (indexes.length) assert.deepEqual(await dormMoneyIndexes(trial), indexes);
  await integrity(trial);
  const once = await snapshot(trial, true); migrate(env); assert.deepEqual(await snapshot(trial, true), once); trial.close();
  if (process.argv.includes('--apply')) {
    assert.deepEqual(await snapshot(source), before, 'Source changed since backup. Stop writers and retry.');
    migrate(process.env);
    verifyDormRubles(before, await snapshot(source));
    if (indexes.length) assert.deepEqual(await dormMoneyIndexes(source), indexes);
    await integrity(source);
  }
  const result = { applied: process.argv.includes('--apply'), consistentBackup: true, trialMigration: true, originalRowsPreserved: true, idempotent: true, integrity: 'ok', dormMoneyRows };
  writeFileSync(resolve(root, 'results.json'), JSON.stringify(result, null, 2), { mode: 0o600 }); console.info(JSON.stringify(result)); console.info('Private backup/report: ' + root);
} finally { source.close(); }
