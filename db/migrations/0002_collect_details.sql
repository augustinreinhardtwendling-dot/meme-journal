-- Détails découverts sur les vraies migrations (octobre 2026) :
--  * certains coins sont cotés en PUMP, ZEC… et pas en SOL ;
--  * ~20 % des « bondings » se font avec une curve quasi vide (migration fantôme) ;
--  * le wallet « creator » de la curve peut différer du wallet qui a signé la création.
alter table coins add column if not exists creator_wallet   text;
alter table coins add column if not exists quote_mint       text;
alter table coins add column if not exists quote_symbol     text;
alter table coins add column if not exists pool_base        numeric;
alter table coins add column if not exists pool_quote       numeric;
alter table coins add column if not exists migration_liquidity_usd numeric;
alter table coins add column if not exists is_ghost         boolean not null default false;
alter table coins add column if not exists migration_instruction text;

create index if not exists coins_creator_wallet_idx on coins (creator_wallet);

-- Les ghost bonds n'ont pas d'évaluation détaillée : on accepte le statut « excluded » avec la raison ghost_bond.
-- Rien à changer dans evaluations.

-- Hubs détectés automatiquement (gros soldes) : nouveau type.
alter table known_wallets drop constraint if exists known_wallets_kind_check;
alter table known_wallets add constraint known_wallets_kind_check
  check (kind in ('cex', 'bridge', 'program', 'fee', 'burn', 'hub', 'other'));
