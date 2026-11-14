import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { getDatabaseUrl } from '../src/lib/database-url.ts';

mkdirSync('.local',{recursive:true});
const root=mkdtempSync(resolve('.local/schedule-editor-migration-'));
const source=createClient({url:getDatabaseUrl()});
async function snapshot(db) {
  const result={};
  for(const {name} of (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name")).rows) {
    const pk=(await db.execute(`PRAGMA table_info("${name}")`)).rows.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    result[name]={pk,rows:(await db.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows};
  }
  return JSON.parse(JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v));
}
function preserved(before,after,links=false) {
  for(const [name,{pk,rows}]of Object.entries(before))for(const row of rows) {
    const explicitDemo = ({'demo-group-pi-24-1':'pi-24-1','demo-group-pi-24-2':'pi-24-2','demo-group-it-25-1':'it-25-1'})[row.id] === row.slug;
    const current=after[name].rows.find(other=>pk.every(key=>other[key]===row[key]));assert(current,`Missing old row: ${name}`);
    for(const [field,value]of Object.entries(row)) {
      if(links && explicitDemo && name==='StudyGroup' && field==='updatedAt' && row.departmentId===null) continue;
      if(links && explicitDemo && name==='StudyGroup' && field==='departmentId' && value===null) {
        const expected=row.id==='demo-group-it-25-1'?'Кафедра информационных технологий':'Учебная кафедра';
        const department=after.AcademicDepartment.rows.find(item=>item.id===current.departmentId);
        assert.equal(department?.name,expected);assert.equal(department?.faculty,'Институт цифровых технологий');continue;
      }
      assert.deepEqual(current[field],value,`Old value changed: ${name}.${field}`);
    }
  }
}
function run(args,env) {const result=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,`Failed ${args[0]}`);}
async function check(db){assert.equal((await db.execute('PRAGMA integrity_check')).rows[0].integrity_check,'ok');assert.equal((await db.execute('PRAGMA foreign_key_check')).rows.length,0);}
try {
  const backup=resolve(root,'before.db');await source.execute({sql:'VACUUM INTO ?',args:[backup]});
  const saved=createClient({url:'file:'+backup.replaceAll('\\','/')});const before=await snapshot(saved);
  const file=resolve(root,'trial.db');await saved.execute({sql:'VACUUM INTO ?',args:[file]});saved.close();
  const env={...process.env,DATABASE_URL:'file:'+file.replaceAll('\\','/')};
  const trial=createClient({url:env.DATABASE_URL});
  run(['node_modules/prisma/build/index.js','migrate','deploy'],env);preserved(before,await snapshot(trial));
  run(['prisma/seed.ts','--schedule-links-only'],env);preserved(before,await snapshot(trial),true);
  const once=await snapshot(trial);run(['prisma/seed.ts','--schedule-links-only'],env);assert.deepEqual(await snapshot(trial),once);await check(trial);trial.close();
  if(process.argv.includes('--apply')) {
    assert.deepEqual(await snapshot(source),before,'Source changed after backup. Retry with no concurrent writers.');
    run(['node_modules/prisma/build/index.js','migrate','deploy'],process.env);
    run(['prisma/seed.ts','--schedule-links-only'],process.env);preserved(before,await snapshot(source),true);await check(source);
  }
  const result={migration:true,oldRowsPreserved:true,onlyExplicitEmptyDemoLinksFilled:true,seedIdempotent:true,integrity:'ok',applied:process.argv.includes('--apply')};
  writeFileSync(resolve(root,'results.json'),JSON.stringify(result,null,2));console.info(JSON.stringify(result));console.info('Private backup: '+root.replaceAll('\\','/')+'/before.db');
}finally{source.close();}
