# Configuração: Supabase, Vercel, domínio, estatísticas

Guia passo a passo para pôr a app em produção com contas. Os menus dos painéis
mudam de vez em quando, por isso alguns nomes podem estar ligeiramente diferentes.

> **Regra de ouro:** só há **um** ficheiro com configuração no código,
> [`js/config.js`](../js/config.js), e **tudo o que lá está é público**. As chaves
> secretas (Supabase `service_role` / `sb_secret_…`, SMTP, pagamentos) **nunca** vão
> para o repositório. Ficam nos painéis da Supabase e da Vercel. O teste
> `tests/config.test.js` falha se alguém colar uma chave secreta.

---

## 1. Supabase (base de dados e contas)

### 1.1 Criar o projeto
1. Cria conta em [supabase.com](https://supabase.com) → **New project**.
2. **Region:** escolhe uma região na **UE** (ex.: *Central EU (Frankfurt)*), por causa do RGPD.
3. **Database password:** gera uma forte e guarda-a num gestor de palavras-passe. A app
   não precisa dela.

> O plano gratuito da Supabase **pausa projetos após ~1 semana sem atividade** e não tem
> cópias de segurança que possas descarregar. Para utilizadores reais, considera o plano
> Pro quando houver tração.

### 1.2 Criar as tabelas e as regras de segurança
1. **SQL Editor** → **New query**.
2. Cola todo o conteúdo de
   [`supabase/migrations/20261103120000_init.sql`](../supabase/migrations/20261103120000_init.sql) → **Run**.
3. **Advisors → Security Advisor** → *Run*. Não deve haver avisos sobre as tabelas da app.

(Alternativa com a CLI: `supabase link --project-ref <ref>` e depois `supabase db push`.)

### 1.3 Autenticação
**Authentication → Sign In / Providers → Email**
- *Enable Email provider*: **ligado**
- *Confirm email*: **ligado**
- *Email OTP Expiration*: `3600` (1 hora) · *Email OTP Length*: `6`

**Authentication → URL Configuration**
- *Site URL*: o endereço final, ex.: `https://lofipomodoro.pt`
- *Redirect URLs* (um por linha):
  ```
  https://lofipomodoro.pt/
  https://<o-teu-projeto>.vercel.app/
  http://localhost:5173/
  ```
  Só estes endereços podem receber links de login. Isto impede que alguém use o
  teu projeto para enviar links que levam a outro site.

**Authentication → Emails → Templates**: a app aceita o **código de 6 dígitos**,
que funciona melhor no telemóvel e na app instalada, e o link. Põe os dois em
**Magic Link** e **Confirm signup**:

```html
<h2>O teu código de acesso ao lofi pomodoro</h2>
<p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>Ou <a href="{{ .ConfirmationURL }}">entra diretamente com este link</a> (abre-o no mesmo navegador onde pediste o código).</p>
<p>O código expira em 1 hora. Se não foste tu, ignora este email.</p>
```
Assuntos sugeridos: "O teu código de acesso: {{ .Token }}" (Magic Link) e "Confirma o teu email" (Confirm signup).

### 1.4 Email (SMTP) — obrigatório para utilizadores reais
O serviço de email incluído na Supabase serve só para testes: envia muito poucos
emails por hora e só para membros da equipa do projeto.

1. Cria conta num fornecedor de email transacional. Recomendo o **Resend**; o Brevo e o Postmark também servem.
2. Verifica lá o teu domínio (registos **SPF/DKIM** no DNS) para os emails não irem para o spam.
3. **Authentication → Emails → SMTP Settings** → *Enable custom SMTP*: anfitrião, porta,
   utilizador e palavra-passe dados pelo fornecedor. Remetente, por exemplo, `ola@lofipomodoro.pt`.
   **Esta palavra-passe fica só na Supabase.**
4. **Authentication → Rate Limits**: ajusta "emails por hora" ao limite do teu plano SMTP.

### 1.5 Ligar a app
**Project Settings → API Keys**: copia a **publishable key** (`sb_publishable_…`) ou, em
projetos mais antigos, a **anon public**. **Não** copies a *secret* nem a *service_role*.
**Project Settings → Data API** (ou *API*): copia o **Project URL**.

```js
// js/config.js
supabase: {
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_...',
},
```

Corre `npm test`: confirma que a chave é a pública.

### 1.6 (Opcional, recomendado mais tarde) CAPTCHA
Se aparecerem registos automáticos, ativa **Authentication → Attack Protection → CAPTCHA**
(Cloudflare Turnstile). Implica uma pequena alteração na app para mostrar o desafio.

---

## 2. Vercel (alojamento)

> ⚠️ **Plano Hobby (grátis) = só uso pessoal e não comercial.** Segundo as regras da
> Vercel, pedir pagamentos ou doações aos visitantes já conta como uso comercial. Assim que
> tiveres o link "Apoiar" ou um plano pago, precisas do **Vercel Pro** (~20 $/mês).
> A alternativa é a **Cloudflare Pages**, gratuita e com uso comercial permitido. Este
> projeto já traz o ficheiro `_headers` para ela: o alojamento muda sem tocar no código.

1. [vercel.com](https://vercel.com) → **Add New → Project** → importa `ozerebelo/lofi-pomodoro`.
2. *Framework Preset*: **Other**. Sem *Build Command*. *Output Directory*: a raiz (predefinição).
3. **Deploy.** O `vercel.json` aplica os cabeçalhos de segurança e o `.vercelignore` evita
   publicar testes, migrações e scripts.
4. *Settings → Git*: ramo de produção = `main`. Os outros ramos geram pré-visualizações.

### Domínio
*Settings → Domains → Add* → escreve o domínio e cria no teu registador os registos DNS que
a Vercel indicar (normalmente `A` para o domínio raiz e `CNAME` para `www`). O HTTPS é
automático. **Depois atualiza a Supabase** (Site URL e Redirect URLs, ponto 1.3).

### Verificar
- Abre o site, entra com o teu email e confirma que chega o código.
- [securityheaders.com](https://securityheaders.com) deve dar nota **A** ou **A+**.
- Na consola do navegador (F12) não deve haver erros "Refused to load…" (CSP).

---

## 3. Estatísticas anónimas (Umami)

1. Cria conta em [cloud.umami.is](https://cloud.umami.is) (há plano gratuito) → *Add website*
   com o teu domínio.
2. Copia o **Website ID** para `js/config.js`:
   ```js
   analytics: { provider: 'umami', umamiWebsiteId: '…', umamiScriptUrl: 'https://cloud.umami.is/script.js' },
   ```
3. Eventos enviados: `visita` (só intervalos: há quantos dias usas e em quantos dias),
   `pomodoro_concluido` (minutos), `musica_autorizada`, `musica_outra`, `link_colado` (tipo),
   `conta_entrou`, `doacao_clique` e `opiniao_clique`. Nenhum leva email, id ou datas.

O que vale a pena seguir na Fase 0: quantas pessoas voltam (`visita` com
`dias_desde_inicio` ≥ 2), pomodoros por visita e cliques em "Apoiar".

Alternativa: `provider: 'vercel'` e ativar *Analytics* no projeto da Vercel. É mais simples,
mas os eventos personalizados exigem o plano Pro.

---

## 4. Doações, opinião e textos legais

```js
donateUrl: 'https://ko-fi.com/<o-teu-nome>',   // ou Buy Me a Coffee / GitHub Sponsors
feedbackUrl: 'https://tally.so/r/<formulario>', // ou 'mailto:ola@lofipomodoro.pt'
legal: {
  controllerName: 'O teu nome (ou empresa) e país',
  contactEmail: 'privacidade@lofipomodoro.pt',
  lastUpdated: '2026-11-03',
},
```

As páginas [`privacidade.html`](../privacidade.html) e [`termos.html`](../termos.html) leem
estes dados. **Revê os textos antes de abrir contas ao público.** São uma boa base, mas não
substituem aconselhamento jurídico. Atualiza a tabela de fornecedores com os nomes reais
(por exemplo, o fornecedor de SMTP).

---

## 5. Lista de verificação antes de lançar
- [ ] Migração aplicada e Security Advisor sem avisos
- [ ] SMTP próprio configurado, domínio verificado (SPF/DKIM)
- [ ] Site URL e Redirect URLs com o domínio final
- [ ] `js/config.js` preenchido e `npm test` a passar
- [ ] Plano de alojamento compatível com uso comercial (se tiveres doações)
- [ ] Privacidade e termos revistos, com nome e contacto
- [ ] Teste completo em produção: entrar, concluir um pomodoro, exportar e apagar a conta
