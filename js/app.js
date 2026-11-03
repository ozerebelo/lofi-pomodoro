// Liga o temporizador, o leitor do YouTube, os lembretes e a interface.

import {
  PomodoroTimer,
  PHASE,
  STATUS,
  isBreak,
  formatTime,
  sanitizeSettings,
} from './timer.js';
import { CATALOG, MOODS, SLOT_LABEL, recommend, timeSlot, findEntry } from './catalog.js';
import { parseYouTubeInput, buildWatchUrl, isValidSource, sourceKey } from './youtube-url.js';
import { MusicPlayer, SKIPPABLE_ERRORS, REFERRER_ERROR, YT_STATE } from './youtube.js';
import { Notifier, randomTip } from './notify.js';
import { createTicker } from './ticker.js';
import { normalizeStats, recordPomodoro, formatFocus } from './stats.js';
import * as store from './storage.js';
import { CONFIG } from './config.js';
import { initAnalytics, disableAnalytics, track, trackDailyVisit, analyticsAvailable, privacySignal } from './analytics.js';
import { Account, accountsEnabled, hasStoredSession, isAuthRedirect, friendlyError } from './account.js';
import { setupAccountUI } from './account-ui.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const PHASE_LABEL = {
  [PHASE.WORK]: 'Foco',
  [PHASE.SHORT_BREAK]: 'Pausa curta',
  [PHASE.LONG_BREAK]: 'Pausa longa',
};
const FAILED_TTL_MS = 24 * 60 * 60 * 1000;
const APP_TITLE = 'lofi pomodoro';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let settings = sanitizeSettings(store.load('settings', {}));
let stats = normalizeStats(store.load('stats', null));
const musicPrefs = {
  volume: 60,
  mood: null,
  pinned: null, // { source, title, channel, key? } escolhido pelo utilizador
  ...store.load('music', {}),
};
if (musicPrefs.mood && !MOODS[musicPrefs.mood]) musicPrefs.mood = null;
if (musicPrefs.pinned && !isValidSource(musicPrefs.pinned.source)) musicPrefs.pinned = null;

/** Chaves do catálogo que falharam recentemente → { key: timestamp }. */
const failed = pruneFailed(store.load('failed', {}));

let current = null; // { key?, source, title, channel, reason }
let consecutiveFailures = 0;
let awaiting = null; // fase terminada à espera de o utilizador começar a seguinte
let currentTip = randomTip();
let lastRender = '';
/** Autorização para carregar o YouTube neste dispositivo: null = ainda não decidiu. */
let consent = { youtube: null, ...store.load('consent', {}) };
let accountUI = null;
let reconciledUser = null;
let pushTimer = null;
const account = new Account({ onChange: onAccountChange });

const timer = new PomodoroTimer({ settings });
const notifier = new Notifier();
const player = new MusicPlayer($('#player'), {
  loading: () => setPlayerStatus('A carregar o leitor…'),
  ready: onPlayerReady,
  stateChange: onPlayerStateChange,
  error: onPlayerError,
  ended: onPlayerEnded,
  blocked: onAutoplayBlocked,
});
player.volume = musicPrefs.volume;

function pruneFailed(map) {
  const now = Date.now();
  const out = {};
  for (const [key, ts] of Object.entries(map && typeof map === 'object' ? map : {})) {
    if (Number.isFinite(ts) && now - ts < FAILED_TTL_MS) out[key] = ts;
  }
  return out;
}

function saveMusicPrefs() {
  store.save('music', musicPrefs);
}

function saveTimer() {
  store.save('timer', timer.snapshot());
}

// ---------------------------------------------------------------------------
// Música
// ---------------------------------------------------------------------------

function shouldPlayMusic() {
  return settings.music && timer.phase === PHASE.WORK && timer.status === STATUS.RUNNING;
}

