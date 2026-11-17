// Linear undo/redo stack for async commands. A command is
// { label, undo: async () => void, redo: async () => void }.
// If a step throws, the command stays where it was so the user can retry.
export function createHistory(limit = 50) {
  let past = [];
  let future = [];
  return {
    push(command) {
      past.push(command);
      if (past.length > limit) past.shift();
      future = [];
    },
    async undo() {
      const command = past[past.length - 1];
      if (!command) return null;
      try { await command.undo(); } catch (error) { if (error?.status === 404) past.pop(); throw error; }
      past.pop();
      future.push(command);
      return command;
    },
    async redo() {
      const command = future[future.length - 1];
      if (!command) return null;
      try { await command.redo(); } catch (error) { if (error?.status === 404) future.pop(); throw error; }
      future.pop();
      past.push(command);
      return command;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() { past = []; future = []; },
  };
}

// Fields that make up an event's user-visible state; used to snapshot and restore.
const SNAPSHOT_FIELDS = ['title', 'day', 'start_minute', 'end_minute', 'category', 'description', 'layer', 'week_key', 'task_id', 'locked'];
export function eventSnapshot(event) {
  const snapshot = {};
  for (const field of SNAPSHOT_FIELDS) if (event[field] !== undefined) snapshot[field] = event[field];
  if (event.category === undefined && event.cat) snapshot.category = event.cat;
  snapshot.repeat = event.repeat_rule === 'weekly' || event.repeat === true;
  return snapshot;
}
export function diffPatch(before, after) {
  const patch = {};
  for (const key of Object.keys(after)) if (before[key] !== after[key]) patch[key] = after[key];
  return patch;
}
