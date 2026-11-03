# Segurança

Resumo de como a app está protegida, porquê, e o que **não** fazer.

## Arquitetura

```
Navegador (site estático na Vercel)
  ├─ YouTube (iframe)          ← só depois de consentimento
  ├─ Umami (estatísticas)      ← anónimo, sem cookies, opcional
  └─ Supabase
       ├─ Auth  (códigos por email, PKCE)
       └─ Postgres via API REST ← chave PÚBLICA + JWT do utilizador
                                   tudo filtrado por Row Level Security
```

Não há servidor próprio. A segurança dos dados está **na base de dados**: a chave pública
não dá acesso a nada por si só, e cada pedido é avaliado pelas políticas RLS com a
identidade do JWT do utilizador.

## O que é público e o que é secreto

| Público (pode estar no código) | Secreto (nunca no repositório) |
|---|---|
| URL do projeto Supabase | Chave `service_role` / `sb_secret_…` |
| Chave `anon` / `sb_publishable_…` | Palavra-passe da base de dados |
| Website ID do Umami | Credenciais SMTP |
| Links de doação/opinião | Chaves e segredos de webhooks de pagamentos |

Os secretos ficam nos painéis (Supabase → SMTP / Edge Function Secrets; Vercel →
Environment Variables). O teste `tests/config.test.js` procura chaves secretas em todos os
ficheiros do projeto. **Se uma chave secreta for publicada, roda-a de imediato** no painel
da Supabase. Não basta apagá-la do repositório: fica no histórico do git.

## Base de dados ([migração](../supabase/migrations/20261103120000_init.sql))

- **RLS em todas as tabelas.** Cada utilizador só lê e escreve as suas linhas
  (`user_id = auth.uid()`). O papel `anon` não tem acesso a nada.
- **Privilégios mínimos por coluna.** O cliente só pode inserir as colunas necessárias:
  não consegue escolher o `user_id` nem o `created_at`, nem alterar o id do perfil.
- **Plano/subscrição só escrito pelo servidor**: o utilizador não se pode promover a premium.
- **Validação no servidor**:
  - limites de duração e coerência de datas;
  - nada no futuro nem com mais de 30 dias;
  - tamanho máximo das definições (4 KB);
  - **limite anti-abuso** de 60 sessões por hora e por utilizador.
- **Sessões imutáveis** (sem `UPDATE`) e **idempotentes**: o id é gerado no cliente, por
  isso reenviar não duplica.
- **Funções `SECURITY DEFINER`** com `search_path` vazio, nomes totalmente qualificados e
  `EXECUTE` retirado a `PUBLIC`/`anon`. As funções de trigger não estão expostas na API.
- **RGPD**: `delete_my_account()` apaga o utilizador e, em cascata, todos os dados. Fica
  bloqueada se houver uma subscrição ativa, para não continuar a cobrar a quem já não tem conta.

Tudo isto é **testado num Postgres real** (`tests/db.test.js`, via PGlite): isolamento
entre utilizadores, acesso anónimo, escalada para premium, validações e apagar a conta.
Os testes foram validados com mutações: retirar o RLS, os `REVOKE` ou o limite faz falhar
os testes. **Qualquer migração nova deve vir com testes nesse ficheiro.**

## Autenticação

- **Sem palavras-passe**: código de 6 dígitos ou link por email. Não há palavras-passe para
  roubar, reutilizar ou adivinhar.
- **PKCE**: o link de login só funciona no navegador onde foi pedido.
- **Redirect URLs** limitadas aos domínios da app (configurado na Supabase).
- O `?code=` é retirado do endereço logo a seguir ao login, e as estatísticas só arrancam
  depois disso.
- A sessão fica no `localStorage`, como é normal num site estático, o que torna essencial
  impedir XSS (secção seguinte).

## Navegador

- **Content-Security-Policy** estrita ([`scripts/security-headers.mjs`](../scripts/security-headers.mjs)):
  - só scripts do próprio site, do YouTube e do Umami;
  - sem `unsafe-inline` nem `unsafe-eval`;
  - `frame-ancestors 'none'` contra clickjacking;
  - `object-src 'none'` e `base-uri 'self'`.
- **Sem `innerHTML`** com dados externos: todo o texto vindo de fora (títulos de vídeos,
  emails, erros) é escrito com `textContent`.
- **Links externos** validados (`https:`/`mailto:`) e abertos com `rel="noopener noreferrer"`.
- **Supabase-js incluída no projeto** (`vendor/`, versão fixa) em vez de vir de um CDN. Um
  CDN comprometido não chega à app, e a CSP pode ficar em `'self'`.
- Também se aplicam **HSTS**, `X-Content-Type-Options`, `Referrer-Policy` (necessária ao
  YouTube) e `Permissions-Policy` a negar câmara, microfone, localização e pagamentos.
- O servidor local aplica **os mesmos cabeçalhos**, por isso as violações da CSP aparecem
  em desenvolvimento.

## Privacidade (RGPD)

- O YouTube só é contactado **depois de consentimento**, e o consentimento pode ser
  retirado nas definições. Até lá não há pedidos à Google (nem `preconnect`).
- Estatísticas **sem cookies nem identificadores**. Respeitam "Do Not Track" e "Global
  Privacy Control" e podem ser desligadas.
- Exportar todos os dados (JSON) e apagar a conta estão na própria app.
- Base de dados numa região da UE (escolhida ao criar o projeto).

## Atualizar a biblioteca da Supabase

```bash
npm pack @supabase/supabase-js@<versão>
```
Extrai `package/dist/umd/supabase.js` para `vendor/supabase-js-<versão>.umd.js`, atualiza
o nome em `js/account.js` e em `sw.js`, e corre os testes. Escolhe versões publicadas há
pelo menos duas semanas.

## Fase 2 (pagamentos) — regras a seguir
- O webhook do fornecedor (Lemon Squeezy/Paddle/Stripe) corre numa **Supabase Edge
  Function**. O segredo do webhook e a `service_role` ficam em *Edge Function Secrets*.
- **Verificar a assinatura** de cada webhook antes de confiar no conteúdo, e tratar eventos
  repetidos de forma idempotente (usar o id do evento).
- O plano é escrito **só** pelo webhook na tabela `subscriptions`. As funcionalidades
  premium que dependem de dados no servidor devem verificar `public.is_premium()` nas
  políticas RLS, e não apenas na interface.
