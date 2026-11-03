-- =============================================================================
-- lofi pomodoro — esquema inicial (contas, definições, sessões, subscrições)
-- =============================================================================
--
-- Modelo de segurança
-- -------------------
-- * A app corre no navegador e fala diretamente com a Supabase usando a chave
--   PÚBLICA (anon / publishable). Essa chave não dá acesso a nada por si só:
--   tudo o que o utilizador pode ler ou escrever é decidido AQUI, por
--   Row Level Security (RLS) + privilégios por coluna.
-- * Regra geral: cada utilizador só vê e altera as SUAS linhas
--   (user_id = auth.uid()). O papel `anon` (sem sessão) não tem acesso a nada.
-- * Dados que valem dinheiro (plano/subscrição) só podem ser escritos pelo
--   servidor (papel service_role, usado no webhook de pagamentos — Fase 2).
-- * Nunca confiar no cliente: limites e validações estão em CHECKs e triggers.
-- * Funções SECURITY DEFINER têm search_path vazio e nomes qualificados, e o
--   EXECUTE é retirado a PUBLIC (por omissão o Postgres dá-o a toda a gente).
--
-- Aplicar: Supabase → SQL Editor → colar este ficheiro → Run
--          (ou `supabase db push` com a CLI).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfis (1 por utilizador, criado automaticamente no registo)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 50),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Definições da app (sincronizadas entre dispositivos)
-- -----------------------------------------------------------------------------
create table public.user_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb
             check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096),
  updated_at timestamptz not null default now()
);

create trigger user_settings_updated_at
  before insert or update on public.user_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Sessões de foco concluídas (base do histórico e das estatísticas)
-- -----------------------------------------------------------------------------
create table public.focus_sessions (
  -- O id é gerado no cliente: permite reenviar sem duplicar (fila offline).
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null default 'work' check (kind in ('work', 'short_break', 'long_break')),
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  duration_sec integer not null check (duration_sec between 60 and 14400),
  created_at   timestamptz not null default now(),
  constraint focus_sessions_time_order check (ended_at >= started_at)
);

create index focus_sessions_user_ended_idx on public.focus_sessions (user_id, ended_at desc);

-- Validações que dependem do relógio ficam num trigger (num CHECK, now()
-- tornaria a reposição de backups imprevisível) + limite anti-abuso.
create or replace function public.validate_focus_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  recent integer;
begin
  if new.ended_at > now() + interval '5 minutes' then
    raise exception 'A sessão termina no futuro.' using errcode = '22023';
  end if;
  if new.ended_at < now() - interval '30 days' then
    raise exception 'A sessão é demasiado antiga.' using errcode = '22023';
  end if;

  new.created_at := now();

  -- Corre com os privilégios de quem insere (RLS ativo): só conta as próprias.
  select count(*) into recent
  from public.focus_sessions
  where user_id = new.user_id
    and created_at > now() - interval '1 hour';
  if recent >= 60 then
    raise exception 'Demasiadas sessões numa hora.' using errcode = '54000';
  end if;

  return new;
end;
$$;

create trigger focus_sessions_validate
  before insert on public.focus_sessions
  for each row execute function public.validate_focus_session();

-- -----------------------------------------------------------------------------
-- Subscrições / plano (escrito SÓ pelo servidor — webhook de pagamentos)
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  plan                     text not null default 'free' check (plan in ('free', 'premium')),
  status                   text not null default 'inactive'
                           check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
  provider                 text check (provider in ('lemonsqueezy', 'paddle', 'stripe')),
  provider_customer_id     text,
  provider_subscription_id text unique,
  current_period_end       timestamptz,
  updated_at               timestamptz not null default now()
);

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- O utilizador atual tem plano pago ativo? (útil para políticas de funcionalidades premium)
create or replace function public.is_premium()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = (select auth.uid())
      and s.plan = 'premium'
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

-- -----------------------------------------------------------------------------
-- Registo: cria perfil + linha de plano grátis para cada novo utilizador
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.subscriptions (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- RGPD: apagar a própria conta (e, em cascata, todos os dados)
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  -- Evita apagar alguém que continuaria a ser cobrado.
  if exists (
    select 1 from public.subscriptions
    where user_id = uid and status in ('active', 'trialing', 'past_due')
  ) then
    raise exception 'Cancela a subscrição antes de apagar a conta.' using errcode = 'P0001';
  end if;

  delete from auth.users where id = uid;
end;
$$;

-- =============================================================================
-- Privilégios (defesa em profundidade: RLS + GRANTs mínimos)
-- =============================================================================

-- A Supabase dá, por omissão, todos os privilégios a anon/authenticated nas
-- tabelas do esquema public. Retiramos tudo e damos só o necessário.
revoke all on table public.profiles, public.user_settings, public.focus_sessions, public.subscriptions
  from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

grant select, delete on table public.user_settings to authenticated;
grant insert (settings), update (settings) on table public.user_settings to authenticated;

grant select, delete on table public.focus_sessions to authenticated;
grant insert (id, kind, started_at, ended_at, duration_sec) on table public.focus_sessions to authenticated;

grant select on table public.subscriptions to authenticated;

-- Funções: ninguém chama triggers diretamente; só utilizadores autenticados
-- podem usar as funções da API.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.validate_focus_session() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_premium() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.is_premium() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.subscriptions enable row level security;

-- (select auth.uid()) em vez de auth.uid(): avaliado uma vez por consulta.

create policy "profiles: ler o próprio" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: alterar o próprio" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "settings: ler as próprias" on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "settings: criar as próprias" on public.user_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "settings: alterar as próprias" on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "settings: apagar as próprias" on public.user_settings
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "sessions: ler as próprias" on public.focus_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "sessions: criar as próprias" on public.focus_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "sessions: apagar as próprias" on public.focus_sessions
  for delete to authenticated using (user_id = (select auth.uid()));
-- Sem política de UPDATE: as sessões registadas não se alteram.

create policy "subscriptions: ler a própria" on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
-- Sem políticas de escrita: só o service_role (que ignora RLS) altera planos.
