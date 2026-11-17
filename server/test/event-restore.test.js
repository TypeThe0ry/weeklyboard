import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

test('restore puts back all-day, imported and deadline events with their own fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-restore-'));
  const child = spawn(process.execPath, [resolve('server/index.js')], { env: { ...process.env, DB_FILE: join(directory, 'test.db'), PORT: '0', JWT_SECRET: randomBytes(32).toString('hex'), DEBUG_MODE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = '';
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error(output || 'startup timeout')), 10000);
      child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/weeklyboard api listening (\d+)/); if (match) { clearTimeout(timer); resolvePort(Number(match[1])); } });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const api = async (token, path, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    const register = async (email) => (await api('', '/auth/register', 'POST', { email, password: randomBytes(18).toString('hex') })).body.token;
    const owner = await register('owner@example.test');
    const other = await register('other@example.test');
    const otherProject = (await api(other, '/projects', 'POST', { title: '别人的项目' })).body;
    const otherTask = (await api(other, `/projects/${otherProject.id}/tasks`, 'POST', { title: '别人的任务', estimate_minutes: 30 })).body;

    const deadline = { id: 999, user_id: 12345, title: '线代作业', day: '周五', start_minute: 0, end_minute: 1440, all_day: 1, layer: 'once', category: 'study', week_key: '2026-W47', source: 'ics-import', external_key: 'uid-1', external_date: '2026-11-20', deadline_kind: 'hw', deadline_kind_override: 'exam', due_minute: 1380, event_url: 'https://example.test/hw', course: '线性代数', deadline_completed: 1, excluded_weeks: '["2026-W48","bad"]', task_id: otherTask.id, description: '第 3 章' };
    const restored = await api(owner, '/calendar/events/restore', 'POST', deadline);
    assert.equal(restored.status, 201, JSON.stringify(restored.body));
    for (const key of ['title', 'day', 'all_day', 'layer', 'week_key', 'source', 'external_key', 'external_date', 'deadline_kind', 'deadline_kind_override', 'due_minute', 'event_url', 'course', 'deadline_completed', 'description']) assert.equal(restored.body[key], deadline[key], key);
    assert.notEqual(restored.body.id, 999);
    assert.equal(restored.body.task_id, null, 'a task from another account is not linked');
    assert.equal(restored.body.excluded_weeks, '["2026-W48"]');
    assert.equal((await api(owner, '/calendar/deadlines')).body.length, 1);
    assert.equal((await api(other, '/calendar')).body.length, 0);

    const manual = await api(owner, '/calendar/events/restore', 'POST', { title: '手动全天', day: '周一', start_minute: 0, end_minute: 1440, all_day: 1, source: 'calendar', external_key: 'should-drop', deadline_kind: 'nope' });
    assert.equal(manual.body.external_key, null);
    assert.equal(manual.body.deadline_kind, null);

    assert.equal((await api(owner, '/calendar/events/restore', 'POST', { ...deadline, subscription_id: 3 })).status, 409);
    assert.equal((await api(owner, '/calendar/events/restore', 'POST', { ...deadline, day: 'Friday' })).status, 400);
    assert.equal((await api(owner, '/calendar/events/restore', 'POST', { ...deadline, start_minute: 900, end_minute: 800 })).status, 400);
    assert.equal((await api('', '/calendar/events/restore', 'POST', deadline)).status, 401);
  } finally {
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
