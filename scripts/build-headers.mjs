// Gera vercel.json e _headers a partir de scripts/security-headers.mjs.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { securityHeaders, NO_CACHE_PATHS } from './security-headers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const headers = securityHeaders();
const noCache = { 'Cache-Control': 'no-cache, must-revalidate' };

export function vercelConfig() {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    cleanUrls: false,
    trailingSlash: false,
    headers: [
      {
        source: '/(.*)',
        headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
      },
      ...NO_CACHE_PATHS.map((source) => ({
        source,
        headers: Object.entries(noCache).map(([key, value]) => ({ key, value })),
      })),
    ],
  };
}

export function netlifyHeaders() {
  const block = (path, h) => [path, ...Object.entries(h).map(([k, v]) => `  ${k}: ${v}`)].join('\n');
  return [
    '# Gerado por `npm run headers` a partir de scripts/security-headers.mjs — não editar à mão.',
    block('/*', headers),
    ...NO_CACHE_PATHS.map((p) => block(p, noCache)),
    '',
  ].join('\n\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(`${root}vercel.json`, `${JSON.stringify(vercelConfig(), null, 2)}\n`);
  writeFileSync(`${root}_headers`, netlifyHeaders());
  console.log('vercel.json e _headers atualizados.');
}
