-- Meme Journal — schéma initial (Postgres / Supabase)
-- Toutes les tables ont la RLS activée SANS policy : seules les connexions serveur
-- (rôle postgres via le pooler) y ont accès ; la clé "anon" publique ne voit rien.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Réglages (une seule ligne, modifiable depuis la page Réglages)
-- ---------------------------------------------------------------------------
create table settings (
  id          smallint primary key default 1 check (id = 1),
  config      jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Passages du pipeline (un par journal, plus les backfills et les relances)
-- ---------------------------------------------------------------------------
create table runs (
  id                 bigserial primary key,
  journal_date       date not null,                -- date du journal (jour J)
  kind               text not null default 'daily' check (kind in ('daily', 'backfill', 'retry')),
  window_start       timestamptz not null,         -- bornes de bonding couvertes
  window_end         timestamptz not null,
  status             text not null default 'running'
                     check (status in ('running', 'collected', 'published', 'failed')),
  config             jsonb not null,               -- copie des seuils utilisés ce jour-là
  counts             jsonb,                        -- {bonded, dead, stage_a, retained, by_reason:{bundle:12,...}}
  sol_price_usd      numeric,
  summary            jsonb,                        -- résumé 5 lignes (meta dominante, etc.)
  helius_credits     integer not null default 0,
  gecko_calls        integer not null default 0,
  claude_status      text check (claude_status in ('pending', 'ok', 'partial', 'failed', 'quota', 'skipped')),
  claude_duration_s  integer,
  telegram_sent_at   timestamptz,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  error              text,
  unique (journal_date, kind)
);

-- ---------------------------------------------------------------------------
-- Coins bondés (tous, même morts) — données d'identité, figées après collecte
-- ---------------------------------------------------------------------------
create table coins (
  mint                 text primary key,
  name                 text,
  symbol               text,
  description          text,
  image_url            text,
  metadata_uri         text,
  twitter              text,
  telegram             text,
  website              text,
  dev_wallet           text,
  token_program        text,                      -- 'spl-token' | 'token-2022'
  bonding_curve        text,
  pool_address         text,                      -- pool PumpSwap créée à la migration
  migration_signature  text not null unique,
  created_at           timestamptz,               -- 1re transaction de la bonding curve
  bonded_at            timestamptz not null,      -- bloc de la migration
  bonding_seconds      integer,                   -- bonded_at - created_at
  prebond_tx_count     integer,                   -- nb de tx sur la curve avant migration
  migration_mcap_sol   numeric,
  migration_mcap_usd   numeric,
  journal_date         date not null,
  inserted_at          timestamptz not null default now()
);
create index coins_journal_date_idx on coins (journal_date);
create index coins_bonded_at_idx    on coins (bonded_at);
create index coins_dev_wallet_idx   on coins (dev_wallet);
create index coins_symbol_trgm_idx  on coins using gin (symbol gin_trgm_ops);
create index coins_name_trgm_idx    on coins using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Évaluation d'un coin lors d'un passage : métriques brutes + verdict.
-- Les métriques sont gardées pour pouvoir re-juger avec d'autres seuils
-- (calibrage) sans refaire d'appels payants.
-- ---------------------------------------------------------------------------
create table evaluations (
  run_id                bigint not null references runs (id) on delete cascade,
  mint                  text   not null references coins (mint) on delete cascade,
  evaluated_at          timestamptz not null default now(),

  -- Étape A (DexScreener / GeckoTerminal, gratuit)
  mcap_usd              numeric,
  price_usd             numeric,
  volume_24h_usd        numeric,
  liquidity_usd         numeric,
  ath_mcap_usd          numeric,
  ath_at                timestamptz,
  txns_24h              integer,
  buyers_24h            integer,
  sellers_24h           integer,

  -- Étape B (on-chain, survivants uniquement ; null = non mesuré)
  holders               integer,
  top10_pct             numeric,                  -- hors pool, burn, comptes de programme
  bundle_pct            numeric,
  bundle_wallets        integer,
  insiders_pct          numeric,
  insider_wallets       integer,
  snipers_pct           numeric,
  dev_sold_pct          numeric,
  dev_sell_drop_pct     numeric,
  unique_buyers_prebond integer,
  wash_tx_per_wallet    numeric,
  wash_roundtrip_share  numeric,
  dev_launches_30d      integer,
  dev_dead_30d          integer,
  metrics               jsonb,                    -- détails : wallets, liens de financement, preuves

  -- Verdict
  stage                 text not null check (stage in ('A', 'B')),
  status                text not null check (status in ('retained', 'dead', 'excluded', 'not_analyzed')),
  reasons               jsonb not null default '[]', -- [{code, label, value, threshold, detail}]
  tags                  text[] not null default '{}', -- 'Runner', 'CTO'
  score                 smallint check (score between 0 and 100),
  score_detail          jsonb,
  credits_used          integer not null default 0,

  primary key (run_id, mint)
);
create index evaluations_mint_idx   on evaluations (mint);
create index evaluations_status_idx on evaluations (run_id, status);

-- ---------------------------------------------------------------------------
-- Cache des liens de financement entre wallets (insiders, bundlers récurrents)
-- ---------------------------------------------------------------------------
create table wallet_funding (
  wallet         text primary key,
  funder         text,                 -- wallet ayant envoyé le SOL juste avant la 1re activité
  funded_at      timestamptz,
  funding_sig    text,
  amount_sol     numeric,
  checked_at     timestamptz not null default now()
);
create index wallet_funding_funder_idx on wallet_funding (funder);

-- Wallets connus à ne jamais traiter comme "source commune" (CEX, bridges, frais pump.fun…)
create table known_wallets (
  address  text primary key,
  label    text not null,
  kind     text not null check (kind in ('cex', 'bridge', 'program', 'fee', 'burn', 'other'))
);

-- ---------------------------------------------------------------------------
-- Fiches rédigées par Claude Code
-- ---------------------------------------------------------------------------
create table fiches (
  mint         text primary key references coins (mint) on delete cascade,
  run_id       bigint references runs (id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts     smallint not null default 0,
  content      jsonb,                  -- format validé (catalyseur, dynamique, pourquoi, peut_remarcher, faits, hypotheses, sources)
  can_rerun    text check (can_rerun in ('oui', 'non', 'incertain')),
  confidence   text check (confidence in ('faible', 'moyen', 'eleve')),
  model        text,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index fiches_status_idx on fiches (status);

-- ---------------------------------------------------------------------------
-- Metas : liste évolutive + classement de tous les coins bondés
-- ---------------------------------------------------------------------------
create table metas (
  slug         text primary key,              -- 'animal-chien'
  label        text not null,                 -- 'Chien'
  parent       text references metas (slug),  -- 'animal'
  kind         text not null default 'theme' check (kind in ('theme', 'mecanique')),
  description  text,
  created_by   text not null default 'seed' check (created_by in ('seed', 'claude', 'user')),
  created_at   timestamptz not null default now()
);

create table coin_metas (
  mint    text not null references coins (mint) on delete cascade,
  meta    text not null references metas (slug) on update cascade,
  source  text not null default 'classification' check (source in ('classification', 'fiche', 'user')),
  primary key (mint, meta)
);
create index coin_metas_meta_idx on coin_metas (meta);

-- Statistiques par jour et par meta (calculées par script)
create table meta_stats (
  day            date not null,
  meta           text not null references metas (slug) on update cascade,
  bonded         integer not null,
  survived_a     integer not null,
  retained       integer not null,
  runners        integer not null,
  success_rate   numeric,               -- retained / bonded
  rate_3d        numeric,               -- taux glissant 3 jours
  rate_7d        numeric,
  volume_trend   text check (volume_trend in ('hausse', 'baisse', 'stable')),
  saturated      boolean not null default false, -- beaucoup de bondés, très peu retenus
  primary key (day, meta)
);

-- ---------------------------------------------------------------------------
-- Textes de synthèse : "À surveiller" quotidien et récap hebdo du lundi
-- ---------------------------------------------------------------------------
create table insights (
  id            bigserial primary key,
  kind          text not null check (kind in ('watchlist', 'weekly_recap')),
  journal_date  date not null,
  period_start  date,
  period_end    date,
  content       jsonb not null,
  created_at    timestamptz not null default now(),
  unique (kind, journal_date)
);

-- ---------------------------------------------------------------------------
-- RLS : activée partout, aucune policy (accès serveur uniquement)
-- ---------------------------------------------------------------------------
alter table settings       enable row level security;
alter table runs           enable row level security;
alter table coins          enable row level security;
alter table evaluations    enable row level security;
alter table wallet_funding enable row level security;
alter table known_wallets  enable row level security;
alter table fiches         enable row level security;
alter table metas          enable row level security;
alter table coin_metas     enable row level security;
alter table meta_stats     enable row level security;
alter table insights       enable row level security;

-- ---------------------------------------------------------------------------
-- Données initiales
-- ---------------------------------------------------------------------------
insert into settings (config) values ('{
  "window":   { "start_hours_ago": 48, "end_hours_ago": 24, "anchor_utc_hour": 4 },
  "stage_a":  { "min_mcap_vs_migration": 1.0, "min_volume_24h_usd": 50000 },
  "stage_b":  {
    "min_holders": 300,
    "bundle_max_pct": 10,
    "insiders_max_pct": 15,
    "insider_funding_lookback_hours": 72,
    "snipers_max_pct": 15,
    "sniper_window_seconds": 5,
    "dev_sell_min_sold_pct": 50,
    "dev_sell_drop_pct": 40,
    "dev_sell_impact_minutes": 60,
    "top10_max_pct": 30,
    "fast_bond_minutes": 10,
    "fast_bond_min_buyers": 150,
    "wash_max_tx_per_wallet": 8,
    "wash_max_roundtrip_share": 0.5,
    "serial_dev_max_launches_30d": 5,
    "serial_dev_dead_share": 0.5,
    "short_circuit": true
  },
  "score":    { "runner_ath_multiple": 5 },
  "fiches":   { "max_per_day": 10, "model": "sonnet", "max_searches_per_fiche": 4 },
  "budget":   { "helius_daily_credit_cap": 28000 }
}');

insert into metas (slug, label, parent, kind) values
  ('ia',               'IA',                 null,     'theme'),
  ('animal',           'Animal',             null,     'theme'),
  ('animal-chien',     'Chien',              'animal', 'theme'),
  ('animal-chat',      'Chat',               'animal', 'theme'),
  ('politique',        'Politique',          null,     'theme'),
  ('celebrite',        'Célébrité',          null,     'theme'),
  ('culture-internet', 'Culture internet',   null,     'theme'),
  ('sport',            'Sport',              null,     'theme'),
  ('actualite',        'Actualité',          null,     'theme'),
  ('crypto-meta',      'Crypto / Solana',    null,     'theme'),
  ('autre',            'Autre',              null,     'theme'),
  ('cto',              'CTO',                null,     'mecanique'),
  ('livestream',       'Livestream',         null,     'mecanique'),
  ('copie',            'Copie d''un coin qui a marché', null, 'mecanique');

insert into known_wallets (address, label, kind) values
  ('1nc1nerator11111111111111111111111111111111', 'Incinerator (burn)', 'burn'),
  ('39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg', 'pump.fun migration authority', 'program');
