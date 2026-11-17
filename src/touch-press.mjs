// Touch drags start with a press-and-hold so a finger resting on an event can still scroll the page.
export const LONG_PRESS_MS = 250;
export const PRESS_SLOP_PX = 8;

// What a touch pointer move means: before the hold completes, drifting past the slop is a scroll
// (give the gesture back to the browser); after it, every move drags.
export function touchMoveIntent({ armed, start, point }) {
  if (armed) return 'drag';
  return Math.hypot(point.x - start.x, point.y - start.y) >= PRESS_SLOP_PX ? 'scroll' : 'wait';
}
