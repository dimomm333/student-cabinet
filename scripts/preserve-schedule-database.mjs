import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { getDatabaseUrl } from "../src/lib/database-url.ts";

const folder = resolve(".local/schedule-upgrade");
mkdirSync(folder, { recursive: true });
const db = createClient({ url: getDatabaseUrl() });
const baselinePath = resolve(folder, "baseline.json");
const stringify = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
try {
  if (process.argv.includes("--before")) {
    assert(!existsSync(baselinePath), "Baseline already exists; do not overwrite");
    const names = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name")).rows.map(row => row.name);
    const data = {};
    for (const name of names) data[name] = (await db.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows;
    writeFileSync(baselinePath, stringify(data), { mode: 0o600 });
    await db.execute({ sql: "VACUUM INTO ?", args: [resolve(folder, "before.db")] });
    console.info("Created consistent SQLite backup and baseline for every application table.");
  } else {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    for (const [table, rows] of Object.entries(baseline)) {
      const after = (await db.execute(`SELECT * FROM "${table}" ORDER BY 1`)).rows.map(row => Object.fromEntries(Object.keys(rows[0] ?? {}).map(key => [key, row[key]])));
      assert.equal(stringify(after), stringify(rows), `Existing data changed: ${table}`);
    }
    assert.equal((await db.execute("PRAGMA integrity_check")).rows[0].integrity_check, "ok");
    assert.equal((await db.execute("PRAGMA foreign_key_check")).rows.length, 0);
    const report = { preserved: true, tables: Object.keys(baseline).length, integrity: "ok", foreignKeys: "ok", baselineHash: createHash("sha256").update(stringify(baseline)).digest("hex") };
    writeFileSync(resolve(folder, "verification.json"), JSON.stringify(report, null, 2));
    console.info(JSON.stringify(report));
  }
} finally { db.close(); }
