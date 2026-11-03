import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeInput, buildEmbedUrl, buildWatchUrl, isValidSource } from '../js/youtube-url.js';

const V = 'jfKfPfyJRdk';
const PL = 'PLOzDu-MXXLliO9fBNZOQTBDddoA3FzZUo';
const CH = 'UCSJ4gkVC6NrvII8umztf0Ow';

test('reconhece os vários formatos de link de vídeo', () => {
  const cases = [
    V,
    `https://www.youtube.com/watch?v=${V}`,
    `https://youtube.com/watch?v=${V}&t=42s`,
    `youtube.com/watch?v=${V}`,
    `https://m.youtube.com/watch?v=${V}`,
    `https://music.youtube.com/watch?v=${V}`,
    `https://youtu.be/${V}`,
    `https://youtu.be/${V}?si=abc`,
    `https://www.youtube.com/live/${V}?feature=share`,
    `https://www.youtube.com/shorts/${V}`,
    `https://www.youtube.com/embed/${V}`,
    `https://www.youtube-nocookie.com/embed/${V}`,
    `  https://www.youtube.com/watch?v=${V}  `,
    `https://www.youtube.com/watch?v=${V}&list=${PL}`,
  ];
  for (const input of cases) {
    assert.deepEqual(parseYouTubeInput(input), { type: 'video', id: V }, input);
  }
});

test('reconhece playlists e diretos de canal', () => {
  assert.deepEqual(parseYouTubeInput(`https://www.youtube.com/playlist?list=${PL}`), { type: 'playlist', id: PL });
  assert.deepEqual(parseYouTubeInput(`https://www.youtube.com/embed/videoseries?list=${PL}`), {
    type: 'playlist',
    id: PL,
  });
  assert.deepEqual(parseYouTubeInput(`https://www.youtube.com/channel/${CH}/live`), {
    type: 'channelLive',
    id: CH,
  });
  assert.deepEqual(parseYouTubeInput(CH), { type: 'channelLive', id: CH });
  assert.deepEqual(parseYouTubeInput(`https://www.youtube.com/embed/live_stream?channel=${CH}`), {
    type: 'channelLive',
    id: CH,
  });
});

test('rejeita o que não é YouTube', () => {
  for (const input of [
    '',
    '   ',
    null,
    'olá',
    'https://vimeo.com/123456',
    `https://evil.example/watch?v=${V}`,
    `https://youtube.com.evil.example/watch?v=${V}`,
    'https://www.youtube.com/watch?v=curto',
    'https://www.youtube.com/@LofiGirl',
    'javascript:alert(1)',
  ]) {
    assert.equal(parseYouTubeInput(input), null, String(input));
  }
});

test('buildEmbedUrl ativa a API e inclui a origem', () => {
  const url = new URL(buildEmbedUrl({ type: 'video', id: V }, { origin: 'http://localhost:5173' }));
  assert.equal(url.origin + url.pathname, `https://www.youtube.com/embed/${V}`);
  assert.equal(url.searchParams.get('enablejsapi'), '1');
  assert.equal(url.searchParams.get('origin'), 'http://localhost:5173');
  assert.equal(url.searchParams.get('autoplay'), '0');

  const pl = new URL(buildEmbedUrl({ type: 'playlist', id: PL }));
  assert.equal(pl.pathname, '/embed/videoseries');
  assert.equal(pl.searchParams.get('list'), PL);
  assert.equal(pl.searchParams.has('origin'), false);

  const live = new URL(buildEmbedUrl({ type: 'channelLive', id: CH }, { origin: 'null' }));
  assert.equal(live.pathname, '/embed/live_stream');
  assert.equal(live.searchParams.get('channel'), CH);
  assert.equal(live.searchParams.has('origin'), false);

  assert.throws(() => buildEmbedUrl({ type: 'video', id: 'x' }));
});

test('buildWatchUrl e isValidSource', () => {
  assert.equal(buildWatchUrl({ type: 'video', id: V }), `https://www.youtube.com/watch?v=${V}`);
  assert.equal(buildWatchUrl({ type: 'playlist', id: PL }), `https://www.youtube.com/playlist?list=${PL}`);
  assert.equal(buildWatchUrl({ type: 'channelLive', id: CH }), `https://www.youtube.com/channel/${CH}/live`);
  assert.equal(isValidSource({ type: 'video', id: '../../etc' }), false);
  assert.equal(isValidSource(null), false);
});
