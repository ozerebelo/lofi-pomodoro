// Leitor do YouTube (IFrame Player API) com fade-in / fade-out.
//
// O leitor fica sempre visível na página: as regras do YouTube não permitem
// esconder o leitor incorporado, e assim também dá para ver o vídeo/animação.

import { buildEmbedUrl } from './youtube-url.js';

const API_SRC = 'https://www.youtube.com/iframe_api';
const FADE_IN_MS = 2500;
const FADE_OUT_MS = 1800;
const BLOCK_CHECK_MS = 3500;

export const YT_STATE = Object.freeze({
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
});

/** Códigos de erro do leitor que significam "este vídeo não dá aqui, tenta outro". */
export const SKIPPABLE_ERRORS = new Set([2, 5, 100, 101, 150]);
/** O YouTube recusa o leitor quando não recebe o "Referer" (ex.: página aberta via file://). */
export const REFERRER_ERROR = 153;

let apiPromise = null;

export function loadYouTubeApi(timeoutMs = 15_000) {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const fail = (err) => {
      clearTimeout(timer);
      apiPromise = null;
      script.remove();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => fail(new Error('network'));
    document.head.append(script);
  });
  return apiPromise;
}

export class MusicPlayer {
  /**
   * @param {HTMLElement} mount elemento onde o iframe é criado
   * @param {object} handlers
   */
  constructor(mount, handlers = {}) {
    this.mount = mount;
    this.handlers = handlers;
    this.player = null;
    this.ready = false;
    this.source = null;
    this.volume = 60;
    this.wantPlaying = false;
    this.fadeToken = 0;
    this.loadToken = 0;
    this.blockTimer = null;
  }

  emit(name, ...args) {
    const fn = this.handlers[name];
    if (typeof fn === 'function') fn(...args);
  }

  get state() {
    try {
      return this.player?.getPlayerState?.() ?? YT_STATE.UNSTARTED;
    } catch {
      return YT_STATE.UNSTARTED;
    }
  }

  get isPlaying() {
    const s = this.state;
    return s === YT_STATE.PLAYING || s === YT_STATE.BUFFERING;
  }

  /** Título do vídeo carregado (quando o YouTube o disponibiliza). */
  get videoTitle() {
    try {
      return this.player?.getVideoData?.()?.title || '';
    } catch {
      return '';
    }
  }

  /** Carrega uma fonte. Se a música "deve tocar", começa assim que estiver pronta. */
  async load(source) {
    const token = ++this.loadToken;
    this.emit('loading', source);
    const YT = await loadYouTubeApi();
    if (token !== this.loadToken) return;

    this.destroy();
    this.source = source;

    const iframe = document.createElement('iframe');
    iframe.id = `yt-player-${token}`;
    iframe.src = buildEmbedUrl(source, { origin: window.location.origin });
    iframe.title = 'Leitor de música lofi (YouTube)';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('allowfullscreen', '');
    this.mount.replaceChildren(iframe);

    this.player = new YT.Player(iframe, {
      events: {
        onReady: () => {
          if (token !== this.loadToken) return;
          this.ready = true;
          this.safe(() => this.player.setVolume(this.volume));
          this.emit('ready', source);
          if (this.wantPlaying) this.play({ fade: true });
        },
        onStateChange: (event) => {
          if (token !== this.loadToken) return;
          this.emit('stateChange', event.data);
          if (event.data === YT_STATE.ENDED) this.emit('ended');
        },
        onError: (event) => {
          if (token !== this.loadToken) return;
          this.emit('error', event.data, source);
        },
      },
    });
  }

  safe(fn) {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  /** Começa / retoma a música, com fade-in opcional. */
  play({ fade = true } = {}) {
    this.wantPlaying = true;
    if (!this.ready) return;
    const token = ++this.fadeToken;
    this.safe(() => this.player.setVolume(fade ? 0 : this.volume));
    this.safe(() => this.player.playVideo());
    if (fade) this.ramp(0, () => this.volume, FADE_IN_MS, token);
    this.watchForBlockedAutoplay(token);
  }

  /** Para a música (pausa, para retomar no mesmo ponto), com fade-out opcional. */
  pause({ fade = true } = {}) {
    this.wantPlaying = false;
    clearTimeout(this.blockTimer);
    if (!this.ready) return Promise.resolve();
    const token = ++this.fadeToken;
    const finish = () => {
      this.safe(() => this.player.pauseVideo());
      this.safe(() => this.player.setVolume(this.volume));
    };
    if (!fade || this.state !== YT_STATE.PLAYING) {
      finish();
      return Promise.resolve();
    }
    const from = this.safe(() => this.player.getVolume()) ?? this.volume;
    return this.ramp(from, () => 0, FADE_OUT_MS, token).then((completed) => {
      if (completed) finish();
    });
  }

  setVolume(volume) {
    this.volume = Math.min(100, Math.max(0, Math.round(volume)));
    // Durante um fade-in o valor é lido a cada passo; fora disso aplica já.
    if (this.ready && !this.fading) this.safe(() => this.player.setVolume(this.volume));
  }

  /**
   * Varia o volume ao longo do tempo. Baseado no tempo decorrido (e não no nº
   * de passos), por isso termina a horas mesmo com timers abrandados.
   * Resolve `true` se terminou, `false` se foi interrompido por outro comando.
   */
  ramp(from, getTarget, durationMs, token) {
    return new Promise((resolve) => {
      const start = performance.now();
      this.fading = true;
      const step = () => {
        if (token !== this.fadeToken || !this.ready) {
          if (token === this.fadeToken) this.fading = false;
          resolve(false);
          return;
        }
        const t = Math.min(1, (performance.now() - start) / durationMs);
        const eased = t * t * (3 - 2 * t);
        const value = from + (getTarget() - from) * eased;
        this.safe(() => this.player.setVolume(Math.round(value)));
        if (t >= 1) {
          this.fading = false;
          resolve(true);
        } else {
          setTimeout(step, 60);
        }
      };
      step();
    });
  }

  /**
   * Os navegadores podem bloquear o som automático sem um clique. Se a música
   * não arrancar, avisamos a interface para mostrar um botão "retomar".
   */
  watchForBlockedAutoplay(token) {
    clearTimeout(this.blockTimer);
    this.blockTimer = setTimeout(() => {
      if (token !== this.fadeToken || !this.wantPlaying) return;
      const s = this.state;
      if (s === YT_STATE.UNSTARTED || s === YT_STATE.PAUSED || s === YT_STATE.CUED) {
        this.emit('blocked');
      }
    }, BLOCK_CHECK_MS);
  }

  destroy() {
    clearTimeout(this.blockTimer);
    this.fadeToken++;
    this.fading = false;
    this.ready = false;
    if (this.player) this.safe(() => this.player.destroy());
    this.player = null;
    this.mount.replaceChildren();
  }
}
