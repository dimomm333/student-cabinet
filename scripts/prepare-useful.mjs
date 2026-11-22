import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@libsql/client";
import { integrity, snapshot } from "./database-snapshot.mjs";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { seedUsefulCatalog } from "../prisma/useful-seed.ts";

const migration = "20261122150000_useful_catalog";
const originalUrl = getDatabaseUrl();
assert(existsSync(originalUrl.slice(5)), "Укажите существующую локальную SQLite в DATABASE_URL.");
mkdirSync(".local", { recursive: true, mode: 0o700 });
const folder = mkdtempSync(resolve(".local/useful-migration-"));
const backupPath = resolve(folder, "before.db");
const trialPath = resolve(folder, "trial.db");
const fileUrl = path => "file:" + path.replaceAll("\\", "/");
const source = createClient({ url: originalUrl });

function migrate(url) {
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0, "Prisma migrate deploy завершилась ошибкой: " + result.stderr);
}

async function seed(url) {
  const db = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  try { return await seedUsefulCatalog(db); }
  finally { await db.$disconnect(); }
}

function verifyPreservation(before, after) {
  const { UsefulEntry: prior, _prisma_migrations: oldMigrations, ...oldData } = before;
  const { UsefulEntry: current, _prisma_migrations: newMigrations, ...newData } = after;
  assert(isDeepStrictEqual(newData, oldData), "Сведения за пределами справочника изменились.");
  assert(current, "Таблица справочника не создана.");
  if (prior) {
    const byId = new Map(current.rows.map(row => [row.id, row]));
    for (const row of prior.rows) assert(isDeepStrictEqual(byId.get(row.id), row), "Изменена существующая запись справочника.");
  }
  const priorIds = new Set(oldMigrations.rows.map(row => row.id));
  assert.deepEqual(newMigrations.rows.filter(row => priorIds.has(row.id)), oldMigrations.rows);
  const added = newMigrations.rows.filter(row => !priorIds.has(row.id));
  assert(added.length <= 1 && added.every(row => row.migration_name === migration && row.finished_at), "Обнаружены другие ожидающие миграции.");
  assert(newMigrations.rows.some(row => row.migration_name === migration && row.finished_at));
}

try {
  await integrity(source);
  await source.execute({ sql: "VACUUM INTO ?", args: [backupPath] });
  const backup = createClient({ url: fileUrl(backupPath) });
  let before;
  try {
    before = await snapshot(backup, true);
    await backup.execute({ sql: "VACUUM INTO ?", args: [trialPath] });
  } finally { backup.close(); }

  const trialUrl = fileUrl(trialPath);
  const trial = createClient({ url: trialUrl });
  let inserted;
  try {
    migrate(trialUrl);
    inserted = await seed(trialUrl);
    await integrity(trial);
    const once = await snapshot(trial, true);
    verifyPreservation(before, once);
    assert.equal(await seed(trialUrl), 0);
    assert(isDeepStrictEqual(await snapshot(trial, true), once), "Повторное заполнение изменило данные.");
  } finally { trial.close(); }

  if (process.argv.includes("--apply")) {
    assert(isDeepStrictEqual(await snapshot(source, true), before), "База изменилась после копирования. Остановите процессы записи и повторите.");
    migrate(originalUrl);
    assert.equal(await seed(originalUrl), inserted);
    await integrity(source);
    verifyPreservation(before, await snapshot(source, true));
  }
  console.info(JSON.stringify({ migration, applied: process.argv.includes("--apply"), inserted, backupPath }));
} finally { source.close(); }
