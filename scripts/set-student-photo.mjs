// Trusted offline university operation. There is deliberately no upload API.
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { MAX_OFFICIAL_PHOTO_BYTES, prepareOfficialPhoto } from '../src/lib/student-photo.ts';

const [userId, file] = process.argv.slice(2);
if (!userId || !file) throw new Error('Usage: npm run db:student-photo -- <userId> <file>');
const mime = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' }[extname(file).toLowerCase()];
if (!mime) throw new Error('Допустимы JPEG, PNG и WebP.');
const db = createPrismaClient();
try {
  const student = await db.studentProfile.findFirst({ where: { userId, user: { role: 'STUDENT' } }, select: { userId: true } });
  if (!student) throw new Error('Студент не найден.');
  const handle = await open(file, 'r');
  let input;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_OFFICIAL_PHOTO_BYTES) throw new Error('Недопустимый размер файла.');
    const buffer = Buffer.alloc(MAX_OFFICIAL_PHOTO_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    input = buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
  const photo = await prepareOfficialPhoto(input, mime);
  // Role is rechecked in the same transaction as the write.
  await db.$transaction(async tx => {
    await tx.studentProfile.findFirstOrThrow({ where: { userId, user: { role: 'STUDENT' } }, select: { userId: true } });
    await tx.studentOfficialPhoto.upsert({ where: { userId }, create: { userId, ...photo }, update: photo });
  });
  console.info('Официальная фотография сохранена.');
} finally { await db.$disconnect(); }
