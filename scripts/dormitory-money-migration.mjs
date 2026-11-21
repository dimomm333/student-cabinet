import assert from 'node:assert/strict';
import { preserved } from './database-snapshot.mjs';

function exactHundredths(text) {
  assert.match(text, /^-?(?:0|[1-9]\d*)\.\d{2}$/);
  return BigInt(text.replace('.', ''));
}

export function verifyDormRubles(before, after) {
  const count = {}, converted = { ...before };
  let checked = false;
  for (const name of ['DormCharge', 'DormLedgerEntry']) {
    const previous = before[name]?.rows;
    if (!previous) continue;
    const byId = new Map(after[name].rows.map(row => [row.id, row]));
    assert.equal(byId.size, previous.length);
    converted[name] = { ...before[name], rows: previous.map(row => {
      if (!Object.hasOwn(row, 'amountMinor')) return row;
      const { amountMinor, ...fields } = row;
      const migrated = byId.get(row.id)?.amountRub;
      assert.equal(exactHundredths(migrated), BigInt(amountMinor));
      checked = true;
      return { ...fields, amountRub: migrated };
    }) };
    count[name] = previous.length;
  }
  const balances = (state, old) => {
    const amount = row => old && Object.hasOwn(row, 'amountMinor') ? BigInt(row.amountMinor) : exactHundredths(row.amountRub);
    const result = new Map(state.DormCharge.rows.map(row => [row.id, amount(row)]));
    for (const row of state.DormLedgerEntry.rows) {
      const operation = amount(row);
      result.set(row.chargeId, result.get(row.chargeId) + (row.kind === 'PAYMENT' ? -operation : operation));
    }
    return result;
  };
  if (checked) {
    const oldBalances = balances(before, true), newBalances = balances(after, false);
    assert.deepEqual(newBalances, oldBalances, 'A charge balance changed');
    const obligations = values => [...values].reduce((total, amount) => total + (amount > 0n ? amount : 0n), 0n);
    assert.equal(obligations(newBalances.values()), obligations(oldBalances.values()), 'Total outstanding obligations changed');
  }
  preserved(converted, after);
  return count;
}

export const dormMoneyIndexes = db => db.execute(
  "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('DormCharge', 'DormLedgerEntry') AND sql IS NOT NULL ORDER BY name"
).then(result => result.rows);
