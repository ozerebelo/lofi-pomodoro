// Testes de segurança da base de dados, num Postgres real (PGlite, em memória).
//
// Simulamos o essencial do ambiente Supabase (papéis anon/authenticated/
// service_role, esquema auth, auth.uid() e os privilégios largos que a Supabase
// dá por omissão) e aplicamos a migração tal como vai para produção.
// Depois tentamos tudo o que um utilizador malicioso tentaria.
//
// Requer `npm install` (dependência de desenvolvimento @electric-sql/pglite).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

let PGlite = null;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  /* sem dependências de desenvolvimento instaladas */
}
const skip = PGlite ? false : 'corre `npm install` para testar a base de dados';

const MIGRATIONS = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Como na Supabase: privilégios largos por omissão no esquema public.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let db;

before(async () => {
  if (!PGlite) return;
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.pt'), ('${B}', 'b@x.pt')`);
});

/** Executa `fn` como um utilizador autenticado (uid) ou como anónimo (uid = null). */
async function as(uid, fn) {
  await db.exec(`set request.jwt.claim.sub = '${uid ?? ''}'`);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.exec(`set request.jwt.claim.sub = ''`);
  }
}

const q = async (sql, params) => (await db.query(sql, params)).rows;

async function rejects(promise, pattern) {
  await assert.rejects(promise, (err) => {
    assert.match(err.message, pattern);
    return true;
  });
}

function session(overrides = {}) {
  const ended = new Date(Date.now() - 60_000);
  return {
    id: crypto.randomUUID(),
    started_at: new Date(ended.getTime() - 25 * 60_000).toISOString(),
    ended_at: ended.toISOString(),
    duration_sec: 1500,
    ...overrides,
  };
}

function insertSession(s) {
  return q(
    `insert into public.focus_sessions (id, started_at, ended_at, duration_sec)
     values ($1, $2, $3, $4) on conflict (id) do nothing`,
    [s.id, s.started_at, s.ended_at, s.duration_sec],
  );
}

test('registo cria perfil e plano grátis', { skip }, async () => {
  const rows = await as(A, () => q('select plan, status from public.subscriptions'));
  assert.deepEqual(rows, [{ plan: 'free', status: 'inactive' }]);
  assert.equal((await as(A, () => q('select id from public.profiles'))).length, 1);
});

test('anónimo não acede a nada', { skip }, async () => {
  for (const table of ['profiles', 'user_settings', 'focus_sessions', 'subscriptions']) {
    await as(null, () => rejects(q(`select * from public.${table}`), /permission denied/));
  }
  await as(null, () => rejects(q('select public.delete_my_account()'), /permission denied/));
  await as(null, () => rejects(insertSession(session()), /permission denied/));
});

test('cada utilizador só vê as suas definições', { skip }, async () => {
  await as(A, () =>
    q(`insert into public.user_settings (settings) values ('{"workMin":50}')
       on conflict (user_id) do update set settings = excluded.settings`),
  );
  await as(B, () => q(`insert into public.user_settings (settings) values ('{"workMin":30}')`));

  const mine = await as(A, () => q('select user_id, settings from public.user_settings'));
  assert.deepEqual(mine, [{ user_id: A, settings: { workMin: 50 } }]);

  // B tenta alterar/apagar as de A: RLS filtra, 0 linhas afetadas.
  await as(B, () => q(`update public.user_settings set settings = '{"hack":1}' where user_id = '${A}'`));
  await as(B, () => q(`delete from public.user_settings where user_id = '${A}'`));
  assert.deepEqual(await as(A, () => q('select settings from public.user_settings')), [
    { settings: { workMin: 50 } },
  ]);
});

test('não dá para escrever em nome de outro utilizador', { skip }, async () => {
  await as(A, () =>
    rejects(
      q(`insert into public.user_settings (user_id, settings) values ('${B}', '{}')`),
      /permission denied/,
    ),
  );
  await as(A, () =>
    rejects(
      q(
        `insert into public.focus_sessions (user_id, started_at, ended_at, duration_sec)
         values ('${B}', now() - interval '26 minutes', now() - interval '1 minute', 1500)`,
      ),
      /permission denied/,
    ),
  );
  await as(A, () =>
    rejects(q(`update public.user_settings set user_id = '${B}'`), /permission denied/),
  );
});

test('definições: só objetos JSON pequenos', { skip }, async () => {
  await as(A, () =>
    rejects(q(`update public.user_settings set settings = '[1,2]'`), /check constraint/),
  );
  const big = JSON.stringify({ x: 'a'.repeat(9000) });
  await as(A, () =>
    rejects(q(`update public.user_settings set settings = $1::jsonb`, [big]), /check constraint/),
  );
});

