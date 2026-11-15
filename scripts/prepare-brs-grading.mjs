import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createClient} from '@libsql/client';
import {getDatabaseUrl} from '../src/lib/database-url.ts';
import {snapshot,preserved,integrity} from './database-snapshot.mjs';

mkdirSync('.local',{recursive:true});
const root=mkdtempSync(resolve('.local/brs-grading-migration-'));
const source=createClient({url:getDatabaseUrl()});
function deploy(env){const r=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);}
try{
  await integrity(source);
  const backup=resolve(root,'before.db');await source.execute({sql:'VACUUM INTO ?',args:[backup]});
  const copy=createClient({url:'file:'+backup.replaceAll('\\','/')});let before;
  const trialFile=resolve(root,'trial.db');
  try{before=await snapshot(copy);await copy.execute({sql:'VACUUM INTO ?',args:[trialFile]});}finally{copy.close();}
  const trial=createClient({url:'file:'+trialFile.replaceAll('\\','/')});
  try{deploy({...process.env,DATABASE_URL:'file:'+trialFile.replaceAll('\\','/')});preserved(before,await snapshot(trial));await integrity(trial);}finally{trial.close();}
  if(process.argv.includes('--apply')){assert.deepEqual(await snapshot(source),before,'Source changed since backup');deploy(process.env);preserved(before,await snapshot(source));await integrity(source);}
  const report={applied:process.argv.includes('--apply'),allExistingFieldsPreserved:true,results:before.BrsResult.rows.length,officials:before.BrsFinal.rows.length,integrity:'ok'};
  writeFileSync(resolve(root,'results.json'),JSON.stringify(report,null,2),{mode:0o600});console.info(report);console.info('Private backup/report: '+root);
}finally{source.close();}
