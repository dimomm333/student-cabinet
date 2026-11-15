import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { seedBrsDemo } from '../prisma/brs-demo.ts';
const db = createPrismaClient();
try { await seedBrsDemo(db); } finally { await db.$disconnect(); }