/** Põe a música de acordo com a fase: toca no foco, para nas pausas. */
function syncMusic() {
  if (!current) return;
  if (shouldPlayMusic()) {
    if (!consent.youtube) {
      promptYoutubeConsent();
      return;
    }
    hideToast('autoplay');
    player.play({ fade: settings.fadeMusic });
  } else {
    hideToast('autoplay');
    player.pause({ fade: settings.fadeMusic });
  }
}

function excludedKeys() {
  const keys = new Set(Object.keys(failed));
  if (current?.key) keys.add(current.key);
  return keys;
}

function useRecommendation({ announce = false } = {}) {
  const entry = recommend({
    hour: new Date().getHours(),
    mood: musicPrefs.mood,
    exclude: excludedKeys(),
  }) ?? recommend({ hour: new Date().getHours(), mood: musicPrefs.mood, exclude: Object.keys(failed) });

  if (!entry) {
    setPlayerStatus(
      'Nenhuma das rádios recomendadas está disponível agora. Cola um link do YouTube abaixo.',
      'error',
    );
    return;
  }
  setCurrent({ ...entry, reason: 'recommended' });
  if (announce) showToast(`🎧 ${entry.title}`, { id: 'music', timeout: 3500 });
}

function setCurrent(next) {
  current = {
    key: next.key ?? null,
    source: next.source,
    title: next.title || 'Vídeo do YouTube',
    channel: next.channel || '',
    reason: next.reason,
  };
  renderNowPlaying();
  renderStations();
  loadPlayer();
}

/** Carrega o leitor da música atual — só se houver autorização para o YouTube. */
function loadPlayer() {
  if (!current) return;
  player.wantPlaying = shouldPlayMusic();
  if (window.location.protocol === 'file:') {
    setPlayerStatus(
      'O YouTube não funciona com a página aberta como ficheiro (file://). Corre "npm start" e abre http://localhost:5173.',
      'error',
    );
    return;
  }
  if (!consent.youtube) {
    player.destroy();
    setPlayerStatus(null);
    $('#playerConsent').hidden = false;
    return;
  }
  $('#playerConsent').hidden = true;
  player.load(current.source).catch(() => {
    setPlayerStatus(
      'Não foi possível ligar ao YouTube. Verifica a ligação à internet ou bloqueadores de conteúdo.',
      'error',
      { retry: true },
    );
  });
}

// --- Consentimento (RGPD): o YouTube só é contactado depois de autorizado ----

function grantYoutube() {
  consent = { youtube: true, at: new Date().toISOString() };
  store.save('consent', consent);
  $('#consentYoutube').checked = true;
  hideToast('consent');
  track('musica_autorizada');
  loadPlayer(); // se o foco estiver a decorrer, a música começa assim que o leitor estiver pronto
}

function revokeYoutube() {
  consent = { youtube: false, at: new Date().toISOString() };
  store.save('consent', consent);
  hideToast('consent');
  loadPlayer(); // destrói o leitor e mostra o pedido de autorização
}

function promptYoutubeConsent() {
  // Quem recusou explicitamente não é incomodado; pode mudar nas definições.
  if (consent.youtube === false || !settings.music) return;
  showToast('Para ouvires música lofi durante o foco, autoriza o leitor do YouTube.', {
    id: 'consent',
    timeout: 15000,
    action: { label: '🎧 Ativar música', onClick: grantYoutube },
  });
}

function pickStation(key) {
  const entry = findEntry(key);
  if (!entry) return;
  delete failed[key];
  store.save('failed', failed);
  musicPrefs.pinned = { key: entry.key, source: entry.source, title: entry.title, channel: entry.channel };
  saveMusicPrefs();
  consecutiveFailures = 0;
  setCurrent({ ...entry, reason: 'picked' });
}

function onPlayerReady() {
  consecutiveFailures = 0;
  setPlayerStatus(null);
  // O título real do vídeo chega com os metadados; útil para links colados.
  setTimeout(refreshTitleFromPlayer, 1500);
}

function refreshTitleFromPlayer() {
  if (!current || current.reason !== 'custom') return;
  const title = player.videoTitle;
  if (title && title !== current.title) {
    current.title = title;
    if (musicPrefs.pinned) {
      musicPrefs.pinned.title = title;
      saveMusicPrefs();
    }
    renderNowPlaying();
  }
}

