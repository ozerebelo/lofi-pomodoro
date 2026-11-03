import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStats, recordPomodoro, formatFocus, dayKey } from '../js/stats.js';

test('conta pomodoros do dia e recomeça no dia seguinte', () => {
  const day1 = new Date(2026, 10, 3, 10, 0);
  const day2 = new Date(2026, 10, 4, 9, 0);
  let s = normalizeStats(null, day1);
  s = recordPomodoro(s, 25 * 60_000, day1);
  s = recordPomodoro(s, 25 * 60_000, day1);
  assert.equal(s.day, dayKey(day1));
  assert.equal(s.pomodoros, 2);
  assert.equal(s.focusMs, 50 * 60_000);

  const next = normalizeStats(s, day2);
  assert.equal(next.pomodoros, 0);
  assert.equal(next.focusMs, 0);
  assert.equal(next.totalPomodoros, 2);
});

test('formatFocus', () => {
  assert.equal(formatFocus(0), '0 min');
  assert.equal(formatFocus(25 * 60_000), '25 min');
  assert.equal(formatFocus(120 * 60_000), '2 h');
  assert.equal(formatFocus(135 * 60_000), '2 h 15 min');
});

test('normalizeStats aguenta lixo', () => {
  const s = normalizeStats({ day: dayKey(), pomodoros: -4, focusMs: 'x', totalPomodoros: 3.7 });
  assert.deepEqual([s.pomodoros, s.focusMs, s.totalPomodoros], [0, 0, 3]);
});
