// Interpretação de links do YouTube e construção de URLs de embed (sem DOM).
//
// Uma "fonte" de música é um objeto { type, id }:
//   - { type: 'video', id: '<11 caracteres>' }
//   - { type: 'playlist', id: 'PL...' }
//   - { type: 'channelLive', id: 'UC...' }  → a transmissão em direto atual do canal

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
]);

export function isValidSource(source) {
  if (!source || typeof source !== 'object') return false;
  switch (source.type) {
    case 'video':
      return VIDEO_ID.test(source.id);
    case 'playlist':
      return PLAYLIST_ID.test(source.id);
    case 'channelLive':
      return CHANNEL_ID.test(source.id);
    default:
      return false;
  }
}

/**
 * Converte o texto colado pelo utilizador numa fonte.
 * Aceita links watch, youtu.be, /live/, /shorts/, /embed/, playlists,
 * /channel/UC.../live e IDs soltos. Devolve `null` se não reconhecer.
 */
export function parseYouTubeInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  if (VIDEO_ID.test(text)) return { type: 'video', id: text };
  if (CHANNEL_ID.test(text)) return { type: 'channelLive', id: text };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const v = url.searchParams.get('v');
  const list = url.searchParams.get('list');

  if (url.hostname.toLowerCase() === 'youtu.be') {
    if (parts[0] && VIDEO_ID.test(parts[0])) return { type: 'video', id: parts[0] };
    return null;
  }

  // Um vídeo específico tem prioridade sobre a playlist em que está inserido:
  // vídeos longos de lofi são o caso mais comum.
  if (v && VIDEO_ID.test(v)) return { type: 'video', id: v };

  // "videoseries" e "live_stream" têm 11 caracteres, como um ID de vídeo.
  const reserved = parts[1] === 'videoseries' || parts[1] === 'live_stream';
  if (['live', 'shorts', 'embed', 'v'].includes(parts[0]) && parts[1] && !reserved) {
    if (VIDEO_ID.test(parts[1])) return { type: 'video', id: parts[1] };
  }

  if (parts[0] === 'channel' && parts[1] && CHANNEL_ID.test(parts[1])) {
    return { type: 'channelLive', id: parts[1] };
  }

  if (parts[0] === 'embed' && parts[1] === 'live_stream') {
    const channel = url.searchParams.get('channel');
    if (channel && CHANNEL_ID.test(channel)) return { type: 'channelLive', id: channel };
  }

  if (list && PLAYLIST_ID.test(list)) return { type: 'playlist', id: list };

  return null;
}

/** URL do iframe para uma fonte, já com a API JavaScript ativa. */
export function buildEmbedUrl(source, { origin, autoplay = false } = {}) {
  if (!isValidSource(source)) throw new Error('Fonte do YouTube inválida');

  let base;
  const params = new URLSearchParams();
  if (source.type === 'video') {
    base = `https://www.youtube.com/embed/${source.id}`;
  } else if (source.type === 'playlist') {
    base = 'https://www.youtube.com/embed/videoseries';
    params.set('list', source.id);
  } else {
    base = 'https://www.youtube.com/embed/live_stream';
    params.set('channel', source.id);
  }

  params.set('enablejsapi', '1');
  params.set('rel', '0');
  params.set('playsinline', '1');
  params.set('autoplay', autoplay ? '1' : '0');
  if (origin && /^https?:\/\//.test(origin)) params.set('origin', origin);

  return `${base}?${params.toString()}`;
}

/** Link normal do YouTube (para "abrir no YouTube"). */
export function buildWatchUrl(source) {
  if (!isValidSource(source)) return 'https://www.youtube.com/';
  if (source.type === 'video') return `https://www.youtube.com/watch?v=${source.id}`;
  if (source.type === 'playlist') return `https://www.youtube.com/playlist?list=${source.id}`;
  return `https://www.youtube.com/channel/${source.id}/live`;
}

export function sourceKey(source) {
  return source ? `${source.type}:${source.id}` : '';
}
