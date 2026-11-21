import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { decodeRubles, encodeRubles, formatRubles, parseRubles } from '../src/lib/dormitory-money.ts';
import { integrity, snapshot } from './database-snapshot.mjs';
import { dormMoneyIndexes, verifyDormRubles } from './dormitory-money-migration.mjs';

assert.equal(encodeRubles(parseRubles('0.10') + parseRubles('0.20')), '0.30');
assert.equal(encodeRubles(parseRubles('1500.50') - parseRubles('500.25')), '1000.25');
for (const [input, stored, displayed] of [
  ['1500', '1500.00', '1 500 ₽'], ['1500,50', '1500.50', '1 500,50 ₽'],
  ['1500.50', '1500.50', '1 500,50 ₽'], ['0,75', '0.75', '0,75 ₽'],
  ['-0', '0.00', '0 ₽'], ['-0,25', '-0.25', '−0,25 ₽'], ['21474836.47', '21474836.47', '21 474 836,47 ₽'],
]) {
  assert.equal(encodeRubles(parseRubles(input)), stored);
  assert.equal(formatRubles(stored).replaceAll('\u00a0', ' '), displayed);
  assert.equal(formatRubles(decodeRubles(stored)), formatRubles(stored));
}
for (const invalid of ['', '1,234', '1.234', '12a', '1e2', 'NaN', '1,2.3', '21474836.48', '-21474836.48']) {
  assert.throws(() => parseRubles(invalid));
}

const db = createClient({ url: ':memory:' });
try {
  const previous = readFileSync('prisma/migrations/20261122120000_dormitory/migration.sql', 'utf8');
  const migration = readFileSync('prisma/migrations/20261122130000_dormitory_rubles/migration.sql', 'utf8');
  for (const name of ['User', 'DormPlacement', 'DormAudit']) await db.execute(`CREATE TABLE "${name}" (id TEXT PRIMARY KEY)`);
  await db.executeMultiple(previous.match(/CREATE TABLE "(?:DormCharge|DormLedgerEntry)" \([\s\S]*?\);/g).join('\n'));
  await db.executeMultiple(previous.match(/CREATE (?:UNIQUE )?INDEX "(?:DormCharge|DormLedgerEntry)_[^;]+;/g).join('\n'));
  await db.execute("INSERT INTO User VALUES ('student')");
  await db.execute("INSERT INTO DormPlacement VALUES ('placement')");
  for (const [id, amount] of [['a', 150050], ['b', 100], ['c', 1], ['d', 0], ['e', 2147483647]]) {
    await db.execute({
      sql: "INSERT INTO DormCharge (id,studentId,placementId,basis,periodFrom,periodTo,dueOn,amountMinor) VALUES (?,'student','placement',?,'2026-01-01','2026-01-02','2026-01-02',?)",
      args: [id, id, amount],
    });
  }
  for (const [id, chargeId, kind, amount] of [['p1','a','PAYMENT',50025], ['p2','b','PAYMENT',125], ['p3','a','ADJUSTMENT',-100], ['p4','d','ADJUSTMENT',-2147483648]]) {
    await db.execute({ sql: 'INSERT INTO DormAudit VALUES (?)', args: [id] });
    await db.execute({
      sql: 'INSERT INTO DormLedgerEntry (id,chargeId,auditId,kind,amountMinor,reference) VALUES (?,?,?,?,?,?)',
      args: [id, chargeId, id, kind, amount, id],
    });
  }
  const before = await snapshot(db), indexes = await dormMoneyIndexes(db);
  await db.executeMultiple(migration);
  const values = await db.execute("SELECT amountRub, typeof(amountRub) AS storage FROM DormCharge ORDER BY id");
  assert.deepEqual(values.rows.map(row => row.amountRub), ['1500.50','1.00','0.01','0.00','21474836.47']);
  assert(values.rows.every(row => row.storage === 'text'));
  const ledger = await db.execute("SELECT amountRub FROM DormLedgerEntry ORDER BY id");
  assert.deepEqual(ledger.rows.map(row => row.amountRub), ['500.25','1.25','-1.00','-21474836.48']);
  await assert.rejects(() => db.execute("UPDATE DormCharge SET amountRub = '1.001' WHERE id = 'a'"));
  assert.deepEqual(verifyDormRubles(before, await snapshot(db)), { DormCharge: 5, DormLedgerEntry: 4 });
  assert.deepEqual(await dormMoneyIndexes(db), indexes);
  await integrity(db);
  console.log('PASS: exact arithmetic, ruble input/display, historical conversion, balances, references and indexes');
} finally { db.close(); }
