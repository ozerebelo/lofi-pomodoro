// Contas (Supabase Auth) e sincronização de dados.
//
// - A biblioteca da Supabase só é carregada quando é precisa (quem não usa
//   conta não descarrega nem contacta nada).
// - Login sem palavra-passe: código de 6 dígitos por email (ou link mágico),
//   com fluxo PKCE. Não há palavras-passe para roubar nem para reutilizar.
// - A app continua "local-first": tudo funciona sem conta; com conta, as
//   definições e as sessões de foco concluídas são sincronizadas.
// - As sessões vão para uma fila local (outbox) e são enviadas quando há
//   rede; o id gerado no cliente torna o reenvio idempotente.

import { CONFIG } from './config.js';
import * as store from './storage.js';

const LIB_URL = new URL('../vendor/supabase-js-2.118.0.umd.js', import.meta.url).href;
const OUTBOX_KEY = 'outbox';
const OUTBOX_MAX = 500;
const BATCH = 50;
// Erros de validação do servidor: a linha nunca vai ser aceite, descarta-se.
const PERMANENT_ERRORS = new Set(['22023', '23514', '23502', '22P02', '42501']);

export const accountsEnabled = Boolean(CONFIG.supabase.url && CONFIG.supabase.publishableKey);

function projectRef() {
  try {
    return new URL(CONFIG.supabase.url).hostname.split('.')[0];
  } catch {
    return '';
  }
}

/** Há uma sessão guardada neste navegador? (sem carregar a biblioteca) */
export function hasStoredSession() {
  if (!accountsEnabled) return false;
  try {
    return Boolean(localStorage.getItem(`sb-${projectRef()}-auth-token`));
  } catch {
    return false;
  }
}

/** O endereço atual é o regresso de um link de login? */
export function isAuthRedirect(url = window.location) {
  const params = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return params.has('code') || params.has('error_description') || hash.has('access_token') || hash.has('error_description');
}

let libPromise = null;
function loadLibrary() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  libPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LIB_URL;
    script.async = true;
    script.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('lib')));
    script.onerror = () => {
      libPromise = null;
      script.remove();
      reject(new Error('Não foi possível carregar o módulo de contas.'));
    };
    document.head.append(script);
  });
  return libPromise;
}

/** Normaliza erros da Supabase para mensagens em português. */
export function friendlyError(error) {
  const msg = String(error?.message || error || '');
  const status = error?.status;
  if (status === 429 || /rate limit|too many/i.test(msg)) {
    return 'Demasiados pedidos. Espera um minuto e tenta outra vez.';
  }
  if (/expired|invalid/i.test(msg) && /otp|token|code/i.test(msg)) {
    return 'Código inválido ou expirado. Pede um novo.';
  }
  if (/email/i.test(msg) && /invalid/i.test(msg)) return 'Esse email não parece válido.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sem ligação. Verifica a internet.';
  if (/Cancela a subscrição/.test(msg)) return msg;
  return 'Algo correu mal. Tenta outra vez daqui a pouco.';
}

