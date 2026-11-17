import { occursInWeek } from './calendar-occurrences.mjs';

export const REMINDER_LEAD_MINUTES = 10;
const time = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

// Planned events on the given day that start within the lead time and have not been announced yet.
// "Actual" records describe what already happened, so they never remind.
export function dueReminders(events, { weekKey, day, minute, sent = new Set(), lead = REMINDER_LEAD_MINUTES }) {
  return events
    .filter((event) => event.day === day && !event.all_day && !event.deadline_kind && event.layer !== 'actual' && occursInWeek(event, weekKey))
    .map((event) => ({ event, key: `${weekKey}:${event.id}:${event.start_minute}`, in_minutes: Number(event.start_minute) - minute }))
    .filter((item) => item.in_minutes >= 0 && item.in_minutes <= lead && !sent.has(item.key))
    .sort((a, b) => a.in_minutes - b.in_minutes);
}

export function reminderText({ event, in_minutes: inMinutes }) {
  return { title: `${inMinutes > 0 ? `${inMinutes} 分钟后` : '现在开始'}：${event.title}`, body: `${event.day} ${time(event.start_minute)} – ${time(event.end_minute)}` };
}
