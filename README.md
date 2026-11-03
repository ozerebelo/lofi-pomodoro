# 🍅🎧 lofi pomodoro

Temporizador **pomodoro** com **lembretes de pausa** e **música lofi do YouTube** que toca
durante o foco e **para sozinha quando começa a pausa**. Assim que abres a app, ela
recomenda logo uma rádio lofi longa (Lofi Girl, Chillhop…) adequada à hora do dia.

É HTML, CSS e JavaScript puro, sem passo de compilação. Funciona sem conta. Com conta
(opcional, via Supabase), as definições e o histórico sincronizam entre dispositivos.

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

**Conta e privacidade**
- Conta opcional **sem palavra-passe**: entras com um código de 6 dígitos enviado por email.
- As definições e as sessões de foco concluídas sincronizam entre dispositivos (com fila offline).
- O YouTube **só é carregado depois de autorizares** (RGPD). Podes retirar a autorização nas definições.
- Estatísticas de utilização anónimas e sem cookies (Umami). Podes desligá-las e respeitam
  "Do Not Track".
- Exportar todos os teus dados (JSON) e apagar a conta, na própria app.
- Páginas de [privacidade](privacidade.html) e [termos](termos.html), e links de doação e de opinião.

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

### Publicar online e ativar contas

Sem configuração, a app funciona como site estático em qualquer alojamento (já está no
GitHub Pages). Para contas, estatísticas e o domínio próprio na Vercel, segue
**[docs/CONFIGURACAO.md](docs/CONFIGURACAO.md)**. Tudo se liga em
[`js/config.js`](js/config.js), e os campos vazios mantêm a funcionalidade desligada.

A segurança (RLS, cabeçalhos, chaves) está explicada em **[docs/SEGURANCA.md](docs/SEGURANCA.md)**.

## Notas

- **Som automático:** os navegadores só deixam tocar som depois de um clique. Como carregas
  em *Iniciar*, a música arranca normalmente. Se ativares "começar o foco sozinho" e o
  navegador bloquear o som, aparece um botão **▶ Tocar música**.
- **Leitor visível:** as regras do YouTube não permitem esconder o leitor incorporado, por
  isso o vídeo fica à vista no cartão da música.
- **Rádios recomendadas:** estão em [`js/catalog.js`](js/catalog.js). As transmissões em
  direto às vezes são reiniciadas com um ID novo. Quando isso acontece, a app passa à
  seguinte sozinha, mas podes atualizar ou acrescentar entradas nesse ficheiro.
- **Privacidade:** sem conta, tudo fica no teu navegador (`localStorage`). As ligações
  externas (YouTube, estatísticas, Supabase) só existem quando as autorizas ou configuras.

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
js/config.js          configuração PÚBLICA (Supabase, estatísticas, links, dados legais)
js/account.js         contas (Supabase Auth) + sincronização com fila offline
js/account-ui.js      interface da conta (entrar, exportar, apagar)
js/analytics.js       estatísticas anónimas (Umami / Vercel)
js/legal.js           preenche as páginas legais a partir da config
vendor/               supabase-js (versão fixa, incluída no projeto)
privacidade.html      política de privacidade
termos.html           termos de utilização
sw.js                 service worker (instalar como app / abrir offline)
supabase/migrations/  esquema da base de dados + regras de segurança (RLS)
scripts/serve.mjs     servidor local (com os mesmos cabeçalhos de segurança da produção)
scripts/security-headers.mjs  CSP e cabeçalhos; `npm run headers` gera vercel.json e _headers
docs/                 configuração e segurança
tests/                testes (node --test), incluindo segurança da base de dados
```

## Testes

```bash
npm install
```
```bash
npm test
```

O `npm install` só instala o PGlite, um Postgres que corre dentro do Node. Os testes
aplicam a migração real e tentam ataques: ler dados de outra pessoa, promover-se a
premium, escrever em nome de outro utilizador ou abusar dos limites. Sem `npm install`,
esses testes são ignorados e os restantes correm na mesma.
