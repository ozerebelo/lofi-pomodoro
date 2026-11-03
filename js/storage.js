// Acesso seguro ao localStorage (pode falhar em modo privado ou com o
// armazenamento bloqueado; nesse caso a app funciona na mesma, só não guarda).

const PREFIX = 'lofi-pomodoro:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
