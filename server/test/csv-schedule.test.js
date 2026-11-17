import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleCsv, parseClock, weekCopyPayloads } from '../../src/csv-schedule.mjs';

test('parses a schedule CSV, skipping the header and reporting bad rows', () => {
  const { events, errors } = parseScheduleCsv('title,day,start,end\n高数,周一,08:00,09:40\n"物理, 实验",Tue,13:30,15:10,理科楼\nbad,周九,08:00,09:00\n早,周三,10:00,09:00\n');
  assert.equal(events.length, 2);
  assert.equal(events[1].title, '物理, 实验');
  assert.equal(events[1].day, '周二');
  assert.equal(events[1].description, '理科楼');
  assert.deepEqual(errors.map((e) => e.line), [4, 5]);
});

test('clock parsing is strict', () => {
  assert.equal(parseClock('9:05'), 545);
  assert.equal(parseClock('09:75'), null);
  assert.equal(parseClock('abc'), null);
});

test('week copy keeps only plain one-off events of the source week', () => {
  const rows = [
    { id: 1, title: 'a', day: '周一', start_minute: 60, end_minute: 90, week_key: '2026-W10', layer: 'actual' },
    { id: 2, title: 'rec', day: '周一', start_minute: 60, end_minute: 90, week_key: '2026-W10', repeat_rule: 'weekly' },
    { id: 3, title: 'other', day: '周一', start_minute: 60, end_minute: 90, week_key: '2026-W11' },
    { id: 4, title: 'sub', day: '周一', start_minute: 60, end_minute: 90, week_key: '2026-W10', subscription_id: 3 },
  ];
  const out = weekCopyPayloads(rows, '2026-W10', '2026-W11');
  assert.equal(out.length, 1);
  assert.equal(out[0].week_key, '2026-W11');
  assert.equal(out[0].repeat, false);
});
