import { excludedWeeks } from './calendar-occurrences.mjs';

export const isLocalId = (id) => String(id ?? '').startsWith('local-');

// What the board should show right after a delete is clicked, mirroring the server: a recurring or
// every-week event skips just that week, anything else disappears. Returns null when the row goes away.
export function optimisticDelete(event, scope, week) {
  if (scope === 'week' && (!event.week_key || event.repeat_rule === 'weekly')) {
    return { ...event, excluded_weeks: JSON.stringify([...new Set([...excludedWeeks(event), week])].sort()) };
  }
  return null;
}
