-- « Second cerveau » : liens entre coins retenus, chacun avec sa raison.
--  * source 'regle'  : liens factuels calculés par script (même dev, même financeur, copie, même vague) ;
--  * source 'claude' : liens de sens rédigés par Claude Code (même catalyseur, même écosystème, narratif…).
create table if not exists coin_links (
  mint_a      text not null references coins (mint) on delete cascade,
  mint_b      text not null references coins (mint) on delete cascade,
  kind        text not null check (kind in (
                'meme_dev', 'financement_commun', 'copie', 'meme_vague',
                'catalyseur', 'ecosysteme', 'narratif', 'reponse', 'celebrite', 'autre')),
  strength    smallint not null default 2 check (strength between 1 and 3),
  explanation text not null,
  source      text not null check (source in ('regle', 'claude')),
  created_at  timestamptz not null default now(),
  check (mint_a < mint_b),
  primary key (mint_a, mint_b, kind)
);
create index if not exists coin_links_b_idx on coin_links (mint_b);
alter table coin_links enable row level security;

-- Coins déjà passés à l'étape « liens » de Claude Code (pour ne traiter que les nouveaux).
alter table fiches add column if not exists links_at timestamptz;
