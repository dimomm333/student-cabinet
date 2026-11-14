import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { demoAccounts } from '../src/lib/demo-accounts.ts';

// A new, migrated database: the timetable expectations belong to this fixture,
// never to a copy of the user's evolving schedule. No local credentials written.
export function provisionTestDatabase(file) {
  const env = { ...process.env, DATABASE_URL: 'file:' + resolve(file).replaceAll('\\','/') };
  for (const account of demoAccounts) env[account.passwordEnv] = randomBytes(24).toString('base64url');
  for (const args of [['node_modules/prisma/build/index.js','migrate','deploy'], ['prisma/seed.ts'], ['prisma/seed.ts','--student-profile-demo-only']]) {
    const result = spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,`Fixture preparation failed: ${args[0]}`);
  }
  return env;
}
