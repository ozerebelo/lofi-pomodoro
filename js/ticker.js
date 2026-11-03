// "Batimento" periódico para o temporizador.
//
// Os navegadores abrandam muito os setInterval de separadores em segundo plano
// (o Chrome chega a executá-los só uma vez por minuto). Durante as pausas a
// música está parada, por isso a página fica "silenciosa" e sujeita a esse
// abrandamento — o alerta de fim de pausa podia chegar um minuto atrasado.
// Os timers dentro de um Web Worker não sofrem esse abrandamento, por isso o
// batimento vem de um worker, com setInterval normal como alternativa.

const WORKER_SOURCE = `
let id = null;
onmessage = (e) => {
  clearInterval(id);
  if (e.data > 0) id = setInterval(() => postMessage(0), e.data);
};
`;

export function createTicker(onTick, intervalMs = 250) {
  let worker = null;
  let intervalId = null;

  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = () => onTick();
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      intervalId ??= setInterval(onTick, intervalMs);
    };
    worker.postMessage(intervalMs);
  } catch {
    worker = null;
    intervalId = setInterval(onTick, intervalMs);
  }

  return {
    stop() {
      worker?.terminate();
      worker = null;
      if (intervalId != null) clearInterval(intervalId);
      intervalId = null;
    },
  };
}
