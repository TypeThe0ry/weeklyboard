import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { previousWeekKey, reviewNotes } from '../../src/review-notes.mjs';

test('previousWeekKey steps back one ISO week, including across years', () => {
  assert.equal(previousWeekKey('2026-W47'), '2026-W46');
  assert.equal(previousWeekKey('2026-W01'), '2025-W52');
  assert.equal(previousWeekKey('2027-W01'), '2026-W53');
  assert.equal(previousWeekKey('nope'), null);
});

test('reviewNotes turns last week, overloaded days and mood trend into short notes', () => {
  assert.deepEqual(reviewNotes(null), []);
  assert.deepEqual(reviewNotes({ last_week: { planned_minutes: 0, actual_minutes: 0, completion_rate: 0, unfinished: [] } }), []);
  const notes = reviewNotes({
    this_week: { daily_load: { 周一: 120, 周三: 570 } },
    last_week: { completion_rate: 0.4, planned_minutes: 600, actual_minutes: 240, unfinished: [{ title: '论文' }, { title: '习题' }, { title: '实验' }, { title: '第四项' }] },
    mood_trend: { recorded: 10, low_days: 5 },
  });
  assert.equal(notes.length, 4);
  assert.match(notes[0], /上周完成率 40%（计划 10 小时，实际 4 小时）/);
  assert.match(notes[0], /少排/);
  assert.equal(notes[1], '上周未完成：论文、习题、实验 等 4 项');
  assert.match(notes[2], /周三 已安排 9\.5 小时/);
  assert.match(notes[3], /近 28 天有 5 天/);
  const good = reviewNotes({ last_week: { completion_rate: 0.9, planned_minutes: 300, actual_minutes: 270, unfinished: [] }, mood_trend: { recorded: 3, low_days: 1 } });
  assert.equal(good.length, 1);
  assert.doesNotMatch(good[0], /少排/);
});