function onPlayerStateChange(state) {
  if (state === YT_STATE.PLAYING) {
    hideToast('autoplay');
    refreshTitleFromPlayer();
  }
  $('#nowPlaying').dataset.playing = String(state === YT_STATE.PLAYING);
}

function onPlayerError(code) {
  if (code === REFERRER_ERROR) {
    setPlayerStatus(
      'O YouTube recusou o leitor (erro 153). Abre a app através de um servidor (npm start) e não como ficheiro.',
      'error',
    );
    return;
  }
  if (!SKIPPABLE_ERRORS.has(code)) {
    setPlayerStatus(`O leitor do YouTube deu um erro (${code}).`, 'error', { retry: true });
    return;
  }

  consecutiveFailures++;
  const wasCustom = current?.reason !== 'recommended';
  if (current?.key) {
    failed[current.key] = Date.now();
    store.save('failed', failed);
  }
  if (wasCustom && musicPrefs.pinned) {
    musicPrefs.pinned = null;
    saveMusicPrefs();
  }
  if (consecutiveFailures > CATALOG.length + 1) {
    setPlayerStatus('Não foi possível reproduzir nenhuma rádio. Tenta colar outro link.', 'error');
    return;
  }
  showToast(
    wasCustom && !current?.key
      ? 'Esse vídeo não pode ser reproduzido fora do YouTube. A escolher uma recomendação…'
      : 'Este vídeo já não está disponível. A passar para outra recomendação…',
    { id: 'music', timeout: 4500 },
  );
  useRecommendation();
}

function onPlayerEnded() {
  // Vídeos longos (não diretos) acabam: passa para outra recomendação.
  if (!shouldPlayMusic()) return;
  if (current?.reason === 'recommended') useRecommendation({ announce: true });
  else player.play({ fade: false });
}

function onAutoplayBlocked() {
  showToast('O navegador bloqueou o som automático.', {
    id: 'autoplay',
    timeout: 0,
    action: {
      label: '▶ Tocar música',
      onClick: () => player.play({ fade: settings.fadeMusic }),
    },
  });
}

// ---------------------------------------------------------------------------
// Temporizador
// ---------------------------------------------------------------------------

timer.on('change', ({ reason }) => {
  if (reason === 'start' || reason === 'reset' || reason === 'phase') awaiting = null;
  if (reason !== 'settings') syncMusic();
  saveTimer();
  render(true);
});

timer.on('complete', ({ from, to, skipped, autoStarted, durationMs }) => {
  if (from === PHASE.WORK && !skipped) {
    stats = recordPomodoro(stats, durationMs);
    store.save('stats', stats);
    const endedAt = Date.now();
    account.queueSession({ startedAt: endedAt - durationMs, endedAt, durationMs });
    track('pomodoro_concluido', { minutos: Math.round(durationMs / 60_000) });
    setTimeout(maybeNudgeDonation, 4000);
  }
  if (isBreak(to)) currentTip = randomTip();
  awaiting = autoStarted ? null : { to, lastNag: Date.now() };
  if (!skipped) announcePhaseEnd(from, to, autoStarted);
  // A música é parada/retomada logo a seguir, no evento 'change' da nova fase
  // (mesmo quando a pausa não arranca sozinha, a música para no fim do foco).
});

