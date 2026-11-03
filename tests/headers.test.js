import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CSP_DIRECTIVES, buildCsp, securityHeaders } from '../scripts/security-headers.mjs';
import { vercelConfig, netlifyHeaders } from '../scripts/build-headers.mjs';
import { buildEmbedUrl } from '../js/youtube-url.js';
import { CONFIG } from '../js/config.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('vercel.json e _headers estão atualizados (corre `npm run headers`)', () => {
  assert.deepEqual(JSON.parse(read('vercel.json')), vercelConfig());
  assert.equal(read('_headers'), netlifyHeaders());
});

test('CSP sem atalhos perigosos', () => {
  const csp = buildCsp();
  assert.ok(!csp.includes("'unsafe-inline'"));
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(!/(^|\s)\*(\s|;|$)/.test(csp), 'sem curingas soltos');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.ok(!buildCsp({ dev: true }).includes('upgrade-insecure-requests'));
});

test('a CSP autoriza os serviços que a app usa', () => {
  const allows = (directive, url) => {
    const { origin, protocol } = new URL(url);
    return CSP_DIRECTIVES[directive].some((src) => {
      if (src === origin) return true;
      const m = src.match(/^(https|wss):\/\/\*\.(.+)$/);
      return Boolean(m) && protocol === `${m[1]}:` && origin.endsWith(`.${m[2]}`);
    });
  };
  assert.ok(allows('frame-src', buildEmbedUrl({ type: 'video', id: 'jfKfPfyJRdk' })));
  assert.ok(allows('script-src', 'https://www.youtube.com/iframe_api'));
  assert.ok(allows('script-src', CONFIG.analytics.umamiScriptUrl));
  const supabase = CONFIG.supabase.url || 'https://abcdefghijklmnop.supabase.co';
  assert.ok(allows('connect-src', supabase));
  assert.ok(allows('connect-src', supabase.replace('https:', 'wss:')));
});

test('outros cabeçalhos essenciais', () => {
  const h = securityHeaders();
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(h['Strict-Transport-Security'], /max-age=\d{7,}/);
  assert.equal(securityHeaders({ dev: true })['Strict-Transport-Security'], undefined);
});