test('review API is per week, and the planner receives last week plus the mood trend', async () => {
  let upstreamInput = null;
  const upstream = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      upstreamInput = JSON.parse(JSON.parse(raw).messages[1].content);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'ok', blocks: [{ title: '写作', day: '周二', start_minute: 540, end_minute: 600 }], warnings: [] }) } }] }));
    });
  });
  await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-review-'));
  const child = spawn(process.execPath, [resolve('server/index.js')], {
    env: { ...process.env, DB_FILE: join(directory, 'test.db'), PORT: '0', JWT_SECRET: randomBytes(32).toString('hex'), DEBUG_MODE: 'false', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${upstream.address().port}/chat/completions` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error(output || 'startup timeout')), 10000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/weeklyboard api listening (\d+)/);
        if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
      });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
    });
    let token = '';
    const api = async (path, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    token = (await api('/auth/register', 'POST', { email: 'review@example.test', password: randomBytes(18).toString('hex') })).body.token;
    const project = (await api('/projects', 'POST', { title: '复盘项目' })).body;
    const writing = (await api(`/projects/${project.id}/tasks`, 'POST', { title: '写作', estimate_minutes: 120 })).body;
    const reading = (await api(`/projects/${project.id}/tasks`, 'POST', { title: '阅读', estimate_minutes: 60 })).body;
    const event = (fields) => api('/calendar/events', 'POST', fields).then((result) => assert.equal(result.status, 201, JSON.stringify(result.body)));
    // Last week (W46): 写作 planned 120, done 60; 阅读 planned 60, done 60.
    await event({ title: '写作', task_id: writing.id, day: '周一', start_minute: 540, end_minute: 660, layer: 'flex', week_key: '2026-W46' });
    await event({ title: '写作', task_id: writing.id, day: '周一', start_minute: 540, end_minute: 600, layer: 'actual', week_key: '2026-W46' });
    await event({ title: '阅读', task_id: reading.id, day: '周二', start_minute: 600, end_minute: 660, layer: 'flex', week_key: '2026-W46' });
    await event({ title: '阅读', task_id: reading.id, day: '周二', start_minute: 600, end_minute: 660, layer: 'actual', week_key: '2026-W46' });
    // This week (W47): one planned block, nothing done, plus a weekly class.
    await event({ title: '写作', task_id: writing.id, day: '周三', start_minute: 540, end_minute: 600, layer: 'flex', week_key: '2026-W47' });
    await event({ title: '高数课', day: '周三', start_minute: 480, end_minute: 540, layer: 'fixed', week_key: null, repeat: true });
    for (const [date, mood] of [['2026-11-10', 'tired'], ['2026-11-11', 'sleepy'], ['2026-11-12', 'happy'], ['2026-09-01', 'sad']]) {
      assert.equal((await api(`/calendar/moods/${date}`, 'PUT', { mood })).status, 200);
    }

    assert.equal((await api('/review?week_key=bad')).status, 400);
    assert.equal((await api('/review?week_key=2026-W47&today=2026-13-40')).status, 400);
    const legacy = (await api('/review')).body;
    assert.equal(legacy.events, 6);

    const last = (await api('/review?week_key=2026-W46')).body;
    assert.equal(last.week_key, '2026-W46');
    assert.equal(last.planned_minutes, 180);
    assert.equal(last.actual_minutes, 120);
    assert.equal(last.completion_rate, 0.67);
    assert.equal(last.tasks.total, 2);
    assert.equal(last.tasks.done, 1);
    assert.deepEqual(last.unfinished.map((row) => row.title), ['写作']);
    assert.equal(last.daily_load.周一, 120);
    assert.equal(last.daily_load.周三, 60, 'weekly fixed events count toward the day load');
    assert.equal(last.daily_actual.周二, 60);
    assert.equal(last.mood_trend, null);

    const current = (await api('/review?week_key=2026-W47&today=2026-11-17')).body;
    assert.equal(current.planned_minutes, 180, 'task estimates count as plan, as in the pomodoro table');
    assert.equal(current.actual_minutes, 0);
    assert.equal(current.completion_rate, 0);
    assert.equal(current.daily_load.周三, 120);
    assert.equal(current.previous.week_key, '2026-W46');
    assert.equal(current.previous.completion_rate, 0.67);
    assert.equal(current.mood_trend.recorded, 3, 'only the last 28 days count');
    assert.equal(current.mood_trend.low_days, 2);
    assert.ok(current.notes.some((note) => /上周完成率 67%/.test(note)));
    assert.ok(current.notes.includes('上周未完成：写作'));

    const preview = (await api('/plan/preview', 'POST', { tasks: [writing], week_key: '2026-W47', today: '2026-11-17', review: { completion_rate: 1 } })).body;
    assert.equal(preview.source, 'deepseek');
    assert.equal(upstreamInput.review.last_week.completion_rate, 0.67, 'server-built review replaces the client value');
    assert.equal(upstreamInput.review.last_week.unfinished[0].title, '写作');
    assert.equal(upstreamInput.review.this_week.daily_load.周三, 120);
    assert.equal(upstreamInput.review.mood_trend.low_days, 2);
    assert.ok(preview.review_notes.includes('上周未完成：写作'));

    const noWeek = (await api('/plan/preview', 'POST', { tasks: [writing] })).body;
    assert.deepEqual(noWeek.review_notes, []);
  } finally {
    child.kill();
    await exited;
    upstream.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the local planner also reports review notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-review-local-'));
  const env = { ...process.env, DB_FILE: join(directory, 'test.db'), PORT: '0', JWT_SECRET: randomBytes(32).toString('hex'), DEBUG_MODE: 'false' };
  delete env.DEEPSEEK_API_KEY;
  const child = spawn(process.execPath, [resolve('server/index.js')], { env: { ...env, DEEPSEEK_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = '';
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error(output || 'startup timeout')), 10000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/weeklyboard api listening (\d+)/);
        if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
      });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const post = async (path, body, token) => (await fetch(`http://127.0.0.1:${port}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
    const { token } = await post('/auth/register', { email: 'local@example.test', password: randomBytes(18).toString('hex') });
    await post('/calendar/events', { title: '背单词', day: '周四', start_minute: 540, end_minute: 660, layer: 'flex', week_key: '2026-W46' }, token);
    const preview = await post('/plan/preview', { tasks: [{ id: 1, title: '背单词', estimate_minutes: 30 }], week_key: '2026-W47' }, token);
    assert.equal(preview.source, 'local');
    assert.ok(preview.review_notes.some((note) => /上周完成率 0%/.test(note)));
    assert.ok(preview.review_notes.includes('上周未完成：背单词'));
  } finally {
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
