import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { integrity, snapshot } from "./database-snapshot.mjs";
import { seedPhysicalEducation, newPhysicalAccounts } from "./physical-education-demo-data.mjs";

const fileUrl = path => "file:" + path.replaceAll("\\", "/");
const migration = "20261122160000_physical_education";
const transferMigration = "20261122170000_physical_transfers";
const sourceUrl = getDatabaseUrl();
const sourcePath = sourceUrl.slice(5);
assert(process.env.NODE_ENV !== "production", "Команда предназначена для локального ЛКС.");
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.BETTER_AUTH_URL).hostname), "BETTER_AUTH_URL должен указывать на локальный ЛКС.");
assert(existsSync(sourcePath) && realpathSync(sourcePath) === resolve("prisma/dev.db"), "Команда применима только к текущей локальной prisma/dev.db.");
const apply = process.argv.includes("--apply");
mkdirSync(".local", { recursive: true, mode: 0o700 });
const folder = resolve(".local/physical-education");
mkdirSync(folder, { mode: 0o700, recursive: true });
if (process.platform === "win32") {
  const sid = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).match(/S-1-[0-9-]+/)?.[0];
  assert(sid, "Не удалось определить владельца локального файла учётных данных.");
  execFileSync("icacls.exe", [folder, "/inheritance:r", "/grant:r", "*" + sid + ":(OI)(CI)F"], { windowsHide: true });
} else chmodSync(folder, 0o700);

const credentialsPath = resolve(folder, "credentials.json");
const emails = newPhysicalAccounts.map(account => account.email);
const exists = existsSync(credentialsPath);
const credentials = exists ? JSON.parse(readFileSync(credentialsPath, "utf8")) : {};
const missing = emails.filter(email => !Object.hasOwn(credentials, email));
for (const email of missing) credentials[email] = randomBytes(24).toString("base64url");
if (missing.length && apply) {
  const temporary = credentialsPath + "." + randomBytes(12).toString("hex");
  writeFileSync(temporary, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, credentialsPath);
}
assert(emails.every(email => typeof credentials[email] === "string" && credentials[email].length >= 24), "Локальный файл учётных данных некорректен.");
const hashes = Object.fromEntries(await Promise.all(emails.map(async email => [email, await hashPassword(credentials[email])])));
const batch = mkdtempSync(resolve(folder, "migration-"));
const backupPath = resolve(batch, "before.db"), trialPath = resolve(batch, "trial.db");
const source = createClient({ url: sourceUrl });

function migrate(url) {
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0, "Prisma migrate deploy завершилась ошибкой. " + result.stderr);
}

async function seed(url) {
  const db = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  try { return await seedPhysicalEducation(db, hashes); }
  finally { await db.$disconnect(); }
}

function verifyPreservation(before, after, seeded = false) {
  const preservedDemoPlan = seeded && before.BrsAudit.rows.find(row =>
    row.requestId === "physical-education-local-demo-v1" && row.action === "PE_DEMO_SEEDED")?.objectId;
  const revisedPlan = preservedDemoPlan && before.PeGroup?.rows.find(row => row.id === preservedDemoPlan)?.planId;
  for (const [table, { pk, rows }] of Object.entries(before)) {
    const current = after[table];
    assert(current, "Пропала таблица " + table);
    const id = row => JSON.stringify(pk.map(column => row[column]));
    const indexed = new Map(current.rows.map(row => [id(row), row]));
    assert(rows.every(row => {
      const saved = indexed.get(id(row));
      if (table === "BrsPlan" && saved?.id === revisedPlan && row.id === revisedPlan) {
        return saved.revision >= row.revision && JSON.stringify({ ...saved, revision: row.revision }) === JSON.stringify(row);
      }
      return JSON.stringify(saved) === JSON.stringify(row);
    }), "Изменились существующие строки таблицы " + table);
  }
  const beforeNames = new Set(before._prisma_migrations.rows.map(row => row.migration_name));
  assert(after._prisma_migrations.rows.some(row => row.migration_name === migration && row.finished_at && !row.rolled_back_at), "Миграция физкультуры не применена.");
  assert(after._prisma_migrations.rows.some(row => row.migration_name === transferMigration && row.finished_at && !row.rolled_back_at), "Миграция заявок не применена.");
  assert(after._prisma_migrations.rows.every(row => beforeNames.has(row.migration_name) || [migration, transferMigration].includes(row.migration_name)), "Ожидают применения другие миграции.");
}

try {
  await integrity(source);
  await source.execute({ sql: "VACUUM INTO ?", args: [backupPath] });
  const backup = createClient({ url: fileUrl(backupPath) });
  let before;
  try {
    await integrity(backup);
    before = await snapshot(backup, true);
    await backup.execute({ sql: "VACUUM INTO ?", args: [trialPath] });
  } finally { backup.close(); }

  const trialUrl = fileUrl(trialPath);
  const trial = createClient({ url: trialUrl });
  let result;
  try {
    migrate(trialUrl);
    await integrity(trial);
    const migrated = await snapshot(trial, true);
    verifyPreservation(before, migrated);
    result = await seed(trialUrl);
    await integrity(trial);
    const seeded = await snapshot(trial, true);
    verifyPreservation(before, seeded, result.inserted);
    assert(!(await seed(trialUrl)).inserted, "Повторное наполнение создало новые данные.");
    assert(JSON.stringify(await snapshot(trial, true)) === JSON.stringify(seeded), "Повторное наполнение изменило данные.");
  } finally { trial.close(); }

  if (apply) {
    assert(JSON.stringify(await snapshot(source, true)) === JSON.stringify(before), "Исходная БД изменилась после резервного копирования.");
    migrate(sourceUrl);
    assert.equal((await seed(sourceUrl)).inserted, result.inserted);
    await integrity(source);
    verifyPreservation(before, await snapshot(source, true), result.inserted);
  }
  console.info(JSON.stringify({ applied: apply, migration, backupPath, trialPath, ...result, ...(apply ? { credentialsPath } : {}) }));
} finally { source.close(); }
