import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createClient} from '@libsql/client';
import {getDatabaseUrl} from '../src/lib/database-url.ts';
import {snapshot,integrity} from './database-snapshot.mjs';
mkdirSync('.local',{recursive:true});const root=mkdtempSync(resolve('.local/brs-final-review-'));
const source=createClient({url:getDatabaseUrl()});
function run(env){const r=spawnSync(process.execPath,['--env-file-if-exists=.env','--conditions=react-server','scripts/reconcile-brs-finals.mjs'],{env,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim());}
function preserved(before,after){
  for(const [table,{pk,rows}]of Object.entries(before)){
    assert(after[table]);if(table!=='BrsAudit')assert.equal(after[table].rows.length,rows.length,table+' count');
    for(const row of rows){const current=after[table].rows.find(item=>pk.every(key=>item[key]===row[key]));assert(current);for(const[key,value]of Object.entries(row))if(!(table==='BrsFinal'&&['needsReview','version'].includes(key))&&!(table==='BrsPlan'&&key==='revision'))assert.deepEqual(current[key],value,table+'.'+key);}
  }
  const audits=after.BrsAudit.rows.filter(row=>!before.BrsAudit.rows.some(old=>old.id===row.id));assert(audits.every(row=>row.action==='FINAL_CONSISTENCY_REVIEW'));
  for(const row of before.BrsFinal.rows){const current=after.BrsFinal.rows.find(item=>item.id===row.id);if(current.version!==row.version){assert.equal(current.version,row.version+1);assert.equal(current.needsReview,1);assert(audits.some(audit=>audit.beforeJson.includes(row.id)));}}
}
try{
  await integrity(source);const backup=resolve(root,'before.db');await source.execute({sql:'VACUUM INTO ?',args:[backup]});
  const copy=createClient({url:'file:'+backup.replaceAll('\\','/')}),trialFile=resolve(root,'trial.db');let before;
  try{before=await snapshot(copy);await copy.execute({sql:'VACUUM INTO ?',args:[trialFile]});}finally{copy.close();}
  const trial=createClient({url:'file:'+trialFile.replaceAll('\\','/')});let trialResult;
  try{trialResult=run({...process.env,DATABASE_URL:'file:'+trialFile.replaceAll('\\','/')});preserved(before,await snapshot(trial));await integrity(trial);const once=await snapshot(trial);assert.equal(run({...process.env,DATABASE_URL:'file:'+trialFile.replaceAll('\\','/')}).markedForReview,0);assert.deepEqual(await snapshot(trial),once);}finally{trial.close();}
  let result=trialResult;
  if(process.argv.includes('--apply')){assert.deepEqual(await snapshot(source),before,'Source changed after backup');result=run(process.env);preserved(before,await snapshot(source));await integrity(source);}
  const report={applied:process.argv.includes('--apply'),...result,officialScoresAndHistoryPreserved:true,allResultsAndPhotosPreserved:true,idempotent:true,integrity:'ok'};writeFileSync(resolve(root,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.info(report);console.info('Private backup/report: '+root);
}finally{source.close();}
