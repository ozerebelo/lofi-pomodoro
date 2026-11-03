import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(`${ROOT}sw.js`, 'utf8');
const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);

test('todos os ficheiros da cache do service worker existem', () => {
  // Se um faltar, a instalação do service worker falha por inteiro.
  for (const file of shell.filter(Boolean)) {
    assert.ok(existsSync(`${ROOT}${file}`), `sw.js refere ${file}, que não existe`);
  }
});

test('todos os módulos da app estão na cache (funciona offline)', () => {
  for (const file of readdirSync(`${ROOT}js`)) {
    assert.ok(shell.includes(`js/${file}`), `falta js/${file} em sw.js`);
  }
});
