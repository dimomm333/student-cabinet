import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { seedServices } from '../src/lib/services-repository.ts';
const db = createPrismaClient();
try { await seedServices(db); console.info('Service catalogue seeded (existing versions retained).'); } finally { await db.$disconnect(); }
