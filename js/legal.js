// Preenche as páginas legais com os dados de js/config.js.
import { CONFIG } from './config.js';

const values = {
  controllerName: CONFIG.legal.controllerName,
  contactEmail: CONFIG.legal.contactEmail,
  lastUpdated: CONFIG.legal.lastUpdated,
};

for (const el of document.querySelectorAll('[data-config]')) {
  const value = values[el.dataset.config];
  if (!value) {
    el.textContent = '[a preencher em js/config.js]';
    el.classList.add('missing');
  } else if (el.dataset.config === 'contactEmail') {
    const a = document.createElement('a');
    a.href = `mailto:${value}`;
    a.textContent = value;
    el.replaceChildren(a);
  } else {
    el.textContent = value;
  }
}
