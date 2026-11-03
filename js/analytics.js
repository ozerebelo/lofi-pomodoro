// Estatísticas de utilização anónimas e sem cookies (Umami ou Vercel Analytics).
//
// Princípios:
//  - nada é enviado se o fornecedor não estiver configurado, se a pessoa
//    desligar nas definições, ou se o navegador pedir "Do Not Track" / GPC;
//  - sem identificadores: nem email, nem id de conta, nem IP guardado
//    (o Umami e a Vercel descartam-no); os eventos levam só categorias;
//  - o endereço é enviado SEM parâmetros (os links de login têm ?code=...).

import { CONFIG } from './config.js';
import * as store from './storage.js';
import { dayKey } from './stats.js';

const provider = CONFIG.analytics.provider;
let active = false;
const pending = [];

export function privacySignal() {
  return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
}

export function analyticsAvailable() {
  if (provider === 'umami') return Boolean(CONFIG.analytics.umamiWebsiteId);
  return provider === 'vercel';
}

export function initAnalytics({ allowed }) {
  if (active || !allowed || !analyticsAvailable() || privacySignal()) return false;
  if (!/^https?:$/.test(window.location.protocol)) return false;
  active = true;

  const script = document.createElement('script');
  script.defer = true;
  if (provider === 'umami') {
    script.src = CONFIG.analytics.umamiScriptUrl;
    script.dataset.websiteId = CONFIG.analytics.umamiWebsiteId;
    script.dataset.excludeSearch = 'true';
    script.dataset.excludeHash = 'true';
    script.dataset.doNotTrack = 'true';
    script.addEventListener('load', flush);
  } else {
    window.va =
      window.va ||
      function va(...args) {
        (window.vaq = window.vaq || []).push(args);
      };
    script.src = '/_vercel/insights/script.js';
  }
  document.head.append(script);
  flush();
  return true;
}

/** Para de enviar eventos (o script já carregado fica, mas sem dados novos). */
export function disableAnalytics() {
  active = false;
  pending.length = 0;
  try {
    localStorage.setItem('umami.disabled', '1');
  } catch {
    /* ignora */
  }
}

function send(name, data) {
  if (provider === 'umami') {
    if (!window.umami?.track) return false;
    window.umami.track(name, data);
    return true;
  }
  window.va?.('event', { name, data });
  return true;
}

function flush() {
  while (active && pending.length) {
    const [name, data] = pending[0];
    if (!send(name, data)) return;
    pending.shift();
  }
}

export function track(name, data = {}) {
  if (!active) return;
  if (!send(name, data) && pending.length < 50) pending.push([name, data]);
}

// --- Retenção sem identificadores --------------------------------------------
// Ferramentas sem cookies não sabem se alguém "voltou". Guardamos localmente
// (neste dispositivo) a data da 1.ª visita e o nº de dias com uso, e enviamos
// no máximo um evento por dia, só com intervalos ("2-7 dias"), nunca datas.

function bucket(n, edges) {
  for (const [max, label] of edges) if (n <= max) return label;
  return edges[edges.length - 1][1];
}

export function usageSnapshot(now = new Date(), saved = store.load('usage', null)) {
  const today = dayKey(now);
  const usage = saved && typeof saved.first === 'string' ? { ...saved } : { first: today, last: null, days: 0 };
  const newDay = usage.last !== today;
  if (newDay) {
    usage.days = (Number(usage.days) || 0) + 1;
    usage.last = today;
  }
  const sinceFirst = Math.max(0, Math.round((Date.parse(today) - Date.parse(usage.first)) / 86_400_000));
  return {
    usage,
    newDay,
    event: {
      dias_desde_inicio: bucket(sinceFirst, [
        [0, '0'],
        [1, '1'],
        [7, '2-7'],
        [30, '8-30'],
        [Infinity, '30+'],
      ]),
      dias_ativos: bucket(usage.days, [
        [1, '1'],
        [3, '2-3'],
        [7, '4-7'],
        [30, '8-30'],
        [Infinity, '30+'],
      ]),
    },
  };
}

export function trackDailyVisit() {
  if (!active) return; // sem consentimento/fornecedor nem sequer se guarda o histórico
  const { usage, newDay, event } = usageSnapshot();
  store.save('usage', usage);
  if (newDay) track('visita', event);
}