function announcePhaseEnd(from, to, autoStarted) {
  let title;
  let body;
  if (from === PHASE.WORK) {
    const mins = to === PHASE.LONG_BREAK ? settings.longBreakMin : settings.shortBreakMin;
    title = to === PHASE.LONG_BREAK ? 'Pausa longa merecida! 🌿' : 'Hora da pausa! ☕';
    body = `${currentTip} ${autoStarted ? `Pausa de ${mins} min a decorrer.` : `Carrega em Iniciar para a pausa de ${mins} min.`}`;
    if (to === PHASE.LONG_BREAK) {
      body = `Completaste ${settings.longBreakEvery} pomodoros seguidos. ${body}`;
    }
  } else {
    title = 'Pausa terminada 🎧';
    body = autoStarted
      ? 'De volta ao foco — a música recomeça agora.'
      : 'Quando estiveres pronto, carrega em Iniciar para voltar ao foco.';
  }

  if (settings.sound) notifier.chime(from === PHASE.WORK ? 'break' : 'work');
  if (settings.notifications) notifier.show(title, body, { tag: 'phase', requireInteraction: !autoStarted });
  notifier.vibrate();
  notifier.flashTitle(title, currentTitle);
  showToast(`${title} ${body}`, { id: 'phase', timeout: 9000 });
}

/** Lembrete repetido enquanto uma fase terminada fica à espera de ser iniciada. */
function maybeNag() {
  if (!awaiting || timer.status !== STATUS.IDLE) return;
  const every = settings.reminderEveryMin;
  if (!every) return;
  const now = Date.now();
  if (now - awaiting.lastNag < every * 60_000) return;
  awaiting.lastNag = now;

  const breakPending = isBreak(awaiting.to);
  const title = breakPending ? 'Ainda não fizeste a pausa ⏸️' : 'A pausa já acabou ⏰';
  const body = breakPending
    ? `${currentTip} O teu cérebro agradece — começa a pausa.`
    : 'Pronto para mais um pomodoro? Carrega em Iniciar.';
  if (settings.sound) notifier.chime('reminder');
  if (settings.notifications) notifier.show(title, body, { tag: 'reminder' });
  notifier.flashTitle(title, currentTitle);
  showToast(`${title} ${body}`, { id: 'phase', timeout: 9000 });
}

