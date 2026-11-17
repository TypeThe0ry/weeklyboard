import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LONG_PRESS_MS, PRESS_SLOP_PX, touchMoveIntent } from '../../src/touch-press.mjs';

test('a touch move scrolls before the hold completes and drags after it', () => {
  const start = { x: 100, y: 100 };
  assert.equal(touchMoveIntent({ armed: false, start, point: { x: 103, y: 104 } }), 'wait');
  assert.equal(touchMoveIntent({ armed: false, start, point: { x: 100, y: 100 + PRESS_SLOP_PX } }), 'scroll');
  assert.equal(touchMoveIntent({ armed: true, start, point: { x: 100, y: 101 } }), 'drag');
  assert.ok(LONG_PRESS_MS >= 200 && LONG_PRESS_MS <= 400);
});

test('events and grid cells leave touch panning to the browser', async () => {
  const gesture = await readFile(new URL('../../src/event-gesture.css', import.meta.url), 'utf8');
  const style = await readFile(new URL('../../src/style.css', import.meta.url), 'utf8');
  assert.match(gesture, /\.event \{[^}]*touch-action: pan-x pan-y/);
  assert.doesNotMatch(gesture, /\.event \{[^}]*touch-action: none/);
  assert.doesNotMatch(style.match(/\.cell10 \{[^}]*\}/)[0], /touch-action:\s*none/);
});
