// Lembretes: notificações do sistema, som (gerado com Web Audio, sem ficheiros)
// e título do separador a piscar quando a app não está visível.

export const BREAK_TIPS = [
  'Levanta-te e alonga as costas e os ombros.',
  'Bebe um copo de água. 💧',
  'Regra 20-20-20: olha para algo a 6 metros durante 20 segundos.',
  'Respira fundo 5 vezes, devagar.',
  'Dá uma volta curta — nem que seja até à janela.',
  'Afasta-te do ecrã: nada de redes sociais nesta pausa.',
  'Roda o pescoço e os pulsos com calma.',
  'Arruma uma coisa pequena à tua volta.',
];

export function randomTip(random = Math.random) {
  return BREAK_TIPS[Math.floor(random() * BREAK_TIPS.length)];
}

export class Notifier {
  constructor({ icon = 'icons/icon-192.png' } = {}) {
    this.icon = icon;
    this.audioCtx = null;
    this.flashTimer = null;
    this.getTitle = null;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.stopFlash();
    });
  }

  get supported() {
    return 'Notification' in window;
  }

  get permission() {
    return this.supported ? Notification.permission : 'unsupported';
  }

  async requestPermission() {
    if (!this.supported) return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }

  /** Tem de ser chamado num clique: os navegadores só deixam criar som após interação. */
  unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx ??= new Ctx();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    } catch {
      this.audioCtx = null;
    }
  }

  /** Mostra uma notificação do sistema. Devolve `true` se foi mostrada. */
  async show(title, body, { tag = 'lofi-pomodoro', requireInteraction = false } = {}) {
    if (this.permission !== 'granted') return false;
    const options = { body, tag, icon: this.icon, badge: this.icon, renotify: true, requireInteraction };

    // Via service worker funciona também em Android, onde `new Notification` não existe.
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg) {
        await reg.showNotification(title, options);
        return true;
      }
    } catch {
      /* tenta a alternativa abaixo */
    }
    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        n.close();
      };
      return true;
    } catch {
      return false;
    }
  }

  /** Pequeno sino: descendente para a pausa, ascendente para voltar ao foco. */
  chime(kind = 'break') {
    const ctx = this.audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const notes =
      kind === 'work'
        ? [523.25, 659.25, 783.99] // Dó5 Mi5 Sol5
        : kind === 'reminder'
          ? [659.25, 659.25]
          : [783.99, 659.25, 523.25];
    const start = ctx.currentTime + 0.05;
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const t = start + i * 0.24;
      for (const [mult, level] of [
        [1, 1],
        [2.01, 0.25],
        [3.98, 0.08],
      ]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + 1.7);
      }
    });
  }

  /**
   * Faz piscar o título do separador até a pessoa voltar à app.
   * `getTitle` devolve o título "normal" (ex.: o tempo restante), que vai
   * alternando com a mensagem.
   */
  flashTitle(message, getTitle) {
    if (!document.hidden) return;
    this.stopFlash();
    this.getTitle = getTitle;
    let on = false;
    this.flashTimer = setInterval(() => {
      on = !on;
      document.title = on ? message : this.getTitle();
    }, 1000);
  }

  get flashing() {
    return this.flashTimer != null;
  }

  stopFlash() {
    if (this.flashTimer == null) return;
    clearInterval(this.flashTimer);
    this.flashTimer = null;
    if (this.getTitle) document.title = this.getTitle();
  }

  vibrate() {
    try {
      navigator.vibrate?.([180, 80, 180]);
    } catch {
      /* sem vibração */
    }
  }
}