export class Account {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.client = null;
    this.user = null;
    this.plan = null;
    this.initPromise = null;
    this.flushing = false;
  }

  get signedIn() {
    return Boolean(this.user);
  }

  /** Carrega a biblioteca e recupera a sessão (incluindo o regresso de um link). */
  init() {
    if (!accountsEnabled) return Promise.resolve(false);
    this.initPromise ??= (async () => {
      const lib = await loadLibrary();
      this.client = lib.createClient(CONFIG.supabase.url, CONFIG.supabase.publishableKey, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });

      const urlError = new URLSearchParams(window.location.search).get('error_description');
      this.client.auth.onAuthStateChange((event, session) => {
        const before = this.user?.id;
        this.user = session?.user ?? null;
        if (event === 'SIGNED_OUT') this.plan = null;
        // Adia: o SDK não deve receber chamadas dentro deste callback.
        setTimeout(() => {
          if (this.user && this.user.id !== before) this.flushOutbox();
          this.onChange(event);
        }, 0);
      });
      const { data } = await this.client.auth.getSession();
      this.user = data.session?.user ?? null;
      if (isAuthRedirect()) {
        // Tira o ?code=… do endereço (não fica no histórico nem nas estatísticas).
        window.history.replaceState(null, '', window.location.pathname);
      }
      if (urlError) throw new Error(urlError);
      return true;
    })();
    this.initPromise.catch(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  async sendCode(email) {
    await this.init();
    const redirect = window.location.origin + window.location.pathname;
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect, shouldCreateUser: true },
    });
    if (error) throw error;
  }

  async verifyCode(email, token) {
    await this.init();
    const { data, error } = await this.client.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
    this.user = data.user ?? data.session?.user ?? this.user;
    return this.user;
  }

  async signOut() {
    await this.init();
    await this.client.auth.signOut({ scope: 'local' });
    this.user = null;
    this.plan = null;
  }

  async fetchPlan() {
    if (!this.signedIn) return null;
    const { data, error } = await this.client
      .from('subscriptions')
      .select('plan, status, current_period_end')
      .maybeSingle();
    if (error) throw error;
    this.plan = data ?? { plan: 'free', status: 'inactive' };
    return this.plan;
  }

  // --- Definições -----------------------------------------------------------

  async pullSettings() {
    if (!this.signedIn) return null;
    const { data, error } = await this.client.from('user_settings').select('settings, updated_at').maybeSingle();
    if (error) throw error;
    return data;
  }

  async pushSettings(settings) {
    if (!this.signedIn) return null;
    const { data, error } = await this.client
      .from('user_settings')
      .upsert({ settings }, { onConflict: 'user_id' })
      .select('updated_at')
      .single();
    if (error) throw error;
    return data;
  }

  // --- Sessões de foco (fila offline) ----------------------------------------

  queueSession({ startedAt, endedAt, durationMs, kind = 'work' }) {
    if (!this.signedIn) return;
    const outbox = store.load(OUTBOX_KEY, []);
    const list = Array.isArray(outbox) ? outbox : [];
    list.push({
      id: crypto.randomUUID(),
      kind,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      duration_sec: Math.round(durationMs / 1000),
      owner: this.user.id,
    });
    store.save(OUTBOX_KEY, list.slice(-OUTBOX_MAX));
    this.flushOutbox();
  }

  async flushOutbox() {
    if (!this.signedIn || this.flushing || !navigator.onLine) return;
    this.flushing = true;
    try {
      for (;;) {
        const all = store.load(OUTBOX_KEY, []);
        // Só envia o que foi registado por esta conta (ex.: se trocaram de conta).
        const mine = all.filter((s) => s.owner === this.user.id).slice(0, BATCH);
        if (!mine.length) break;
        const rows = mine.map(({ owner, ...row }) => row);
        const { error } = await this.client
          .from('focus_sessions')
          .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
        if (error && !PERMANENT_ERRORS.has(error.code)) break; // tenta mais tarde
        const sent = new Set(mine.map((s) => s.id));
        store.save(
          OUTBOX_KEY,
          store.load(OUTBOX_KEY, []).filter((s) => !sent.has(s.id)),
        );
        if (error) break;
      }
    } finally {
      this.flushing = false;
    }
  }

  // --- RGPD -------------------------------------------------------------------

  /** Todos os dados da conta num objeto (direito de acesso / portabilidade). */
  async exportData() {
    if (!this.signedIn) throw new Error('Sem sessão.');
    const tables = ['profiles', 'user_settings', 'focus_sessions', 'subscriptions'];
    const out = {
      exportado_em: new Date().toISOString(),
      conta: { id: this.user.id, email: this.user.email, criada_em: this.user.created_at },
    };
    // A API devolve no máximo 1000 linhas por pedido: pede por páginas.
    const PAGE = 1000;
    for (const table of tables) {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.client
          .from(table)
          .select('*')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      out[table] = rows;
    }
    return out;
  }

  async deleteAccount() {
    if (!this.signedIn) throw new Error('Sem sessão.');
    const { error } = await this.client.rpc('delete_my_account');
    if (error) throw error;
    store.save(OUTBOX_KEY, []);
    await this.client.auth.signOut({ scope: 'local' });
    this.user = null;
    this.plan = null;
  }
}
