import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalId, optimisticDelete } from '../../src/optimistic.mjs';
import { occursInWeek } from '../../src/calendar-occurrences.mjs';

test('optimistic delete mirrors the server: recurring events skip the week, others vanish', () => {
  const weekly = { id: 1, week_key: null, repeat_rule: null, layer: 'fixed', excluded_weeks: '["2026-W46"]' };
  const next = optimisticDelete(weekly, 'week', '2026-W47');
  assert.deepEqual(JSON.parse(next.excluded_weeks), ['2026-W46', '2026-W47']);
  assert.equal(occursInWeek(next, '2026-W47'), false);
  assert.equal(occursInWeek(next, '2026-W48'), true);
  assert.equal(optimisticDelete(weekly, 'all', '2026-W47'), null);
  assert.equal(optimisticDelete({ id: 2, week_key: '2026-W47', repeat_rule: null }, 'week', '2026-W47'), null);
  assert.ok(optimisticDelete({ id: 3, week_key: '2026-W40', repeat_rule: 'weekly', layer: 'flex' }, 'week', '2026-W47'));
  assert.deepEqual(JSON.parse(optimisticDelete({ id: 4, week_key: null, excluded_weeks: '["2026-W47"]' }, 'week', '2026-W47').excluded_weeks), ['2026-W47'], 'no duplicates');
});

test('temporary rows are recognised by their id', () => {
  assert.equal(isLocalId('local-abc'), true);
  assert.equal(isLocalId(12), false);
  assert.equal(isLocalId(null), false);
});
