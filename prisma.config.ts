import "dotenv/config";
import { defineConfig } from "prisma/config";
import { getDatabaseUrl } from "./src/lib/database-url.ts";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node --env-file=.env prisma/seed.ts",
  },
  datasource: {
    // Generating the client during npm ci does not require a database or .env.
    url: process.env.DATABASE_URL ? getDatabaseUrl() : undefined,
  },
});
