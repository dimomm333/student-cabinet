import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createClient} from '@libsql/client';
import {getDatabaseUrl} from '../src/lib/database-url.ts';
import {snapshot,integrity} from './database-snapshot.mjs';
mkdirSync('.local',{recursive:true});const root=mkdtempSync(resolve('.local/brs-primary-migration-'));
const source=createClient({url:getDatabaseUrl()});
function run(args,env){const result=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true});if(result.status!==0)console.error(result.stderr);assert.equal(result.status,0,'Migration/reconciliation failed');}
function preserved(before,after){
  const permitted={BrsFinal:['needsReview','version'],BrsPlan:['revision']};
  for(const [table,{pk,rows}]of Object.entries(before)){
    assert(after[table],'Missing table '+table);if(table!=='BrsAudit')assert.equal(after[table].rows.length,rows.length,'Row count changed '+table);
    for(const row of rows){const actual=after[table].rows.find(candidate=>pk.every(key=>candidate[key]===row[key]));assert(actual,'Missing old row '+table);for(const[field,value]of Object.entries(row))if(!permitted[table]?.includes(field))assert.deepEqual(actual[field],value,'Old field changed '+table+'.'+field);}
  }
  for(const row of before.BrsResult?.rows??[]){const current=after.BrsResult.rows.find(item=>item.id===row.id);assert.equal(current.score,row.score);if(!Object.hasOwn(row,'primaryScore')){assert.equal(current.primaryScore,null);assert.equal(current.primaryMax,null);assert.equal(current.submissionTiming,null);}}
  const addedAudits=after.BrsAudit.rows.filter(item=>!before.BrsAudit.rows.some(old=>old.id===item.id));assert(addedAudits.every(item=>item.action==='SEMINAR_POLICY_CHANGE'));
  for(const row of before.BrsFinal?.rows??[]){const current=after.BrsFinal.rows.find(item=>item.id===row.id);if(current.version!==row.version){assert.equal(current.version,row.version+1);assert.equal(current.needsReview,1);assert(addedAudits.some(item=>item.objectId===row.studentId&&item.planId===row.planId));}}
}
try{
  const backup=resolve(root,'before.db');await source.execute({sql:'VACUUM INTO ?',args:[backup]});const copy=createClient({url:'file:'+backup.replaceAll('\\','/')});const before=await snapshot(copy),trialFile=resolve(root,'trial.db');await copy.execute({sql:'VACUUM INTO ?',args:[trialFile]});copy.close();
  const trial=createClient({url:'file:'+trialFile.replaceAll('\\','/')}),env={...process.env,DATABASE_URL:'file:'+trialFile.replaceAll('\\','/')};
  run(['node_modules/prisma/build/index.js','migrate','deploy'],env);run(['--conditions=react-server','scripts/reconcile-brs-seminars.mjs'],env);preserved(before,await snapshot(trial));await integrity(trial);
  const once=await snapshot(trial);run(['--conditions=react-server','scripts/reconcile-brs-seminars.mjs'],env);assert.deepEqual(await snapshot(trial),once,'Policy reconciliation must be idempotent');trial.close();
  if(process.argv.includes('--apply')){assert.deepEqual(await snapshot(source),before,'Source changed after backup; retry');run(['node_modules/prisma/build/index.js','migrate','deploy'],process.env);run(['--conditions=react-server','scripts/reconcile-brs-seminars.mjs'],process.env);preserved(before,await snapshot(source));await integrity(source);}
  const report={applied:process.argv.includes('--apply'),allLegacyScoresAndAuditPreserved:true,noInventedPrimaryValues:true,officialScoresUnchanged:true,reconciliationIdempotent:true,integrity:'ok'};writeFileSync(resolve(root,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.info(JSON.stringify(report));console.info('Private backup/report: '+root);
}finally{source.close();}
