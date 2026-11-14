import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@libsql/client';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { demoAccounts } from '../src/lib/demo-accounts.ts';

// This command is deliberately SQLite-specific. VACUUM INTO creates a consistent
// snapshot including WAL transactions; copying the live database file does not.
mkdirSync('.local', {recursive:true});
const root = mkdtempSync(resolve('.local/deanery-migration-'));
const source = createClient({url:getDatabaseUrl()});
async function snapshot(db) {
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name")).rows;
  const result = {};
  for (const {name} of tables) {
    const pk = (await db.execute(`PRAGMA table_info("${name}")`)).rows.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    const rows = (await db.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows;
    result[name] = {pk, rows};
  }
  return JSON.parse(JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v));
}
function preserved(before, after) {
  for (const [table,{pk,rows}] of Object.entries(before)) for(const row of rows) {
    const actual = after[table].rows.find(candidate => pk.every(key=>candidate[key]===row[key]));
    for (const [field,value] of Object.entries(row)) assert.deepEqual(actual?.[field],value,`Existing field changed in ${table}.${field}`);
  }
}
function run(args,env) {
  const result=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true});
  // Never emit subprocess output that could contain credentials or DB records.
  assert.equal(result.status,0,`Failed: ${args[0]}`);
}
try {
  const backup=resolve(root,'before.db');
  await source.execute({sql:'VACUUM INTO ?',args:[backup]});
  const copyFile=resolve(root,'trial.db');
  const backupDb=createClient({url:'file:'+backup.replaceAll('\\','/')});
  await backupDb.execute({sql:'VACUUM INTO ?',args:[copyFile]});
  const before=await snapshot(backupDb); backupDb.close();
  const trial=createClient({url:'file:'+copyFile.replaceAll('\\','/')});
  const trialEnv={...process.env,DATABASE_URL:'file:'+copyFile.replaceAll('\\','/')};
  for(const actor of demoAccounts)trialEnv[actor.passwordEnv]=randomBytes(24).toString('base64url');
  run(['node_modules/prisma/build/index.js','migrate','deploy'],trialEnv);
  preserved(before,await snapshot(trial));
  run(['prisma/seed.ts','--deanery-only'],trialEnv);
  preserved(before,await snapshot(trial));
  const once=await snapshot(trial);
  run(['prisma/seed.ts','--deanery-only'],trialEnv);
  assert.deepEqual(await snapshot(trial),once,'Seed must be idempotent');
  assert.equal((await trial.execute('PRAGMA integrity_check')).rows[0].integrity_check,'ok');
  assert.equal((await trial.execute('PRAGMA foreign_key_check')).rows.length,0);
  trial.close();
  if(process.argv.includes('--apply')) {
    // Refuse to migrate if concurrent writers changed original records since backup.
    assert.deepEqual(await snapshot(source),before,'Source changed after backup; retry with a fresh snapshot');
    run(['node_modules/prisma/build/index.js','migrate','deploy'],process.env);
    run(['prisma/seed.ts','--deanery-only'],process.env);
    preserved(before,await snapshot(source));
    assert.equal((await source.execute('PRAGMA integrity_check')).rows[0].integrity_check,'ok');
    assert.equal((await source.execute('PRAGMA foreign_key_check')).rows.length,0);
  }
  const report={trialMigration:true,originalRowsPreserved:true,seedIdempotent:true,integrity:'ok',applied:process.argv.includes('--apply')};
  writeFileSync(resolve(root,'results.json'),JSON.stringify(report,null,2));
  console.info(JSON.stringify(report));
  console.info('Private consistent backup: '+root.replaceAll('\\','/')+'/before.db');
} finally { source.close(); }
