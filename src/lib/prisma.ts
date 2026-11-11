import "server-only";
import { createPrismaClient } from "./prisma-client";

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Reuse the client across Fast Refresh updates in development.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
