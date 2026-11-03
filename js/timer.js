// Máquina de estados do pomodoro, sem dependências do DOM (testável em Node).
//
// O tempo restante é sempre calculado a partir de um instante final absoluto
// (`endAt`) e não por decrementos sucessivos. Assim o temporizador continua
// certo mesmo quando o navegador atrasa os timers num separador em segundo plano.

export const PHASE = Object.freeze({
  WORK: 'work',
  SHORT_BREAK: 'shortBreak',
  LONG_BREAK: 'longBreak',
});

export const STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
});

export const DEFAULT_SETTINGS = Object.freeze({
  workMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  autoStartBreaks: true,
  autoStartWork: false,
  reminderEveryMin: 5,
  notifications: true,
  sound: true,
  music: true,
  fadeMusic: true,
  analytics: true,
});

const LIMITS = {
  workMin: [1, 180],
  shortBreakMin: [1, 60],
  longBreakMin: [1, 120],
  longBreakEvery: [2, 12],
  reminderEveryMin: [0, 60],
};

/** Normaliza definições vindas do utilizador / localStorage. */
export function sanitizeSettings(input = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in input)) continue;
    const def = DEFAULT_SETTINGS[key];
    const value = input[key];
    if (typeof def === 'boolean') {
      out[key] = Boolean(value);
    } else {
      const n = Math.round(Number(value));
      if (Number.isFinite(n)) {
        const [min, max] = LIMITS[key];
        out[key] = Math.min(max, Math.max(min, n));
      }
    }
  }
  return out;
}

export function isBreak(phase) {
  return phase === PHASE.SHORT_BREAK || phase === PHASE.LONG_BREAK;
}

export function phaseDurationMs(phase, settings) {
  const min =
    phase === PHASE.WORK
      ? settings.workMin
      : phase === PHASE.SHORT_BREAK
        ? settings.shortBreakMin
        : settings.longBreakMin;
  return min * 60_000;
}

/**
 * Calcula a fase seguinte.
 * `completedInCycle` = nº de sessões de foco já concluídas no ciclo atual.
 */
export function nextPhase(phase, completedInCycle, settings) {
  if (phase === PHASE.WORK) {
    const done = completedInCycle + 1;
    if (done >= settings.longBreakEvery) {
      return { phase: PHASE.LONG_BREAK, completedInCycle: done };
    }
    return { phase: PHASE.SHORT_BREAK, completedInCycle: done };
  }
  if (phase === PHASE.LONG_BREAK) {
    return { phase: PHASE.WORK, completedInCycle: 0 };
  }
  return { phase: PHASE.WORK, completedInCycle };
}

