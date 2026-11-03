// Interface da conta: entrar com código por email, perfil, exportar, apagar.

import { friendlyError } from './account.js';
import * as store from './storage.js';

const $ = (sel, root = document) => root.querySelector(sel);
const RESEND_COOLDOWN_S = 60;

export function setupAccountUI({ account, showToast, track }) {
  const dialog = $('#accountDialog');
  const button = $('#btnAccount');
  const views = [...dialog.querySelectorAll('[data-view]')];
  let pendingEmail = '';
  let resendTimer = null;

  button.hidden = false;

  function show(view) {
    for (const v of views) v.hidden = v.dataset.view !== view;
    const focusTarget = dialog.querySelector(`[data-view="${view}"] input, [data-view="${view}"] button`);
    focusTarget?.focus();
  }

  function setBusy(form, busy) {
    for (const el of form.querySelectorAll('button, input')) el.disabled = busy;
  }

  function setError(view, message) {
    const el = dialog.querySelector(`[data-view="${view}"] .form-error`);
    el.textContent = message || '';
    el.hidden = !message;
  }

  function renderButton() {
    if (account.signedIn) {
      const email = account.user.email || '';
      button.textContent = email.charAt(0).toUpperCase() || '👤';
      button.title = `Conta: ${email}`;
      button.setAttribute('aria-label', `Conta (${email})`);
      button.classList.add('avatar');
    } else {
      button.textContent = 'Entrar';
      button.title = 'Entrar ou criar conta';
      button.setAttribute('aria-label', 'Entrar ou criar conta');
      button.classList.remove('avatar');
    }
  }

  async function renderProfile() {
    $('#accountEmail').textContent = account.user?.email ?? '';
    const pending = (store.load('outbox', []) || []).filter((s) => s.owner === account.user?.id).length;
    $('#accountSync').textContent = pending
      ? `${pending} sessão(ões) à espera de rede para sincronizar.`
      : 'Definições e sessões de foco sincronizadas.';
    $('#accountPlan').textContent = '…';
    try {
      const plan = await account.fetchPlan();
      $('#accountPlan').textContent =
        plan?.plan === 'premium' && ['active', 'trialing'].includes(plan.status) ? 'Premium ✨' : 'Grátis';
    } catch {
      $('#accountPlan').textContent = 'Grátis';
    }
  }

  async function open() {
    setError('email', '');
    setError('code', '');
    if (account.signedIn) {
      show('profile');
      renderProfile();
    } else {
      show(pendingEmail ? 'code' : 'email');
    }
    dialog.showModal();
    try {
      await account.init();
    } catch (err) {
      setError(account.signedIn ? 'profile' : 'email', friendlyError(err));
    }
  }

  function startResendCooldown() {
    const btn = $('#btnResendCode');
    let left = RESEND_COOLDOWN_S;
    clearInterval(resendTimer);
    btn.disabled = true;
    btn.textContent = `Reenviar código (${left}s)`;
    resendTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(resendTimer);
        btn.disabled = false;
        btn.textContent = 'Reenviar código';
      } else {
        btn.textContent = `Reenviar código (${left}s)`;
      }
    }, 1000);
  }

  // --- Eventos ---------------------------------------------------------------

  button.addEventListener('click', open);
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));

  $('#accountEmailForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = $('#accountEmailInput').value.trim().toLowerCase();
    if (!email) return;
    setError('email', '');
    setBusy(form, true);
    try {
      await account.sendCode(email);
      pendingEmail = email;
      $('#accountCodeEmail').textContent = email;
      $('#accountCodeInput').value = '';
      show('code');
      startResendCooldown();
    } catch (err) {
      setError('email', friendlyError(err));
    } finally {
      setBusy(form, false);
    }
  });

  $('#accountCodeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const token = $('#accountCodeInput').value.replace(/\D/g, '');
    if (token.length < 6) {
      setError('code', 'O código tem 6 dígitos.');
      return;
    }
    setError('code', '');
    setBusy(form, true);
    try {
      await account.verifyCode(pendingEmail, token);
      pendingEmail = '';
      clearInterval(resendTimer);
      track('conta_entrou');
      show('profile');
      renderProfile();
      renderButton();
    } catch (err) {
      setError('code', friendlyError(err));
    } finally {
      setBusy(form, false);
      if (!pendingEmail) $('#btnResendCode').disabled = false;
    }
  });

  $('#btnResendCode').addEventListener('click', async () => {
    if (!pendingEmail) return;
    setError('code', '');
    try {
      await account.sendCode(pendingEmail);
      startResendCooldown();
    } catch (err) {
      setError('code', friendlyError(err));
    }
  });

  $('#btnOtherEmail').addEventListener('click', () => {
    pendingEmail = '';
    clearInterval(resendTimer);
    show('email');
  });

  $('#btnSignOut').addEventListener('click', async () => {
    try {
      await account.signOut();
      dialog.close();
      showToast('Sessão terminada neste dispositivo.', { timeout: 4000 });
    } catch (err) {
      setError('profile', friendlyError(err));
    }
    renderButton();
  });

  $('#btnExport').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const data = await account.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lofi-pomodoro-dados-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError('profile', friendlyError(err));
    } finally {
      btn.disabled = false;
    }
  });

  const deleteInput = $('#deleteConfirm');
  deleteInput.addEventListener('input', () => {
    $('#btnDeleteAccount').disabled = deleteInput.value.trim().toUpperCase() !== 'APAGAR';
  });

  $('#btnDeleteAccount').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      await account.deleteAccount();
      deleteInput.value = '';
      dialog.close();
      renderButton();
      showToast('A tua conta e todos os dados associados foram apagados.', { timeout: 6000 });
    } catch (err) {
      setError('profile', friendlyError(err));
      btn.disabled = false;
    }
  });

  renderButton();
  return { renderButton, open };
}
