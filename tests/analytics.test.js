import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageSnapshot } from '../js/analytics.js';
import { isAuthRedirect, friendlyError } from '../js/account.js';

const day = (d) => new Date(2026, 10, d, 12);

test('retenção: só intervalos, um evento por dia', () => {
  const first = usageSnapshot(day(3), null);
  assert.equal(first.newDay, true);
  assert.deepEqual(first.event, { dias_desde_inicio: '0', dias_ativos: '1' });

  const sameDay = usageSnapshot(day(3), first.usage);
  assert.equal(sameDay.newDay, false);

  const later = usageSnapshot(day(8), first.usage);
  assert.deepEqual(later.event, { dias_desde_inicio: '2-7', dias_ativos: '2-3' });
  assert.ok(!JSON.stringify(later.event).includes('2026'), 'nunca envia datas');

  const muchLater = usageSnapshot(new Date(2027, 2, 1, 12), { first: '2026-11-03', last: '2027-01-01', days: 40 });
  assert.deepEqual(muchLater.event, { dias_desde_inicio: '30+', dias_ativos: '30+' });
});

test('deteta o regresso de um link de login', () => {
  const loc = (search, hash = '') => ({ search, hash });
  assert.equal(isAuthRedirect(loc('?code=abc')), true);
  assert.equal(isAuthRedirect(loc('?error_description=expired')), true);
  assert.equal(isAuthRedirect(loc('', '#access_token=x&type=magiclink')), true);
  assert.equal(isAuthRedirect(loc('?utm_source=x')), false);
  assert.equal(isAuthRedirect(loc('')), false);
});

test('erros em português e sem detalhes técnicos', () => {
  assert.match(friendlyError({ status: 429, message: 'Email rate limit exceeded' }), /Demasiados pedidos/);
  assert.match(friendlyError({ message: 'Token has expired or is invalid' }), /Código inválido/);
  assert.match(friendlyError(new TypeError('Failed to fetch')), /Sem ligação/);
  assert.match(friendlyError({ message: 'duplicate key value violates unique constraint "x"' }), /Algo correu mal/);
});