export function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export class PomodoroTimer {
  /**
   * @param {object} opts
   * @param {object} [opts.settings]
   * @param {() => number} [opts.now] relógio injetável (para testes)
   */
  constructor({ settings = DEFAULT_SETTINGS, now = () => Date.now() } = {}) {
    this.now = now;
    this.settings = sanitizeSettings(settings);
    this.phase = PHASE.WORK;
    this.status = STATUS.IDLE;
    this.completedInCycle = 0;
    this.remainingMs = phaseDurationMs(this.phase, this.settings);
    this.endAt = null;
    this.listeners = { change: new Set(), complete: new Set() };
  }

  on(event, fn) {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners[event]) fn(payload);
  }

  get durationMs() {
    return phaseDurationMs(this.phase, this.settings);
  }

  getRemainingMs() {
    if (this.status === STATUS.RUNNING) {
      return Math.max(0, this.endAt - this.now());
    }
    return this.remainingMs;
  }

  getProgress() {
    const total = this.durationMs;
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, 1 - this.getRemainingMs() / total));
  }

  snapshot() {
    return {
      phase: this.phase,
      status: this.status,
      completedInCycle: this.completedInCycle,
      remainingMs: this.getRemainingMs(),
      endAt: this.endAt,
    };
  }

  start() {
    if (this.status === STATUS.RUNNING) return;
    if (this.remainingMs <= 0) this.remainingMs = this.durationMs;
    this.endAt = this.now() + this.remainingMs;
    this.status = STATUS.RUNNING;
    this.emit('change', { reason: 'start' });
  }

  pause() {
    if (this.status !== STATUS.RUNNING) return;
    this.remainingMs = Math.max(0, this.endAt - this.now());
    this.endAt = null;
    this.status = STATUS.PAUSED;
    this.emit('change', { reason: 'pause' });
  }

  toggle() {
    if (this.status === STATUS.RUNNING) this.pause();
    else this.start();
  }

  /** Volta ao início da fase atual, parado. */
  reset() {
    this.status = STATUS.IDLE;
    this.endAt = null;
    this.remainingMs = this.durationMs;
    this.emit('change', { reason: 'reset' });
  }

  /** Muda manualmente de fase (separadores Foco / Pausa curta / Pausa longa). */
  setPhase(phase) {
    if (!Object.values(PHASE).includes(phase)) return;
    this.phase = phase;
    if (phase === PHASE.WORK && this.completedInCycle >= this.settings.longBreakEvery) {
      this.completedInCycle = 0;
    }
    this.status = STATUS.IDLE;
    this.endAt = null;
    this.remainingMs = this.durationMs;
    this.emit('change', { reason: 'phase' });
  }

  /** Avança para a fase seguinte sem esperar o fim (não conta para as estatísticas). */
  skip() {
    this.advance({ skipped: true });
  }

  /** Deve ser chamado periodicamente; deteta o fim da fase. */
  tick() {
    if (this.status === STATUS.RUNNING && this.now() >= this.endAt) {
      this.advance({ skipped: false });
      return true;
    }
    return false;
  }

  advance({ skipped }) {
    const from = this.phase;
    const fromDurationMs = this.durationMs;
    const next = nextPhase(this.phase, this.completedInCycle, this.settings);
    this.phase = next.phase;
    this.completedInCycle = next.completedInCycle;
    this.remainingMs = this.durationMs;
    this.endAt = null;
    this.status = STATUS.IDLE;

    const autoStart = isBreak(this.phase)
      ? this.settings.autoStartBreaks
      : this.settings.autoStartWork;

    this.emit('complete', {
      from,
      to: this.phase,
      skipped,
      autoStarted: autoStart,
      durationMs: fromDurationMs,
    });

    if (autoStart) {
      this.start();
    } else {
      this.emit('change', { reason: 'advance' });
    }
  }

  /** Aplica novas definições; se a fase não estiver a decorrer, ajusta a duração. */
  updateSettings(settings) {
    this.settings = sanitizeSettings({ ...this.settings, ...settings });
    if (this.status === STATUS.IDLE) {
      this.remainingMs = this.durationMs;
    } else if (this.remainingMs > this.durationMs && this.status === STATUS.PAUSED) {
      this.remainingMs = this.durationMs;
    }
    this.emit('change', { reason: 'settings' });
  }

  /**
   * Restaura um estado guardado (ex.: depois de recarregar a página).
   * Uma sessão que estava a correr volta em pausa, porque o navegador só deixa
   * tocar som depois de um clique do utilizador.
   * Devolve `true` se a fase guardada já tinha terminado entretanto.
   */
  restore(saved) {
    if (!saved || typeof saved !== 'object') return false;
    if (!Object.values(PHASE).includes(saved.phase)) return false;

    this.phase = saved.phase;
    const cycle = Math.round(Number(saved.completedInCycle));
    this.completedInCycle = Number.isFinite(cycle)
      ? Math.min(this.settings.longBreakEvery, Math.max(0, cycle))
      : 0;

    let remaining;
    if (saved.status === STATUS.RUNNING && Number.isFinite(saved.endAt)) {
      remaining = saved.endAt - this.now();
    } else {
      remaining = Number(saved.remainingMs);
    }

    this.endAt = null;

    if (saved.status === STATUS.RUNNING && remaining <= 0) {
      const next = nextPhase(this.phase, this.completedInCycle, this.settings);
      this.phase = next.phase;
      this.completedInCycle = next.completedInCycle;
      this.status = STATUS.IDLE;
      this.remainingMs = this.durationMs;
      this.emit('change', { reason: 'restore' });
      return true;
    }

    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > this.durationMs) {
      this.status = STATUS.IDLE;
      this.remainingMs = this.durationMs;
    } else if (saved.status === STATUS.IDLE) {
      this.status = STATUS.IDLE;
      this.remainingMs = this.durationMs;
    } else {
      this.status = STATUS.PAUSED;
      this.remainingMs = remaining;
    }
    this.emit('change', { reason: 'restore' });
    return false;
  }
}
