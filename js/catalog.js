// Catálogo de rádios / vídeos longos de lofi e lógica de recomendação.
//
// As transmissões em direto 24/7 são as melhores para pomodoros: nunca acabam
// e retomam sem anúncios a meio de uma faixa. Se algum ID deixar de existir
// (as transmissões às vezes são reiniciadas com um ID novo), a app salta
// automaticamente para a recomendação seguinte e, em último caso, usa a
// transmissão em direto atual do canal (entradas `fallback`), que acompanha
// sempre o ID mais recente.

export const MOODS = Object.freeze({
  study: 'Estudo',
  jazz: 'Jazz',
  synthwave: 'Synthwave',
  chill: 'Relaxar',
  sleep: 'Noturno',
});

export const CATALOG = Object.freeze([
  {
    key: 'lofigirl-study',
    title: 'lofi hip hop radio 📚 beats to relax/study to',
    channel: 'Lofi Girl',
    moods: ['study', 'chill'],
    length: 'Direto 24/7',
    live: true,
    source: { type: 'video', id: 'jfKfPfyJRdk' },
  },
  {
    key: 'lofigirl-jazz',
    title: 'jazz lofi radio 🎷 beats to chill/study to',
    channel: 'Lofi Girl',
    moods: ['jazz', 'study'],
    length: 'Direto 24/7',
    live: true,
    source: { type: 'video', id: 'HuFYqnbVbzY' },
  },
  {
    key: 'lofigirl-synthwave',
    title: 'synthwave radio 🌌 beats to chill/game to',
    channel: 'Lofi Girl',
    moods: ['synthwave'],
    length: 'Direto 24/7',
    live: true,
    source: { type: 'video', id: '4xDzrJKXOOY' },
  },
  {
    key: 'lofigirl-sleep',
    title: 'lofi hip hop radio 💤 beats to sleep/chill to',
    channel: 'Lofi Girl',
    moods: ['sleep', 'chill'],
    length: 'Direto 24/7',
    live: true,
    source: { type: 'video', id: 'rUxyKA_-grg' },
  },
  {
    key: 'chillhop-radio',
    title: 'Chillhop Radio 🐾 jazzy & lofi hip hop beats',
    channel: 'Chillhop Music',
    moods: ['jazz', 'chill', 'study'],
    length: 'Direto 24/7',
    live: true,
    source: { type: 'video', id: '5yx6BWlEVcY' },
  },
  {
    key: 'lofigirl-1am',
    title: '1 A.M Study Session 📚 [lofi hip hop/chill beats]',
    channel: 'Lofi Girl',
    moods: ['study', 'sleep'],
    length: '≈ 1 hora',
    live: false,
    source: { type: 'video', id: 'lTRiuFIWV54' },
  },
  {
    key: 'lofigirl-channel-live',
    title: 'Lofi Girl — transmissão em direto atual',
    channel: 'Lofi Girl',
    moods: ['study', 'chill'],
    length: 'Direto',
    live: true,
    fallback: true,
    source: { type: 'channelLive', id: 'UCSJ4gkVC6NrvII8umztf0Ow' },
  },
  {
    key: 'chillhop-channel-live',
    title: 'Chillhop Music — transmissão em direto atual',
    channel: 'Chillhop Music',
    moods: ['jazz', 'chill'],
    length: 'Direto',
    live: true,
    fallback: true,
    source: { type: 'channelLive', id: 'UCOxqgCwgOqC2lMqC5PYz_Dg' },
  },
]);

/** Período do dia, usado para adaptar a recomendação. */
export function timeSlot(hour) {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 19) return 'afternoon';
  if (hour >= 19 && hour < 23) return 'evening';
  return 'night';
}

export const SLOT_LABEL = Object.freeze({
  morning: 'para esta manhã',
  afternoon: 'para esta tarde',
  evening: 'para esta noite',
  night: 'para a madrugada',
});

const SLOT_MOODS = Object.freeze({
  morning: ['study', 'jazz'],
  afternoon: ['study', 'synthwave', 'jazz'],
  evening: ['chill', 'jazz', 'synthwave'],
  night: ['sleep', 'chill'],
});

function weightedPick(items, weights, random) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Escolhe uma recomendação.
 * @param {object} opts
 * @param {number} opts.hour hora local (0–23)
 * @param {string|null} [opts.mood] filtro de estilo escolhido pelo utilizador
 * @param {Iterable<string>} [opts.exclude] chaves a evitar (atual, falhadas…)
 * @param {() => number} [opts.random]
 * @param {Array} [opts.catalog]
 * @returns {object|null}
 */
export function recommend({
  hour,
  mood = null,
  exclude = [],
  random = Math.random,
  catalog = CATALOG,
} = {}) {
  const excluded = new Set(exclude);
  const available = catalog.filter((e) => !excluded.has(e.key));
  const regular = available.filter((e) => !e.fallback);

  let pool = regular;
  if (mood) {
    const byMood = regular.filter((e) => e.moods.includes(mood));
    if (byMood.length) pool = byMood;
  }

  if (!pool.length) {
    const fallbacks = available.filter((e) => e.fallback);
    if (!fallbacks.length) return null;
    const byMood = mood ? fallbacks.filter((e) => e.moods.includes(mood)) : [];
    return (byMood.length ? byMood : fallbacks)[0];
  }

  const preferred = SLOT_MOODS[timeSlot(hour)] ?? [];
  const weights = pool.map((e) => {
    let w = 1;
    if (!mood && e.moods.some((m) => preferred.includes(m))) w += 3;
    if (!mood && e.moods[0] === preferred[0]) w += 2;
    if (e.live) w += 1;
    return w;
  });
  return weightedPick(pool, weights, random);
}

export function findEntry(key, catalog = CATALOG) {
  return catalog.find((e) => e.key === key) ?? null;
}
