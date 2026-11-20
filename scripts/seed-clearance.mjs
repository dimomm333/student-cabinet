import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { seedClearanceDemo, configureClearance, clearanceIdentities } from './clearance-fixture.mjs';
if (!process.argv.includes('--apply')) throw new Error('Explicit operator action required: --apply. Use --configure-only to add only missing configuration.');
if (process.env.NODE_ENV === 'production' && !process.argv.includes('--configure-only')) throw new Error('Demo seeding is disabled with NODE_ENV=production.');
const db = createPrismaClient();
try {
  if (process.argv.includes('--configure-only')) { await configureClearance(db); console.info('Missing departments/templates added. Existing configuration and users preserved.'); }
  else {
    const passwords = Object.fromEntries(clearanceIdentities.map(i => [i.key, process.env['CLEARANCE_' + i.key + '_PASSWORD']]));
    // Validate before writing any user, including in a partially provisioned DB.
    for (const i of clearanceIdentities) if (!await db.user.count({ where: { email: i.email } }) && (!passwords[i.key] || passwords[i.key].length < 12 || passwords[i.key].length > 128)) throw new Error('Supply CLEARANCE_' + i.key + '_PASSWORD (12–128 characters).');
    const result = await seedClearanceDemo(db, passwords); console.info(JSON.stringify({ processId: result.processId, identities: clearanceIdentities.map(({ email, role }) => ({ email, role })), passwords: 'Supplied through environment; never printed or changed for existing accounts.' }, null, 2));
  }
} finally { await db.$disconnect(); }
