import { DAYS, mergeRanges, pomodoroWeek } from './pomodoro.js';
import { moodTrend, validMoodDate } from '../src/mood-data.mjs';
import { validWeekKey } from '../src/calendar-occurrences.mjs';
import { previousWeekKey, reviewNotes } from '../src/review-notes.mjs';

const LOW_MOODS = new Set(['tired', 'sad', 'angry', 'sick', 'sleepy']);
const minutes = (events) => mergeRanges(events).reduce((sum, [start, end]) => sum + end - start, 0);
const perDay = (events) => Object.fromEntries(DAYS.map((day) => [day, minutes(events.filter((event) => event.day === day))]));

// Plan and completion numbers come from the pomodoro summary so the review matches that table.
// The day load also counts fixed (class/meeting) time, which the pomodoro table leaves out.
export function weekReview(db, userId, week) {
  const { rows, total, events } = pomodoroWeek(db, userId, week);
  const timed = events.filter((event) => !event.all_day && !event.deadline_kind);
  const scheduled = rows.filter((row) => row.plan_units > 0);
  const done = scheduled.filter((row) => row.complete).length;
  const rate = total.percent / 100;
  return {
    week_key: week,
    completion_rate: rate,
    planned_minutes: total.plan_units * 30,
    actual_minutes: total.actual_minutes,
    daily_load: perDay(timed.filter((event) => event.layer !== 'actual')),
    daily_actual: perDay(timed.filter((event) => event.layer === 'actual')),
    events: timed.length,
    tasks: { total: scheduled.length, done, completion_rate: rate },
    unfinished: scheduled.filter((row) => !row.complete && row.daily.some((day) => day.planned_minutes > 0))
      .map((row) => ({ title: row.title, plan_units: row.plan_units, actual_units: row.actual_units })).slice(0, 8),
  };
}

export function moodContext(db, userId, today) {
  if (!validMoodDate(today)) return null;
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 27 * 86400000).toISOString().slice(0, 10);
  const records = db.prepare("SELECT payload_json FROM workspace_scratch WHERE user_id=? AND kind='mood' AND week_key='calendar' AND entity_key BETWEEN ? AND ?").all(userId, from, today)
    .map((row) => { try { return JSON.parse(row.payload_json); } catch { return null; } }).filter(Boolean);
  const trend = moodTrend(records, today);
  return {
    recorded: trend.recorded,
    low_days: trend.days.filter((day) => day.mood && LOW_MOODS.has(day.mood.id)).length,
    top: trend.top.map(({ id, label, count }) => ({ id, label, count })),
  };
}

// What the planner is told: this week's existing load, how last week went, and the recent mood trend.
export function plannerContext(db, userId, week, today) {
  if (!validWeekKey(week)) return null;
  const current = weekReview(db, userId, week);
  const busy = pomodoroWeek(db, userId, week).events.filter((event) => !event.all_day && !event.deadline_kind && event.layer !== 'actual')
    .map(({ day, start_minute, end_minute }) => ({ day, start_minute, end_minute }));
  const { week_key, completion_rate, planned_minutes, actual_minutes, daily_load, daily_actual, unfinished } = weekReview(db, userId, previousWeekKey(week));
  return {
    this_week: { daily_load: current.daily_load, planned_minutes: current.planned_minutes, busy },
    last_week: { week_key, completion_rate, planned_minutes, actual_minutes, daily_load, daily_actual, unfinished },
    mood_trend: moodContext(db, userId, today),
  };
}

export function weekReviewResponse(db, userId, week, today) {
  const current = weekReview(db, userId, week);
  const context = plannerContext(db, userId, week, today);
  return { ...current, previous: weekReview(db, userId, previousWeekKey(week)), mood_trend: context.mood_trend, notes: reviewNotes(context) };
}

export const OVERLOAD_MINUTES = 480;
// How the local scheduler uses the review: never overlap what is already on this week's board,
// and leave days that are already full until last.
export function localPlanHints(context) {
  if (!context) return { fixed: [], lastDays: [], assumptions: [] };
  const fixed = context.this_week.busy;
  const lastDays = DAYS.filter((day) => context.this_week.daily_load[day] >= OVERLOAD_MINUTES);
  return {
    fixed, lastDays,
    assumptions: [
      ...(fixed.length ? [`已避开本周看板上已有的 ${fixed.length} 个日程`] : []),
      ...(lastDays.length ? [`${lastDays.join('、')} 已排满 8 小时以上，其他天排不下时才会用到`] : []),
    ],
  };
}
