// Estatísticas diárias simples (pomodoros e minutos de foco de hoje).

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function count(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Garante a forma do objeto e recomeça a contagem diária quando muda o dia. */
export function normalizeStats(stats, now = new Date()) {
  const today = dayKey(now);
  const s = stats && typeof stats === 'object' ? stats : {};
  const sameDay = s.day === today;
  return {
    day: today,
    pomodoros: sameDay ? count(s.pomodoros) : 0,
    focusMs: sameDay ? count(s.focusMs) : 0,
    totalPomodoros: count(s.totalPomodoros),
  };
}

export function recordPomodoro(stats, durationMs, now = new Date()) {
  const s = normalizeStats(stats, now);
  return {
    ...s,
    pomodoros: s.pomodoros + 1,
    focusMs: s.focusMs + count(durationMs),
    totalPomodoros: s.totalPomodoros + 1,
  };
}

export function formatFocus(ms) {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
