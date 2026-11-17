// Shared by the server (planner context) and the UI (review card): turns the weekly review
// into a few short, human-readable notes.
const WEEK_KEY = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;
const DAY = 86400000;
const hours = (minutes) => Math.round((Number(minutes) || 0) / 6) / 10;
const OVERLOAD_MINUTES = 480;
const LOW_MOOD_DAYS = 4;

export function previousWeekKey(week) {
  const match = WEEK_KEY.exec(week || '');
  if (!match) return null;
  const jan4 = Date.UTC(Number(match[1]), 0, 4);
  const firstMonday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  const thursday = new Date(firstMonday + (Number(match[2]) - 2) * 7 * DAY + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const number = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY)) + 1;
  return `${year}-W${String(number).padStart(2, '0')}`;
}

export function reviewNotes(context) {
  const notes = [];
  const last = context?.last_week;
  if (last && last.planned_minutes > 0) {
    const rate = Number(last.completion_rate) || 0;
    notes.push(`上周完成率 ${Math.round(rate * 100)}%（计划 ${hours(last.planned_minutes)} 小时，实际 ${hours(last.actual_minutes)} 小时）${rate < 0.6 ? '，本周建议少排一些' : ''}`);
    const unfinished = (last.unfinished || []).map((row) => row.title).filter(Boolean);
    if (unfinished.length) notes.push(`上周未完成：${unfinished.slice(0, 3).join('、')}${unfinished.length > 3 ? ` 等 ${unfinished.length} 项` : ''}`);
  }
  for (const [day, minutes] of Object.entries(context?.this_week?.daily_load || {})) {
    if (minutes >= OVERLOAD_MINUTES) notes.push(`本周 ${day} 已安排 ${hours(minutes)} 小时，尽量别再往这天加任务`);
  }
  const low = context?.mood_trend?.low_days || 0;
  if (low >= LOW_MOOD_DAYS) notes.push(`近 28 天有 ${low} 天记录为疲惫或低落，记得留出休息时间`);
  return notes;
}
