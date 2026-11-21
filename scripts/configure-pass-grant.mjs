import { createPrismaClient } from '../src/lib/prisma-client.ts';

const [email, mode, ...extra] = process.argv.slice(2);
if (!email || extra.length || !['verify', 'manage', 'both', 'none'].includes(mode)) {
  throw new Error('npm run passes:grant -- <email> verify|manage|both|none');
}
const db = createPrismaClient();
try {
  await db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { email }, select: { id: true, role: true } });
    if (mode === 'none') {
      await tx.passGrant.deleteMany({ where: { userId: user.id } });
      return;
    }
    if (!['ADMIN', 'TECHNICAL_STAFF'].includes(user.role)) throw new Error('Роль не допускает назначения.');
    const rights = { role: user.role, canManage: ['manage', 'both'].includes(mode), canVerify: ['verify', 'both'].includes(mode) };
    await tx.passGrant.upsert({ where: { userId: user.id }, create: { userId: user.id, ...rights }, update: rights });
  });
  console.info('Назначение сохранено.');
} finally { await db.$disconnect(); }
