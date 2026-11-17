import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, eventSnapshot, diffPatch } from '../../src/history.mjs';

test('undo/redo walk the stack and redo is cleared by a new push', async () => {
  const history = createHistory();
  const log = [];
  const cmd = (name) => ({ label: name, undo: async () => log.push(`u${name}`), redo: async () => log.push(`r${name}`) });
  history.push(cmd('a')); history.push(cmd('b'));
  await history.undo(); await history.undo();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);
  await history.redo();
  history.push(cmd('c'));
  assert.equal(history.canRedo(), false);
  assert.deepEqual(log, ['ub', 'ua', 'ra']);
});

test('a failing undo keeps the command so it can be retried', async () => {
  const history = createHistory();
  let fail = true;
  history.push({ label: 'x', undo: async () => { if (fail) throw new Error('net'); }, redo: async () => {} });
  await assert.rejects(history.undo());
  assert.equal(history.canUndo(), true);
  fail = false;
  assert.equal((await history.undo()).label, 'x');
});

test('history is bounded', async () => {
  const history = createHistory(2);
  for (const n of [1, 2, 3]) history.push({ label: String(n), undo: async () => {}, redo: async () => {} });
  assert.equal((await history.undo()).label, '3');
  assert.equal((await history.undo()).label, '2');
  assert.equal(await history.undo(), null);
});

test('snapshots and patches', () => {
  const snap = eventSnapshot({ id: 5, title: 't', day: '周一', start_minute: 60, end_minute: 90, category: 'work', repeat_rule: 'weekly', user_id: 9 });
  assert.equal(snap.id, undefined);
  assert.equal(snap.repeat, true);
  assert.deepEqual(diffPatch({ a: 1, b: 2 }, { a: 1, b: 3 }), { b: 3 });
});

test('a command whose target vanished (404) is dropped so older steps stay reachable', async () => {
  const history = createHistory();
  const ok = []; 
  history.push({ label: 'old', undo: async () => ok.push('old'), redo: async () => {} });
  history.push({ label: 'gone', undo: async () => { throw Object.assign(new Error('missing'), { status: 404 }); }, redo: async () => {} });
  await assert.rejects(history.undo());
  assert.equal((await history.undo()).label, 'old');
  assert.deepEqual(ok, ['old']);
});
