const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const ALIASES = new Map([
  ...DAYS.map((day, index) => [day, index]),
  ...['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日', '星期天'].map((name, index) => [name, Math.min(index, 6)]),
  ...['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((name, index) => [name, index]),
  ...['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((name, index) => [name, index]),
  ['1', 0], ['2', 1], ['3', 2], ['4', 3], ['5', 4], ['6', 5], ['7', 6],
]);

function splitLine(line) {
  const cells = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) { if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t' || ch === '，') { cells.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}
export function parseClock(value) {
  const match = /^(\d{1,2})[:：](\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= 1440 ? minutes : null;
}
export function parseDay(value) {
  const index = ALIASES.get(String(value || '').trim().toLowerCase());
  return index === undefined ? null : DAYS[index];
}

// Rows: title, day, start, end [, description]. A header row is skipped.
// Returns { events, errors } so the UI can report which lines were rejected.
export function parseScheduleCsv(text) {
  const events = []; const errors = [];
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const [title, day, start, end, description = ''] = splitLine(line);
    if (index === 0 && parseDay(day) === null && parseClock(start) === null) return;
    const dayName = parseDay(day); const from = parseClock(start); const to = parseClock(end);
    if (!title || !dayName || from === null || to === null || from >= to) { errors.push({ line: index + 1, reason: !title ? '缺少标题' : !dayName ? '星期无法识别' : '时间无效' }); return; }
    events.push({ title: title.slice(0, 200), day: dayName, start_minute: from, end_minute: to, description: description.slice(0, 2000) });
  });
  return { events, errors };
}

// Payload for copying every event of one week into another (no recurrence, no locks).
export function weekCopyPayloads(events, fromWeek, toWeek) {
  return events
    .filter((event) => event.week_key === fromWeek && !event.repeat_rule && !event.subscription_id && !event.deadline_kind && !event.all_day)
    .map((event) => ({ title: event.title, day: event.day, start_minute: event.start_minute, end_minute: event.end_minute, category: event.category || 'other', description: event.description || '', layer: event.layer || 'actual', task_id: event.task_id ?? null, week_key: toWeek, repeat: false, locked: false, source: 'calendar' }));
}
