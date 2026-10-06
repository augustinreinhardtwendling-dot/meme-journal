// Lectures pour l'interface.
import { db } from "./db";
import type { Reason } from "./types";

export interface RunRow {
  id: number;
  journal_date: string;
  kind: string;
  status: string;
  window_start: Date;
  window_end: Date;
  counts: {
    migrations: number;
    ghost: number;
    bonded: number;
    dead: number;
    stage_a: number;
    retained: number;
    excluded: number;
    not_analyzed: number;
    runners: number;
    by_reason: Record<string, number>;
  } | null;
  summary: { sol_price_usd: number | null; dominant_meta: string | null; top: { symbol: string; score: number }[] } | null;
  sol_price_usd: number | null;
  helius_credits: number;
  claude_status: string | null;
  finished_at: Date | null;
}

const RUN_COLS = "id, journal_date, kind, status, window_start, window_end, counts, summary, sol_price_usd, helius_credits, claude_status, finished_at";
const runColumns = () => db().unsafe(RUN_COLS);

/** Le journal le plus récent disponible (passage quotidien prioritaire sur un backfill du même jour). */
export async function latestRun(): Promise<RunRow | null> {
  const rows = await db()<RunRow[]>`
    select ${runColumns()} from runs where status in ('collected', 'published')
    order by journal_date desc, (kind = 'daily') desc limit 1`;
  return rows[0] ?? null;
}

export async function runByDate(date: string): Promise<RunRow | null> {
  const rows = await db()<RunRow[]>`
    select ${runColumns()} from runs where journal_date = ${date} and status in ('collected', 'published')
    order by (kind = 'daily') desc limit 1`;
  return rows[0] ?? null;
}

export async function listRuns(limit = 90): Promise<RunRow[]> {
  return db()<RunRow[]>`
    select distinct on (journal_date) ${runColumns()} from runs where status in ('collected', 'published')
    order by journal_date desc, (kind = 'daily') desc limit ${limit}`;
}

export interface RetainedCoin {
  mint: string;
  name: string | null;
  symbol: string | null;
  description: string | null;
  image_url: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  dev_wallet: string | null;
  created_at: Date | null;
  bonded_at: Date;
  bonding_seconds: number | null;
  migration_mcap_usd: number | null;
  quote_symbol: string | null;
  mcap_usd: number | null;
  volume_24h_usd: number | null;
  liquidity_usd: number | null;
  ath_mcap_usd: number | null;
  holders: number | null;
  top10_pct: number | null;
  bundle_pct: number | null;
  snipers_pct: number | null;
  insiders_pct: number | null;
  dev_sold_pct: number | null;
  score: number | null;
  score_detail: { distribution: number; performance: number } | null;
  tags: string[];
  metas: string[] | null;
  fiche: FicheContent | null;
  fiche_status: string | null;
}

/** Contenu d'une fiche (rempli à l'étape 4). */
export interface FicheContent {
  catalyseur?: { resume: string; sources?: { titre?: string; url: string }[] };
  dynamique?: string;
  pourquoi?: string;
  peut_remarcher?: { verdict: string; confiance: string; raisonnement: string };
}

export async function retainedCoins(runId: number): Promise<RetainedCoin[]> {
  return db()<RetainedCoin[]>`
    select c.mint, c.name, c.symbol, c.description, c.image_url, c.twitter, c.telegram, c.website, c.dev_wallet,
      c.created_at, c.bonded_at, c.bonding_seconds, c.migration_mcap_usd, c.quote_symbol,
      e.mcap_usd, e.volume_24h_usd, e.liquidity_usd, e.ath_mcap_usd, e.holders, e.top10_pct, e.bundle_pct,
      e.snipers_pct, e.insiders_pct, e.dev_sold_pct, e.score, e.score_detail, e.tags,
      (select array_agg(m.label order by m.label) from coin_metas cm join metas m on m.slug = cm.meta where cm.mint = c.mint) as metas,
      f.content as fiche, f.status as fiche_status
    from evaluations e
    join coins c on c.mint = e.mint
    left join fiches f on f.mint = c.mint
    where e.run_id = ${runId} and e.status = 'retained'
    order by e.score desc nulls last, e.mcap_usd desc nulls last`;
}

export interface ExcludedCoin {
  mint: string;
  name: string | null;
  symbol: string | null;
  status: string;
  reasons: Reason[];
  mcap_usd: number | null;
  migration_mcap_usd: number | null;
  volume_24h_usd: number | null;
}

export async function excludedCoins(runId: number): Promise<ExcludedCoin[]> {
  return db()<ExcludedCoin[]>`
    select c.mint, c.name, c.symbol, e.status, e.reasons, e.mcap_usd, c.migration_mcap_usd, e.volume_24h_usd
    from evaluations e join coins c on c.mint = e.mint
    where e.run_id = ${runId} and e.status <> 'retained'
    order by e.mcap_usd desc nulls last`;
}

export async function searchCoins(q: string) {
  const like = `%${q.replace(/[%_]/g, "")}%`;
  return db()<{ mint: string; name: string | null; symbol: string | null; journal_date: string; status: string | null; score: number | null }[]>`
    select c.mint, c.name, c.symbol, c.journal_date, e.status, e.score
    from coins c
    left join lateral (select status, score from evaluations where mint = c.mint order by run_id desc limit 1) e on true
    where c.symbol ilike ${like} or c.name ilike ${like} or c.mint = ${q}
       or exists (select 1 from coin_metas cm join metas m on m.slug = cm.meta where cm.mint = c.mint and (m.label ilike ${like} or m.slug ilike ${like}))
    order by (e.status = 'retained') desc nulls last, c.bonded_at desc
    limit 60`;
}

export async function monthUsage() {
  const [row] = await db()<{ credits: number; runs: number; claude_seconds: number | null }[]>`
    select coalesce(sum(helius_credits), 0)::int as credits, count(*)::int as runs, sum(claude_duration_s)::int as claude_seconds
    from runs where started_at >= date_trunc('month', now())`;
  return row;
}
