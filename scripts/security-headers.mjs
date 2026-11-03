// Fonte única dos cabeçalhos de segurança HTTP.
//
// `npm run headers` gera a partir daqui:
//   - vercel.json  (Vercel)
//   - _headers     (Cloudflare Pages / Netlify, caso mudes de alojamento)
// O servidor local (scripts/serve.mjs) aplica os mesmos cabeçalhos, por isso
// qualquer violação da CSP aparece logo em desenvolvimento e nos testes.
//
// Se acrescentares um serviço externo (outro fornecedor de estatísticas,
// pagamentos, etc.), tens de o autorizar aqui, senão o navegador bloqueia-o.

export const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  // YouTube IFrame API + Umami (estatísticas). Sem 'unsafe-inline'/'unsafe-eval'.
  'script-src': ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com', 'https://cloud.umami.is'],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'https://i.ytimg.com'],
  'font-src': ["'self'"],
  // Supabase (API + tempo real) e Umami.
  'connect-src': [
    "'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://cloud.umami.is',
    'https://api-gateway.umami.dev',
  ],
  'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
  // O "batimento" do temporizador corre num Web Worker criado a partir de um blob.
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'media-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'upgrade-insecure-requests': [],
};

export function buildCsp({ dev = false } = {}) {
  return Object.entries(CSP_DIRECTIVES)
    .filter(([name]) => !(dev && name === 'upgrade-insecure-requests'))
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ');
}

/** Cabeçalhos aplicados a todas as respostas. */
export function securityHeaders({ dev = false } = {}) {
  const headers = {
    'Content-Security-Policy': buildCsp({ dev }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // O YouTube precisa de receber a origem no Referer (senão: erro 153).
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (!dev) headers['Strict-Transport-Security'] = 'max-age=31536000';
  return headers;
}

/** O service worker nunca deve ficar em cache (senão as atualizações não chegam). */
export const NO_CACHE_PATHS = ['/sw.js', '/js/config.js'];