function onTick() {
  if (timer.tick()) return; // a transição já renderizou
  maybeNag();
  render();
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

function currentTitle() {
  if (timer.status === STATUS.IDLE && !awaiting) return APP_TITLE;
  const time = formatTime(timer.getRemainingMs());
  const icon = timer.status === STATUS.PAUSED ? '⏸ ' : '';
  return `${icon}${time} · ${PHASE_LABEL[timer.phase]} — ${APP_TITLE}`;
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 120;

function render(force = false) {
  const remaining = timer.getRemainingMs();
  const time = formatTime(remaining);
  const key = `${time}|${timer.phase}|${timer.status}|${timer.completedInCycle}`;

  if (!notifier.flashing) {
    const title = currentTitle();
    if (document.title !== title) document.title = title;
  }

  // Anel de progresso: atualiza sempre (suave), o resto só quando muda.
  if (!document.hidden) {
    const offset = RING_CIRCUMFERENCE * (1 - timer.getProgress());
    $('#ringProgress').style.strokeDashoffset = offset.toFixed(2);
  }
  if (!force && key === lastRender) return;
  lastRender = key;

  document.body.dataset.phase = timer.phase;
  document.body.dataset.status = timer.status;
  $('#time').textContent = time;
  $('#phaseLabel').textContent = PHASE_LABEL[timer.phase];

  const btn = $('#btnStart');
  btn.textContent =
    timer.status === STATUS.RUNNING ? 'Pausar' : timer.status === STATUS.PAUSED ? 'Retomar' : 'Iniciar';
  btn.setAttribute('aria-pressed', String(timer.status === STATUS.RUNNING));

  for (const tab of $$('#phaseTabs [data-phase]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.phase === timer.phase));
  }

  const n = settings.longBreakEvery;
  const done = timer.completedInCycle;
  const dots = $('#cycleDots');
  if (dots.childElementCount !== n) {
    dots.replaceChildren(...Array.from({ length: n }, () => document.createElement('span')));
  }
  [...dots.children].forEach((dot, i) => {
    dot.className = i < done ? 'done' : i === done && timer.phase === PHASE.WORK ? 'current' : '';
  });
  const session = timer.phase === PHASE.WORK ? Math.min(done + 1, n) : done;
  $('#cycleText').textContent =
    timer.phase === PHASE.WORK
      ? `Sessão ${session} de ${n}`
      : timer.phase === PHASE.LONG_BREAK
        ? 'Ciclo completo'
        : `${done} de ${n} até à pausa longa`;

  const tip = $('#breakTip');
  tip.hidden = !isBreak(timer.phase);
  tip.querySelector('p').textContent = currentTip;

  $('#musicHint').textContent = !settings.music
    ? 'Música desligada'
    : timer.phase === PHASE.WORK
      ? timer.status === STATUS.RUNNING
        ? 'A tocar durante o foco'
        : 'Toca quando o foco começar'
      : 'Em pausa — volta no próximo foco';

  renderStats();
}

function renderStats() {
  stats = normalizeStats(stats); // recomeça a contagem à meia-noite
  $('#statPomodoros').textContent = String(stats.pomodoros);
  $('#statFocus').textContent = formatFocus(stats.focusMs);
}

function renderNowPlaying() {
  if (!current) return;
  $('#nowTitle').textContent = current.title;
  $('#nowChannel').textContent = current.channel || 'YouTube';
  const badge = $('#nowBadge');
  if (current.reason === 'recommended') {
    const moodLabel = musicPrefs.mood ? ` · ${MOODS[musicPrefs.mood]}` : '';
    badge.textContent = `Recomendado ${SLOT_LABEL[timeSlot(new Date().getHours())]}${moodLabel}`;
  } else if (current.reason === 'picked') {
    badge.textContent = 'Escolhido por ti';
  } else {
    badge.textContent = 'O teu link';
  }
  $('#openOnYoutube').href = buildWatchUrl(current.source);
}

function renderMoods() {
  const wrap = $('#moodChips');
  const options = [[null, 'Automático'], ...Object.entries(MOODS)];
  wrap.replaceChildren(
    ...options.map(([mood, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.dataset.mood = mood ?? '';
      b.setAttribute('aria-pressed', String((musicPrefs.mood ?? null) === mood));
      b.addEventListener('click', () => {
        musicPrefs.mood = mood;
        musicPrefs.pinned = null;
        saveMusicPrefs();
        renderMoods();
        consecutiveFailures = 0;
        useRecommendation({ announce: true });
      });
      return b;
    }),
  );
}

function renderStations() {
  const list = $('#stationList');
  list.replaceChildren(
    ...CATALOG.map((entry) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'station';
      const isCurrent = current && sourceKey(current.source) === sourceKey(entry.source);
      b.setAttribute('aria-current', String(Boolean(isCurrent)));
      if (failed[entry.key]) b.dataset.failed = 'true';

      const title = document.createElement('span');
      title.className = 'station-title';
      title.textContent = entry.title;
      const meta = document.createElement('span');
      meta.className = 'station-meta';
      const tags = entry.moods.map((m) => MOODS[m]).join(' · ');
      meta.textContent = `${entry.channel} — ${entry.length} — ${tags}${failed[entry.key] ? ' — indisponível' : ''}`;
      b.append(title, meta);
      b.addEventListener('click', () => pickStation(entry.key));
      li.append(b);
      return li;
    }),
  );
}

function setPlayerStatus(message, kind = 'info', { retry = false } = {}) {
  const el = $('#playerStatus');
  if (!message) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.dataset.kind = kind;
  el.querySelector('p').textContent = message;
  el.querySelector('button').hidden = !retry;
}

// --- Toasts ---------------------------------------------------------------

const toasts = new Map();

function showToast(text, { id = String(Math.random()), timeout = 5000, action = null } = {}) {
  hideToast(id);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const p = document.createElement('p');
  p.textContent = text;
  el.append(p);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-small';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      notifier.unlockAudio();
      action.onClick();
      hideToast(id);
    });
    el.append(b);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Fechar');
  close.textContent = '×';
  close.addEventListener('click', () => hideToast(id));
  el.append(close);
  $('#toasts').append(el);
  const handle = { el, timer: timeout ? setTimeout(() => hideToast(id), timeout) : null };
  toasts.set(id, handle);
}

function hideToast(id) {
  const t = toasts.get(id);
  if (!t) return;
  clearTimeout(t.timer);
  t.el.remove();
  toasts.delete(id);
}

// --- Notificações ----------------------------------------------------------

function renderNotificationState() {
  const banner = $('#notifBanner');
  const perm = notifier.permission;
  banner.hidden = !(settings.notifications && perm === 'default');
  const status = $('#notifStatus');
  status.textContent =
    perm === 'granted'
      ? 'Permitidas neste navegador.'
      : perm === 'denied'
        ? 'Bloqueadas pelo navegador — ativa-as nas definições do site (ícone do cadeado).'
        : perm === 'unsupported'
          ? 'Este navegador não suporta notificações; usamos som e avisos na página.'
          : 'Ainda não deste permissão.';
}

async function askNotifications() {
  await notifier.requestPermission();
  renderNotificationState();
}

// --- Definições -------------------------------------------------------------

const dialog = $('#settingsDialog');
const form = $('#settingsForm');

function openSettings() {
  for (const [key, value] of Object.entries(settings)) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  $('#consentYoutube').checked = Boolean(consent.youtube);
  const canAnalytics = analyticsAvailable() && !privacySignal();
  $('#analyticsOption').hidden = !canAnalytics;
  $('#analyticsHint').hidden = !canAnalytics;
  renderNotificationState();
  dialog.showModal();
}

form.addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'save') return;
  const data = { ...settings };
  for (const key of Object.keys(settings)) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    data[key] = input.type === 'checkbox' ? input.checked : input.value;
  }
  applySettings(data);
  settingsChanged();

  const wantYoutube = $('#consentYoutube').checked;
  if (wantYoutube && !consent.youtube) grantYoutube();
  else if (!wantYoutube && consent.youtube) revokeYoutube();

  if (settings.notifications) askNotifications();
  renderNotificationState();
});