test('sessões: isolamento, idempotência e imutabilidade', { skip }, async () => {
  const s = session();
  await as(A, () => insertSession(s));
  await as(A, () => insertSession(s)); // reenvio da fila offline: ignorado
  assert.equal((await as(A, () => q('select id from public.focus_sessions'))).length, 1);
  assert.equal((await as(B, () => q('select id from public.focus_sessions'))).length, 0);

  // B não consegue "roubar" o id (conflito ignorado, não aparece para B)
  await as(B, () => insertSession({ ...session(), id: s.id }));
  assert.equal((await as(B, () => q('select id from public.focus_sessions'))).length, 0);

  // Sem UPDATE
  await as(A, () =>
    rejects(q('update public.focus_sessions set duration_sec = 14400'), /permission denied/),
  );
  // created_at é definido pelo servidor
  const [row] = await as(A, () => q('select created_at from public.focus_sessions'));
  assert.ok(Math.abs(new Date(row.created_at) - Date.now()) < 60_000);
});

test('sessões: validação no servidor', { skip }, async () => {
  const cases = [
    [{ duration_sec: 10 }, /check constraint/],
    [{ duration_sec: 99999 }, /check constraint/],
    [{ ended_at: new Date(Date.now() + 3_600_000).toISOString() }, /futuro/],
    [
      {
        started_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
        ended_at: new Date(Date.now() - 40 * 86_400_000 + 1_500_000).toISOString(),
      },
      /antiga/,
    ],
    [{ started_at: new Date().toISOString(), ended_at: new Date(Date.now() - 3_600_000).toISOString() }, /check constraint/],
  ];
  for (const [over, pattern] of cases) {
    await as(B, () => rejects(insertSession(session(over)), pattern));
  }
});

test('sessões: limite anti-abuso por hora', { skip }, async () => {
  const before = (await as(B, () => q('select count(*)::int as n from public.focus_sessions')))[0].n;
  for (let i = before; i < 60; i++) await as(B, () => insertSession(session()));
  await as(B, () => rejects(insertSession(session()), /Demasiadas/));
});

test('plano: o utilizador não se pode promover a premium', { skip }, async () => {
  await as(A, () =>
    rejects(q(`update public.subscriptions set plan = 'premium', status = 'active'`), /permission denied/),
  );
  await as(A, () =>
    rejects(q(`insert into public.subscriptions (user_id, plan) values ('${A}', 'premium')`), /permission denied/),
  );
  assert.deepEqual(await as(A, () => q('select public.is_premium() as p')), [{ p: false }]);

  // O servidor (service_role) pode.
  await db.exec('set role service_role');
  await q(`update public.subscriptions set plan = 'premium', status = 'active' where user_id = '${B}'`);
  await db.exec('reset role');
  assert.deepEqual(await as(B, () => q('select public.is_premium() as p')), [{ p: true }]);
  assert.deepEqual(await as(A, () => q('select public.is_premium() as p')), [{ p: false }]);
});

test('perfil: só o nome é editável, com limite', { skip }, async () => {
  await as(A, () => q(`update public.profiles set display_name = 'Zé'`));
  assert.deepEqual(await as(A, () => q('select display_name from public.profiles')), [{ display_name: 'Zé' }]);
  await as(A, () => rejects(q(`update public.profiles set display_name = $1`, ['x'.repeat(51)]), /check constraint/));
  await as(A, () => rejects(q(`update public.profiles set id = '${B}'`), /permission denied/));
  await as(A, () => rejects(q(`delete from public.profiles`), /permission denied/));
});

test('funções internas não estão expostas na API', { skip }, async () => {
  const priv = (role, fn) =>
    q(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]).then((r) => r[0].ok);
  for (const fn of ['public.handle_new_user()', 'public.validate_focus_session()', 'public.set_updated_at()']) {
    assert.equal(await priv('anon', fn), false, fn);
    assert.equal(await priv('authenticated', fn), false, fn);
  }
  assert.equal(await priv('anon', 'public.delete_my_account()'), false);
  assert.equal(await priv('anon', 'public.is_premium()'), false);
  assert.equal(await priv('authenticated', 'public.delete_my_account()'), true);
});

test('apagar conta: bloqueado com subscrição ativa, senão apaga tudo', { skip }, async () => {
  await as(B, () => rejects(q('select public.delete_my_account()'), /Cancela a subscrição/));

  await as(A, () => q('select public.delete_my_account()'));
  const left = await q(
    `select (select count(*) from auth.users where id = '${A}')::int as users,
            (select count(*) from public.profiles where id = '${A}')::int as profiles,
            (select count(*) from public.user_settings where user_id = '${A}')::int as settings,
            (select count(*) from public.focus_sessions where user_id = '${A}')::int as sessions,
            (select count(*) from public.subscriptions where user_id = '${A}')::int as subs`,
  );
  assert.deepEqual(left, [{ users: 0, profiles: 0, settings: 0, sessions: 0, subs: 0 }]);
  // B não foi afetado
  assert.equal((await q(`select count(*)::int as n from auth.users where id = '${B}'`))[0].n, 1);
});
