import assert from 'node:assert/strict';
import { bellGrids, identifyPair, pairTimeLabel } from '../src/lib/schedule-bells.ts';

const shared = [['08:30','10:00'], ['10:10','11:40'], null, ['14:05','15:35'], ['15:55','17:25'], ['17:35','19:05'], ['19:15','20:45']];
for (const grid of bellGrids) {
  assert.equal(grid.pairs.length, 7);
  for (let index = 0; index < 7; index++) {
    const expected = index === 2 ? grid.id === 'A' ? ['12:25','13:55'] : ['11:50','13:20'] : shared[index];
    const pair = grid.pairs[index];
    assert.equal(pair.number,index+1);
    assert.deepEqual([pair.start,pair.end],expected);
    assert.equal(identifyPair(...expected).number,index+1);
    assert.equal(pairTimeLabel(...expected), `${index+1}-я пара · ${expected.join('–')}`);
  }
}
assert.equal(identifyPair('12:25','13:55').gridId,'A');
assert.equal(identifyPair('11:50','13:20').gridId,'B');
for (const time of [['09:00','10:30'],['08:30','10:01'],['11:50','13:55'],['8:30','10:00'],['','']]) {
  assert.equal(identifyPair(...time),null);
  assert.equal(pairTimeLabel(...time),time.join('–'));
}
assert.deepEqual(bellGrids.map(g=>g.lunch),[{start:'11:40',end:'12:25'},{start:'13:20',end:'14:05'}]);
for(const grid of bellGrids) assert.deepEqual(grid.break,{start:'15:35',end:'15:55'});
console.info('PASS: all 14 bell presets, lunches, breaks, exact matching and nonstandard times');
