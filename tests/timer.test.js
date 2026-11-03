import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PomodoroTimer,
  PHASE,
  STATUS,
  DEFAULT_SETTINGS,
  nextPhase,
  formatTime,
  sanitizeSettings,
} from '../js/timer.js';

const MIN = 60_000;

function makeTimer(settings = {}) {
  const clock = { t: 1_000_000 };
  const timer = new PomodoroTimer({
    settings: { ...DEFAULT_SETTINGS, ...settings },
    now: () => clock.t,
  });
  const events = [];
  timer.on('complete', (e) => events.push(e));
  return { timer, clock, events };
}

test('formatTime arredonda para cima e mostra horas quando preciso', () => {
  assert.equal(formatTime(25 * MIN), '25:00');
  assert.equal(formatTime(59_001), '01:00');
  assert.equal(formatTime(1), '00:01');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(-5), '00:00');
  assert.equal(formatTime(90 * MIN), '1:30:00');
});

test('nextPhase: pausa longa a cada N sessões de foco', () => {
  const s = { ...DEFAULT_SETTINGS, longBreakEvery: 3 };
  assert.deepEqual(nextPhase(PHASE.WORK, 0, s), { phase: PHASE.SHORT_BREAK, completedInCycle: 1 });
  assert.deepEqual(nextPhase(PHASE.SHORT_BREAK, 1, s), { phase: PHASE.WORK, completedInCycle: 1 });
  assert.deepEqual(nextPhase(PHASE.WORK, 2, s), { phase: PHASE.LONG_BREAK, completedInCycle: 3 });
  assert.deepEqual(nextPhase(PHASE.LONG_BREAK, 3, s), { phase: PHASE.WORK, completedInCycle: 0 });
});

test('sanitizeSettings limita valores e ignora lixo', () => {
  const s = sanitizeSettings({ workMin: '0', shortBreakMin: 999, longBreakEvery: 'abc', music: 0, extra: 1 });
  assert.equal(s.workMin, 1);
  assert.equal(s.shortBreakMin, 60);
  assert.equal(s.longBreakEvery, DEFAULT_SETTINGS.longBreakEvery);
  assert.equal(s.music, false);
  assert.equal('extra' in s, false);
});

test('conta o tempo a partir do relógio, pausa e retoma', () => {
  const { timer, clock } = makeTimer({ workMin: 25 });
  timer.start();
  clock.t += 10 * MIN;
  assert.equal(timer.getRemainingMs(), 15 * MIN);
  timer.pause();
  clock.t += 60 * MIN; // em pausa o tempo não corre
  assert.equal(timer.getRemainingMs(), 15 * MIN);
  assert.equal(timer.status, STATUS.PAUSED);
  timer.start();
  clock.t += 5 * MIN;
  assert.equal(timer.getRemainingMs(), 10 * MIN);
  assert.ok(Math.abs(timer.getProgress() - 0.6) < 1e-9);
});

test('no fim do foco passa para a pausa e arranca-a sozinha (por omissão)', () => {
  const { timer, clock, events } = makeTimer({ workMin: 25, shortBreakMin: 5 });
  timer.start();
  clock.t += 25 * MIN;
  assert.equal(timer.tick(), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].from, PHASE.WORK);
  assert.equal(events[0].to, PHASE.SHORT_BREAK);
  assert.equal(events[0].skipped, false);
  assert.equal(events[0].autoStarted, true);
  assert.equal(events[0].durationMs, 25 * MIN);
  assert.equal(timer.phase, PHASE.SHORT_BREAK);
  assert.equal(timer.status, STATUS.RUNNING);
  assert.equal(timer.getRemainingMs(), 5 * MIN);
});

test('no fim da pausa espera pelo utilizador (por omissão)', () => {
  const { timer, clock, events } = makeTimer();
  timer.setPhase(PHASE.SHORT_BREAK);
  timer.start();
  clock.t += 5 * MIN + 10;
  timer.tick();
  assert.equal(timer.phase, PHASE.WORK);
  assert.equal(timer.status, STATUS.IDLE);
  assert.equal(events[0].autoStarted, false);
  assert.equal(timer.getRemainingMs(), 25 * MIN);
});

test('ciclo completo chega à pausa longa e recomeça', () => {
  const { timer, clock } = makeTimer({ longBreakEvery: 2, autoStartWork: true });
  const phases = [];
  timer.on('complete', (e) => phases.push(e.to));
  timer.start();
  for (let i = 0; i < 4; i++) {
    clock.t += timer.getRemainingMs();
    timer.tick();
  }
  assert.deepEqual(phases, [PHASE.SHORT_BREAK, PHASE.WORK, PHASE.LONG_BREAK, PHASE.WORK]);
  assert.equal(timer.completedInCycle, 0);
});

test('tick não faz nada antes do tempo nem quando parado', () => {
  const { timer, clock, events } = makeTimer();
  assert.equal(timer.tick(), false);
  timer.start();
  clock.t += 24 * MIN;
  assert.equal(timer.tick(), false);
  assert.equal(events.length, 0);
});

test('saltar avança mas fica marcado como saltado', () => {
  const { timer, events } = makeTimer();
  timer.start();
  timer.skip();
  assert.equal(events[0].skipped, true);
  assert.equal(timer.phase, PHASE.SHORT_BREAK);
});

test('reset volta ao início da fase, parado', () => {
  const { timer, clock } = makeTimer();
  timer.start();
  clock.t += 3 * MIN;
  timer.reset();
  assert.equal(timer.status, STATUS.IDLE);
  assert.equal(timer.getRemainingMs(), 25 * MIN);
});

test('updateSettings muda a duração quando parado', () => {
  const { timer } = makeTimer();
  timer.updateSettings({ workMin: 50 });
  assert.equal(timer.getRemainingMs(), 50 * MIN);
});

test('restore: sessão a correr volta em pausa com o tempo certo', () => {
  const a = makeTimer();
  a.timer.start();
  a.clock.t += 5 * MIN;
  const saved = a.timer.snapshot();

  const b = makeTimer();
  b.clock.t = a.clock.t + 2 * MIN; // página recarregada 2 min depois
  const finished = b.timer.restore(saved);
  assert.equal(finished, false);
  assert.equal(b.timer.status, STATUS.PAUSED);
  assert.equal(b.timer.getRemainingMs(), 18 * MIN);
});

test('restore: fase que acabou entretanto avança para a seguinte', () => {
  const a = makeTimer();
  a.timer.start();
  const saved = a.timer.snapshot();
  const b = makeTimer();
  b.clock.t = a.clock.t + 30 * MIN;
  assert.equal(b.timer.restore(saved), true);
  assert.equal(b.timer.phase, PHASE.SHORT_BREAK);
  assert.equal(b.timer.status, STATUS.IDLE);
  assert.equal(b.timer.completedInCycle, 1);
});

test('restore ignora dados inválidos', () => {
  const { timer } = makeTimer();
  assert.equal(timer.restore(null), false);
  assert.equal(timer.restore({ phase: 'nope' }), false);
  timer.restore({ phase: PHASE.WORK, status: STATUS.PAUSED, remainingMs: 'x', completedInCycle: -3 });
  assert.equal(timer.status, STATUS.IDLE);
  assert.equal(timer.completedInCycle, 0);
  assert.equal(timer.getRemainingMs(), 25 * MIN);
});
