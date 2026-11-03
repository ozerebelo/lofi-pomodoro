// Rede de segurança: nenhuma chave secreta pode ir parar ao código do cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../js/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'vendor']);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : files(path);
    return /\.(js|mjs|html|json|webmanifest|md)$/.test(name) ? [path] : [];
  });
}

function jwtRole(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

test('a chave da Supabase na config é a pública', () => {
  const key = CONFIG.supabase.publishableKey;
  if (!key) return;
  assert.ok(!key.startsWith('sb_secret_'), 'Isso é a chave SECRETA. Usa a "publishable" (sb_publishable_...).');
  const role = jwtRole(key);
  if (role) assert.equal(role, 'anon', 'Isso é a chave service_role. Usa a chave "anon public".');
  else assert.ok(key.startsWith('sb_publishable_'), 'Formato de chave desconhecido.');
});

test('o URL da Supabase é https://<projeto>.supabase.co', () => {
  const url = CONFIG.supabase.url;
  if (!url) return;
  assert.match(url, /^https:\/\/[a-z0-9]{10,40}\.supabase\.co\/?$/);
});

test('nenhum ficheiro do projeto contém chaves secretas', () => {
  for (const file of files(ROOT)) {
    const text = readFileSync(file, 'utf8');
    const where = relative(ROOT, file);
    assert.ok(!/sb_secret_[A-Za-z0-9_-]{10,}/.test(text), `chave secreta em ${where}`);
    for (const token of text.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
      assert.notEqual(jwtRole(token), 'service_role', `chave service_role em ${where}`);
    }
  }
});

test('links externos da config são https ou mailto', () => {
  for (const url of [CONFIG.donateUrl, CONFIG.feedbackUrl]) {
    if (url) assert.match(url, /^(https:\/\/|mailto:)/);
  }
});
