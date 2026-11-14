import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { getDatabaseUrl } from '../src/lib/database-url.ts';

// SQLite-specific backup/migration orchestration. Runtime uses Prisma APIs.
mkdirSync('.local', {recursive:true});
const root = mkdtempSync(resolve('.local/student-profile-migration-'));
const source = createClient({url:getDatabaseUrl()});
const json = value => JSON.stringify(value, (_,v)=>typeof v==='bigint'?String(v):v);
async function snapshot(db) {
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name")).rows;
  const result = {};
  for (const {name} of tables) {
    const pk = (await db.execute(`PRAGMA table_info("${name}")`)).rows.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    result[name] = {pk, rows: (await db.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows};
  }
  return JSON.parse(json(result));
}
function preserved(before, after) {
  for (const [table,{pk,rows}] of Object.entries(before)) {
    assert.equal(after[table].rows.length, rows.length, `Row count changed: ${table}`);
    for(const row of rows) {
      const actual = after[table].rows.find(candidate=>pk.every(key=>candidate[key]===row[key]));
      for(const [field,value] of Object.entries(row)) assert.deepEqual(actual?.[field],value,`Existing field changed: ${table}.${field}`);
    }
  }
}
function run(args,env) {
  const result=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,`Failed: ${args[0]}`);
}
async function integrity(db) {
  assert.equal((await db.execute('PRAGMA integrity_check')).rows[0].integrity_check,'ok');
  assert.equal((await db.execute('PRAGMA foreign_key_check')).rows.length,0);
}
try {
  const backup=resolve(root,'before.db');
  await source.execute({sql:'VACUUM INTO ?',args:[backup]});
  const backupDb=createClient({url:'file:'+backup.replaceAll('\\','/')});
  const before=await snapshot(backupDb), trialFile=resolve(root,'trial.db');
  await backupDb.execute({sql:'VACUUM INTO ?',args:[trialFile]}); backupDb.close();
  const trial=createClient({url:'file:'+trialFile.replaceAll('\\','/')});
  const trialEnv={...process.env,DATABASE_URL:'file:'+trialFile.replaceAll('\\','/')};
  run(['node_modules/prisma/build/index.js','migrate','deploy'],trialEnv);
  preserved(before,await snapshot(trial)); await integrity(trial);
  run(['prisma/seed.ts','--student-profile-demo-only'],trialEnv);
  const once=await snapshot(trial);
  run(['prisma/seed.ts','--student-profile-demo-only'],trialEnv);
  assert.deepEqual(await snapshot(trial),once,'Photo seed must be idempotent');
  // All pre-existing data is compared including sessions and full schedule.
  preserved(before,once); trial.close();
  if(process.argv.includes('--apply')) {
    assert.deepEqual(await snapshot(source),before,'Source changed since backup; retry with fresh snapshot');
    run(['node_modules/prisma/build/index.js','migrate','deploy'],process.env);
    preserved(before,await snapshot(source)); await integrity(source);
    run(['prisma/seed.ts','--student-profile-demo-only'],process.env);
    preserved(before,await snapshot(source));
  }
  const report={trialMigration:true,allExistingFieldsPreserved:true,seedIdempotent:true,integrity:'ok',applied:process.argv.includes('--apply')};
  writeFileSync(resolve(root,'results.json'),JSON.stringify(report,null,2));
  console.info(JSON.stringify(report));
  console.info('Private backup: '+root.replaceAll('\\','/')+'/before.db');
} finally { source.close(); }
