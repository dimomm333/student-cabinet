// Trusted offline provisioning, never a public API. Explicit grants only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { categories, configFor } from '../src/lib/services-catalog.ts';
const file = process.argv[2];
assert(file, 'Usage: npm run services:configure -- <private-config.json>');
const input = JSON.parse(await readFile(file, 'utf8'));
assert(Array.isArray(input.routes) && Array.isArray(input.grants));
const db = createPrismaClient();
try {
  await db.$transaction(async tx => {
    await tx.serviceWriteState.update({ where: { id: 'services' }, data: { version: { increment: 1 } } });
    for (const r of input.routes) {
      configFor(r.serviceCode); assert.equal(typeof r.active, 'boolean');
      await tx.academicDepartment.findUniqueOrThrow({ where: { id: r.sourceDepartmentId } });
      await tx.academicDepartment.findUniqueOrThrow({ where: { id: r.departmentId } });
      const data = { serviceCode: r.serviceCode, sourceDepartmentId: r.sourceDepartmentId, departmentId: r.departmentId, active: r.active };
      await tx.serviceRoute.upsert({ where: { serviceCode_sourceDepartmentId: { serviceCode: r.serviceCode, sourceDepartmentId: r.sourceDepartmentId } }, create: data, update: data });
    }
    for (const g of input.grants) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: g.userId } });
      assert(['ADMIN', 'TECHNICAL_STAFF', 'DEANERY_STAFF'].includes(user.role));
      assert(Boolean(g.serviceCode) !== Boolean(g.category), 'Exactly one serviceCode/category');
      if (g.serviceCode) configFor(g.serviceCode); else assert(Object.hasOwn(categories, g.category));
      for (const key of ['active', 'readFiles', 'readMilitary']) assert.equal(typeof g[key], 'boolean');
      if (user.role === 'DEANERY_STAFF' && g.active) await tx.deaneryDepartmentAssignment.findUniqueOrThrow({ where: { userId_departmentId: { userId: g.userId, departmentId: g.departmentId } } });
      const id = createHash('sha256').update(JSON.stringify([g.userId, g.departmentId, g.serviceCode ?? null, g.category ?? null])).digest('hex');
      const data = { userId: g.userId, departmentId: g.departmentId, serviceCode: g.serviceCode ?? null, category: g.category ?? null, active: g.active, readFiles: g.readFiles, readMilitary: g.readMilitary };
      await tx.serviceGrant.upsert({ where: { id }, create: { id, ...data }, update: data });
    }
  });
  console.info('Explicit service routing/grants updated. No requests or profiles changed.');
} finally { await db.$disconnect(); }
