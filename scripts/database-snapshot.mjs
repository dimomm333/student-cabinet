import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const canonical = value => {
  if (typeof value === 'bigint') return String(value);
  if (value instanceof ArrayBuffer) return { binary: Buffer.from(value).toString('base64') };
  if (ArrayBuffer.isView(value)) return { binary: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  return value;
};
const stringify = value => JSON.stringify(value, (_, value) => canonical(value));
export async function snapshot(db, includeMigrations = false) {
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows;
  const result = {};
  for (const { name } of tables) {
    if (!includeMigrations && name === '_prisma_migrations') continue;
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    const pk = (await db.execute(`PRAGMA table_info(${quoted})`)).rows.filter(column => column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name);
    const rows = (await db.execute(`SELECT * FROM ${quoted}`)).rows.map(row => JSON.parse(stringify(row))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    result[name] = { pk, rows };
  }
  return result;
}
export function preserved(before, after) {
  for (const [table, {pk, rows}] of Object.entries(before)) {
    assert(after[table], `Table lost: ${table}`);
    for (const row of rows) {
      const actual = after[table].rows.find(candidate => pk.every(key=>candidate[key] === row[key]));
      for (const [field, value] of Object.entries(row)) assert.deepEqual(actual?.[field], value, `Existing field changed: ${table}.${field}`);
    }
    if (!['Discipline'].includes(table)) assert.equal(after[table].rows.length, rows.length, `Existing row count changed: ${table}`);
  }
}
export async function integrity(db) {
  assert.equal((await db.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok');
  assert.equal((await db.execute('PRAGMA foreign_key_check')).rows.length, 0);
}
export async function fingerprint(db) { return createHash('sha256').update(JSON.stringify(await snapshot(db, true))).digest('hex'); }