/** Aplica definições (do formulário ou vindas da conta) e efeitos secundários. */
function applySettings(next) {
  const before = settings;
  settings = sanitizeSettings({ ...settings, ...next });
  store.save('settings', settings);
  timer.updateSettings(settings);
  syncMusicToggle();
  if (before.music !== settings.music) syncMusic();
  if (before.analytics && !settings.analytics) disableAnalytics();
  if (!before.analytics && settings.analytics) initAnalytics({ allowed: true });
  render(true);
}

/** Marca a alteração local e envia para a conta (com um pequeno atraso). */
function settingsChanged() {
  store.save('settingsUpdatedAt', Date.now());
  if (!account.signedIn) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      const saved = await account.pushSettings(settings);
      if (saved?.updated_at) store.save('settingsUpdatedAt', Date.parse(saved.updated_at));
    } catch {
      /* volta a tentar na próxima alteração ou no próximo login */
    }
  }, 1500);
}

// ---------------------------------------------------------------------------
// Conta
// ---------------------------------------------------------------------------

function onAccountChange() {
  accountUI?.renderButton();
  if (!account.signedIn) {
    reconciledUser = null;
    return;
  }
  if (reconciledUser === account.user.id) return;
  reconciledUser = account.user.id;
  reconcileSettings();
}

/** Ao entrar: fica a versão mais recente das definições (conta vs. dispositivo). */
async function reconcileSettings() {
  try {
    const remote = await account.pullSettings();
    const localStamp = Number(store.load('settingsUpdatedAt', 0)) || 0;
    const remoteStamp = remote ? Date.parse(remote.updated_at) : 0;
    if (remote && remoteStamp > localStamp) {
      applySettings(remote.settings);
      store.save('settingsUpdatedAt', remoteStamp);
    } else {
      const saved = await account.pushSettings(settings);
      if (saved?.updated_at) store.save('settingsUpdatedAt', Date.parse(saved.updated_at));
    }
  } catch {
    /* sem rede: fica para o próximo login/arranque */
  }
}

// --- Doações e opinião -------------------------------------------------------

