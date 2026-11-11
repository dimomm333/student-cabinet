import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The CLI, seed and application must resolve relative paths to the same file.
export function getDatabaseUrl(value = process.env.DATABASE_URL): string {
  if (!value) {
    throw new Error("DATABASE_URL не задан. Скопируйте .env.example в .env.");
  }

  if (!value.startsWith("file:") || value === "file:") {
    throw new Error("DATABASE_URL должен указывать на локальный файл SQLite: file:./prisma/dev.db");
  }

  const databasePath = value.startsWith("file://")
    ? fileURLToPath(value)
    : resolve(value.slice("file:".length));

  // Prisma's SQLite engine on Windows requires file:C:/..., without ///.
  return `file:${databasePath.replaceAll("\\", "/")}`;
}
