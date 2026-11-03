import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, MOODS, recommend, timeSlot, findEntry } from '../js/catalog.js';
import { isValidSource } from '../js/youtube-url.js';

test('todas as entradas do catálogo são válidas e únicas', () => {
  const keys = new Set();
  for (const e of CATALOG) {
    assert.ok(isValidSource(e.source), `fonte inválida: ${e.key}`);
    assert.ok(e.title && e.channel, e.key);
    assert.ok(e.moods.length > 0 && e.moods.every((m) => m in MOODS), e.key);
    assert.ok(!keys.has(e.key), `chave repetida: ${e.key}`);
    keys.add(e.key);
  }
  assert.ok(CATALOG.some((e) => e.fallback), 'deve haver pelo menos uma alternativa de canal');
});

test('timeSlot', () => {
  assert.equal(timeSlot(8), 'morning');
  assert.equal(timeSlot(15), 'afternoon');
  assert.equal(timeSlot(21), 'evening');
  assert.equal(timeSlot(2), 'night');
  assert.equal(timeSlot(23), 'night');
});

test('recomenda sempre algo e nunca uma alternativa de canal se houver vídeos', () => {
  for (let hour = 0; hour < 24; hour++) {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const e = recommend({ hour, random: () => r });
      assert.ok(e, `sem recomendação às ${hour}h`);
      assert.ok(!e.fallback);
    }
  }
});

test('de madrugada favorece lofi para dormir/relaxar', () => {
  let cozy = 0;
  let n = 0;
  for (let i = 0; i < 1000; i++) {
    const e = recommend({ hour: 2, random: () => (i + 0.5) / 1000 });
    n++;
    if (e.moods.includes('sleep') || e.moods.includes('chill')) cozy++;
  }
  assert.ok(cozy / n > 0.6, `apenas ${cozy}/${n}`);
});

test('respeita o estilo escolhido', () => {
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const e = recommend({ hour: 10, mood: 'synthwave', random: () => r });
    assert.ok(e.moods.includes('synthwave'));
  }
});

test('evita os excluídos e usa a alternativa de canal quando tudo falha', () => {
  const regular = CATALOG.filter((e) => !e.fallback).map((e) => e.key);
  const first = recommend({ hour: 10, exclude: regular.slice(1), random: () => 0.5 });
  assert.equal(first.key, regular[0]);

  const fb = recommend({ hour: 10, exclude: regular });
  assert.ok(fb.fallback);

  const none = recommend({ hour: 10, exclude: CATALOG.map((e) => e.key) });
  assert.equal(none, null);
});

test('findEntry', () => {
  assert.equal(findEntry('lofigirl-study').channel, 'Lofi Girl');
  assert.equal(findEntry('nao-existe'), null);
});