function safeExternalUrl(url) {
  try {
    return ['https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function setupLinks() {
  const links = [
    ['#donateLink', CONFIG.donateUrl, 'doacao_clique'],
    ['#donateFooterLink', CONFIG.donateUrl, 'doacao_clique'],
    ['#feedbackLink', CONFIG.feedbackUrl, 'opiniao_clique'],
  ];
  for (const [sel, url, event] of links) {
    if (!safeExternalUrl(url)) continue;
    const el = $(sel);
    el.href = url;
    el.hidden = false;
    el.addEventListener('click', () => track(event));
  }
}

const DONATION_MILESTONES = [10, 50, 150];

/** Lembrete simpático (uma vez por marco) para apoiar o projeto. */
function maybeNudgeDonation() {
  if (!safeExternalUrl(CONFIG.donateUrl)) return;
  const seen = store.load('nudges', []);
  const shown = Array.isArray(seen) ? seen : [];
  const milestone = DONATION_MILESTONES.find((m) => stats.totalPomodoros >= m && !shown.includes(m));
  if (!milestone) return;
  store.save('nudges', [...shown, milestone]);
  showToast(
    `🍅 Já fizeste ${stats.totalPomodoros} pomodoros com o lofi pomodoro! Se te está a ajudar, considera apoiar o projeto.`,
    {
      id: 'nudge',
      timeout: 15000,
      action: {
        label: '☕ Apoiar',
        onClick: () => {
          track('doacao_clique', { origem: 'lembrete' });
          window.open(CONFIG.donateUrl, '_blank', 'noopener,noreferrer');
        },
      },
    },
  );
}

$('#btnTestAlert').addEventListener('click', async () => {
  notifier.unlockAudio();
  await askNotifications();
  notifier.chime('break');
  const shown = await notifier.show('Teste de lembrete ☕', 'É assim que vais saber que está na hora da pausa.', {
    tag: 'test',
  });
  if (!shown) showToast('Som tocado. As notificações do sistema não estão permitidas.', { timeout: 4000 });
});

function syncMusicToggle() {
  $('#musicToggle').checked = settings.music;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function userGesture() {
  notifier.unlockAudio();
  notifier.stopFlash();
}

$('#btnStart').addEventListener('click', () => {
  userGesture();
  if (settings.notifications && notifier.permission === 'default') askNotifications();
  timer.toggle();
});

$('#btnReset').addEventListener('click', () => {
  userGesture();
  timer.reset();
});

$('#btnSkip').addEventListener('click', () => {
  userGesture();
  timer.skip();
});

for (const tab of $$('#phaseTabs [data-phase]')) {
  tab.addEventListener('click', () => {
    if (tab.dataset.phase === timer.phase) return;
    if (
      timer.status !== STATUS.IDLE &&
      !window.confirm('Mudar de fase reinicia o temporizador atual. Continuar?')
    ) {
      return;
    }
    userGesture();
    timer.setPhase(tab.dataset.phase);
  });
}

$('#musicToggle').addEventListener('change', (event) => {
  applySettings({ music: event.target.checked });
  settingsChanged();
});

$('#btnNextRec').addEventListener('click', () => {
  userGesture();
  track('musica_outra');
  musicPrefs.pinned = null;
  saveMusicPrefs();
  consecutiveFailures = 0;
  useRecommendation({ announce: true });
});

$('#volume').addEventListener('input', (event) => {
  musicPrefs.volume = Number(event.target.value);
  player.setVolume(musicPrefs.volume);
});
$('#volume').addEventListener('change', saveMusicPrefs);

$('#urlForm').addEventListener('submit', (event) => {
  event.preventDefault();
  userGesture();
  const input = $('#urlInput');
  const source = parseYouTubeInput(input.value);
  if (!source) {
    input.setCustomValidity('Não reconheci esse link. Usa um link de vídeo, playlist ou canal do YouTube.');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  input.value = '';
  const known = CATALOG.find((e) => sourceKey(e.source) === sourceKey(source));
  if (known) {
    pickStation(known.key);
    return;
  }
  const title =
    source.type === 'playlist'
      ? 'Playlist do YouTube'
      : source.type === 'channelLive'
        ? 'Transmissão em direto do canal'
        : 'Vídeo do YouTube';
  track('link_colado', { tipo: source.type });
  musicPrefs.pinned = { source, title, channel: 'YouTube' };
  saveMusicPrefs();
  consecutiveFailures = 0;
  setCurrent({ source, title, channel: 'YouTube', reason: 'custom' });
});
$('#urlInput').addEventListener('input', (event) => event.target.setCustomValidity(''));

$('#btnConsentYoutube').addEventListener('click', () => {
  userGesture();
  grantYoutube();
});

$('#playerStatus button').addEventListener('click', () => {
  if (current) setCurrent(current);
  else useRecommendation();
});

$('#btnSettings').addEventListener('click', openSettings);
$('#btnEnableNotif').addEventListener('click', () => {
  userGesture();
  askNotifications();
});
$('#btnDismissNotif').addEventListener('click', () => {
  $('#notifBanner').hidden = true;
});

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')) return;

  const key = event.key.toLowerCase();
  if (key === ' ' || key === 'k') {
    if (target instanceof HTMLButtonElement && key === ' ') return; // espaço já "clica" no botão
    event.preventDefault();
    $('#btnStart').click();
  } else if (key === 'r') {
    $('#btnReset').click();
  } else if (key === 's') {
    $('#btnSkip').click();
  } else if (key === 'n') {
    $('#btnNextRec').click();
  } else if (key === 'm') {
    $('#musicToggle').click();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveTimer();
  else {
    onTick();
    render(true);
  }
});
window.addEventListener('pagehide', saveTimer);

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function boot() {
  $('#volume').value = String(musicPrefs.volume);
  syncMusicToggle();
  renderMoods();
  renderStations();
  renderNotificationState();

  const finishedWhileAway = timer.restore(store.load('timer', null));
  if (finishedWhileAway) {
    showToast('A fase anterior terminou enquanto a app estava fechada.', { timeout: 6000 });
  } else if (timer.status === STATUS.PAUSED) {
    showToast('Sessão anterior recuperada — carrega em Retomar para continuar.', { timeout: 6000 });
  }

  // A app recomenda logo uma rádio (ou usa a que a pessoa escolheu antes).
  const pinned = musicPrefs.pinned;
  if (pinned && !(pinned.key && failed[pinned.key])) {
    setCurrent({ ...pinned, reason: pinned.key ? 'picked' : 'custom' });
  } else {
    useRecommendation();
  }

  render(true);
  createTicker(onTick, 250);
  setupLinks();
  bootAccountAndAnalytics();
  window.addEventListener('online', () => account.flushOutbox());

  if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function bootAccountAndAnalytics() {
  // Se viemos de um link de login, primeiro troca-se o ?code= pela sessão e
  // limpa-se o endereço; só depois arrancam as estatísticas.
  const authRedirect = isAuthRedirect();
  let ready = Promise.resolve();

  if (accountsEnabled) {
    accountUI = setupAccountUI({ account, showToast, track });
    if (authRedirect || hasStoredSession()) {
      ready = account
        .init()
        .then(() => {
          accountUI.renderButton();
          if (authRedirect && account.signedIn) {
            showToast('Sessão iniciada ✨ As tuas definições e sessões ficam sincronizadas.', { timeout: 5000 });
          } else if (authRedirect) {
            // Com PKCE o link só funciona no navegador onde foi pedido.
            showToast(
              'Este link de acesso é inválido, expirou ou foi aberto noutro navegador. Pede um código novo em "Entrar".',
              { timeout: 9000 },
            );
          }
        })
        .catch((err) => showToast(friendlyError(err), { timeout: 6000 }));
    }
  }

  ready.finally(() => {
    if (authRedirect) window.history.replaceState(null, '', window.location.pathname);
    if (initAnalytics({ allowed: settings.analytics })) trackDailyVisit();
  });
}

boot();
