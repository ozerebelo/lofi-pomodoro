// =============================================================================
// Configuração da app — TUDO O QUE ESTÁ AQUI É PÚBLICO (vai para o navegador)
// =============================================================================
//
// ⚠️  NUNCA coloques aqui a chave "service_role" / "secret" da Supabase, nem
//     chaves de pagamentos ou de email. Essas só vivem no servidor
//     (Supabase Edge Functions / variáveis de ambiente). A chave pública
//     ("anon" ou "publishable") é segura de expor porque a base de dados está
//     protegida por Row Level Security (ver supabase/migrations/).
//     O teste tests/config.test.js falha se alguém colar aqui uma chave secreta.
//
// Campos vazios = funcionalidade desligada. A app funciona sem nenhum deles.
// Passo a passo em docs/CONFIGURACAO.md.

export const CONFIG = Object.freeze({
  supabase: Object.freeze({
    // Project Settings → API → Project URL (ex.: https://abcdefgh.supabase.co)
    url: '',
    // Project Settings → API Keys → "publishable" (sb_publishable_...) ou "anon public"
    publishableKey: '',
  }),

  analytics: Object.freeze({
    // '' (desligado) | 'umami' | 'vercel'
    provider: '',
    // Umami Cloud → Settings → Websites → Edit → Website ID
    umamiWebsiteId: '',
    umamiScriptUrl: 'https://cloud.umami.is/script.js',
  }),

  // Link de doações (Ko-fi, Buy Me a Coffee, GitHub Sponsors…)
  donateUrl: '',
  // Formulário de opinião (Tally, Google Forms…) ou mailto:
  feedbackUrl: '',

  // Aparece na política de privacidade e nos termos
  legal: Object.freeze({
    controllerName: '', // nome de quem é responsável pelos dados (tu ou a tua empresa)
    contactEmail: '', // email para questões de privacidade
    lastUpdated: '2026-11-03',
  }),
});
