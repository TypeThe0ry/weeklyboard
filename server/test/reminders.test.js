import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueReminders, reminderText } from '../../src/reminders.mjs';

const base = { day: '周二', all_day: 0, layer: 'flex', week_key: '2026-W47' };
const events = [
  { ...base, id: 1, title: '写作', start_minute: 600, end_minute: 660 },
  { ...base, id: 2, title: '已发生', start_minute: 600, end_minute: 660, layer: 'actual' },
  { ...base, id: 3, title: '别的周', start_minute: 600, end_minute: 660, week_key: '2026-W46' },
  { ...base, id: 4, title: '每周课', start_minute: 605, end_minute: 700, layer: 'fixed', week_key: null, repeat_rule: 'weekly' },
  { ...base, id: 5, title: '全天', start_minute: 600, end_minute: 660, all_day: 1 },
  { ...base, id: 6, title: '别的天', day: '周三', start_minute: 600, end_minute: 660 },
  { ...base, id: 7, title: '太远', start_minute: 640, end_minute: 700 },
  { ...base, id: 8, title: '本周跳过', start_minute: 600, end_minute: 660, layer: 'fixed', week_key: null, repeat_rule: 'weekly', excluded_weeks: '["2026-W47"]' },
];

test('reminders cover planned events starting within the lead time, once each', () => {
  const now = { weekKey: '2026-W47', day: '周二', minute: 595 };
  const due = dueReminders(events, now);
  assert.deepEqual(due.map((item) => item.event.id), [1, 4]);
  assert.deepEqual(due.map((item) => item.in_minutes), [5, 10]);
  const sent = new Set(due.map((item) => item.key));
  assert.deepEqual(dueReminders(events, { ...now, minute: 598, sent }), []);
  assert.deepEqual(dueReminders(events, { ...now, minute: 601 }).map((item) => item.event.id), [4], 'started events are not announced late');
  assert.deepEqual(dueReminders(events, { ...now, minute: 600 }).map((item) => item.event.id), [1, 4]);
});

test('reminder text names the event and its time', () => {
  assert.deepEqual(reminderText({ event: events[0], in_minutes: 5 }), { title: '5 分钟后：写作', body: '周二 10:00 – 11:00' });
  assert.equal(reminderText({ event: events[0], in_minutes: 0 }).title, '现在开始：写作');
});
