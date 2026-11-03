# 🍅🎧 lofi pomodoro

Temporizador **pomodoro** com **lembretes de pausa** e **música lofi do YouTube** que toca
durante o foco e **para sozinha quando começa a pausa**. Assim que abres a app, ela
recomenda logo uma rádio lofi longa (Lofi Girl, Chillhop…) adequada à hora do dia.

Sem contas, sem chave de API e sem dependências: é HTML, CSS e JavaScript puro.

## Funcionalidades

**Temporizador**
- Foco 25 min → pausa curta 5 min, e pausa longa de 15 min a cada 4 pomodoros (tudo configurável).
- A pausa começa sozinha no fim do foco. O regresso ao foco espera por ti (configurável).
- O tempo é medido pelo relógio e não por contagem, por isso continua certo com o separador em segundo plano.
- Se recarregares a página a meio de uma sessão, ela é recuperada.
- Estatísticas do dia: pomodoros concluídos e minutos de foco.

**Lembretes de pausa**
- Notificação do sistema quando o foco acaba ("Hora da pausa! ☕") e quando a pausa acaba.
- Sino suave (gerado no navegador), título do separador a piscar e aviso na página.
- Uma dica para cada pausa (alongar, beber água, regra 20-20-20…).
- **Lembrete repetido**: se o foco acabou e ainda não começaste a pausa, a app volta a
  lembrar-te a cada 5 min. O intervalo é configurável e `0` desliga.

**Música lofi (YouTube)**
- Toca quando o foco começa e para com fade-out quando começa a pausa (ou quando pausas o
  temporizador). No foco seguinte retoma no mesmo ponto, com fade-in.
- **Recomendação automática** de uma rádio/vídeo longo, com base na hora: estudo e jazz de
  manhã, synthwave à tarde, chill à noite e lofi para dormir de madrugada.
- 🎲 "Outra recomendação", filtros por estilo (Estudo, Jazz, Synthwave, Relaxar, Noturno) e lista de todas as rádios.
- Podes colar qualquer link do YouTube: vídeo, playlist, `youtu.be`, `/live/` ou o direto de um canal.
- Se um vídeo deixar de existir ou não puder ser incorporado, a app **salta sozinha para
  outra recomendação**. Em último caso usa a transmissão em direto atual do canal da
  Lofi Girl / Chillhop, que acompanha sempre o vídeo mais recente.
- Volume, estilo e escolhas ficam guardados.

**Extra**
- Pode ser instalada como app (PWA) no computador ou telemóvel.
- Tema escuro e claro (segue o sistema). Adapta-se ao telemóvel.
- Atalhos: `Espaço` iniciar/pausar · `R` recomeçar · `S` saltar fase · `N` outra música · `M` música on/off.

## Como usar

É preciso [Node.js](https://nodejs.org) 18 ou mais recente (só para o servidor local; não instala nada).

```bash
npm start
```

Abre **http://localhost:5173** e carrega em **Iniciar**.

> ⚠️ Não abras o `index.html` com duplo clique (`file://`). O leitor do YouTube recusa
> funcionar sem um endereço `http(s)://` e dá o "erro 153". Qualquer servidor estático
> serve, por exemplo `python3 -m http.server 5173`.

Na primeira vez, o navegador pede autorização para mostrar notificações. Aceita, para
receberes o lembrete da pausa mesmo com a app noutra janela. Em ⚙️ **Definições** tens
o botão "Testar lembrete".

### Publicar online (GitHub Pages)

Como é um site estático, pode ser publicado tal como está:

1. No GitHub, abre **Settings → Pages**.
2. Em *Source* escolhe **Deploy from a branch**, depois o ramo (ex.: `main`) e a pasta `/ (root)`.
3. A app fica em `https://<o-teu-utilizador>.github.io/lofi-pomodoro/`.

## Notas

- **Som automático:** os navegadores só deixam tocar som depois de um clique. Como carregas
  em *Iniciar*, a música arranca normalmente. Se ativares "começar o foco sozinho" e o
  navegador bloquear o som, aparece um botão **▶ Tocar música**.
- **Leitor visível:** as regras do YouTube não permitem esconder o leitor incorporado, por
  isso o vídeo fica à vista no cartão da música.
- **Rádios recomendadas:** estão em [`js/catalog.js`](js/catalog.js). As transmissões em
  direto às vezes são reiniciadas com um ID novo. Quando isso acontece, a app passa à
  seguinte sozinha, mas podes atualizar ou acrescentar entradas nesse ficheiro.
- **Privacidade:** tudo fica guardado só no teu navegador (`localStorage`). A única ligação
  externa é ao YouTube.

## Estrutura

```
index.html            interface
css/styles.css        estilos (tema escuro/claro, responsivo)
js/app.js             liga tudo: interface, temporizador, música, lembretes
js/timer.js           máquina de estados do pomodoro (sem DOM, testada)
js/catalog.js         rádios lofi e lógica de recomendação (testada)
js/youtube-url.js     interpretação de links do YouTube (testada)
js/youtube.js         leitor do YouTube com fade-in/fade-out
js/notify.js          notificações, sino e dicas de pausa
js/ticker.js          "batimento" num Web Worker (não abranda em segundo plano)
js/stats.js           estatísticas diárias (testadas)
sw.js                 service worker (instalar como app / abrir offline)
scripts/serve.mjs     servidor local sem dependências
tests/                testes (node --test)
```

## Testes

```bash
npm test
```
