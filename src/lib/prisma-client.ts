import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client.ts";
import { getDatabaseUrl } from "./database-url.ts";

// Shared by server-side code and the standalone seed script.
export function createPrismaClient() {
  const adapter = new PrismaLibSql({ url: getDatabaseUrl() });
  return new PrismaClient({ adapter });
}
