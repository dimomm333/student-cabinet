import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { snapshot, preserved, integrity } from './database-snapshot.mjs';

mkdirSync('.local', {recursive:true});
const root = mkdtempSync(resolve('.local/brs-migration-'));
const source = createClient({url:getDatabaseUrl()});
function run(args, env) {
  const result=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true});
  if (result.status !== 0) console.error(result.stderr);
  assert.equal(result.status,0,`Failed: ${args[0]}`);
}
try {
  const backup=resolve(root,'before.db');
  await source.execute({sql:'VACUUM INTO ?',args:[backup]});
  const copy=createClient({url:'file:'+backup.replaceAll('\\','/')});
  const before=await snapshot(copy), trialFile=resolve(root,'trial.db');
  await copy.execute({sql:'VACUUM INTO ?',args:[trialFile]}); copy.close();
  const trial=createClient({url:'file:'+trialFile.replaceAll('\\','/')});
  const trialEnv={...process.env,DATABASE_URL:'file:'+trialFile.replaceAll('\\','/')};
  run(['node_modules/prisma/build/index.js','migrate','deploy'],trialEnv);
  preserved(before,await snapshot(trial)); await integrity(trial);
  run(['--conditions=react-server','scripts/seed-brs.mjs'],trialEnv);
  const once=await snapshot(trial);
  run(['--conditions=react-server','scripts/seed-brs.mjs'],trialEnv);
  assert.deepEqual(await snapshot(trial),once,'BRS seed must be idempotent');
  preserved(before,once); await integrity(trial); trial.close();
  if(process.argv.includes('--apply')) {
    assert.deepEqual(await snapshot(source),before,'Source changed since consistent backup; retry with a fresh backup');
    run(['node_modules/prisma/build/index.js','migrate','deploy'],process.env);
    preserved(before,await snapshot(source)); await integrity(source);
    run(['--conditions=react-server','scripts/seed-brs.mjs'],process.env);
    preserved(before,await snapshot(source)); await integrity(source);
  }
  const report={trialMigration:true,allExistingFieldsAndPhotosPreserved:true,seedIdempotent:true,integrity:'ok',applied:process.argv.includes('--apply')};
  writeFileSync(resolve(root,'results.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.info(JSON.stringify(report)); console.info('Private backup and report: '+root.replaceAll('\\','/'));
} finally { source.close(); }
