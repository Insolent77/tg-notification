import test from 'node:test';
import assert from 'node:assert/strict';
import {localDate,localToIso,shiftLocalDate} from '../src/dates.js';

test('converts Moscow local reminder to UTC',()=>{
  assert.equal(localToIso('2026-11-23','18:00','Europe/Moscow'),'2026-11-23T15:00:00.000Z');
});
test('formats local calendar date',()=>{
  assert.equal(localDate(new Date('2026-11-22T23:30:00.000Z'),'Europe/Moscow'),'2026-11-23');
});
test('shifts local date over month boundary',()=>{
  assert.equal(shiftLocalDate('2026-11-30',1),'2026-12-01');
});
test('rejects nonexistent calendar dates',()=>{
  assert.throws(()=>localToIso('2026-02-30','18:00','Europe/Moscow'));
});
test('rejects invalid clock times',()=>{
  assert.throws(()=>localToIso('2026-11-23','27:00','Europe/Moscow'));
});
test('rejects spring-forward missing clock hour',()=>{
  assert.throws(()=>localToIso('2026-03-29','02:30','Europe/Amsterdam'));
});
