// Écriture en base : passage, coins, évaluations.
import type { Sql } from "postgres";
import type { Config } from "../lib/config";
import type { CollectedCoin } from "./collect";
import type { Evaluated } from "./stage-b";

export async function startRun(sql: Sql, journalDate: string, kind: string, window: { start: Date; end: Date }, cfg: Config) {
  const [row] = await sql<{ id: number }[]>`
    insert into runs (journal_date, kind, window_start, window_end, status, config, started_at)
    values (${journalDate}, ${kind}, ${window.start}, ${window.end}, 'running', ${sql.json(cfg)}, now())
    on conflict (journal_date, kind) do update set
      -- Un journal déjà publié reste visible pendant qu'on le recalcule.
      window_start = excluded.window_start, window_end = excluded.window_end,
      status = case when runs.status in ('collected', 'published') then runs.status else 'running' end,
      config = excluded.config, started_at = now(), finished_at = null, error = null
    returning id`;
  return row.id;
}

const COIN_COLUMNS = [
  "mint", "name", "symbol", "description", "image_url", "metadata_uri", "twitter", "telegram", "website",
  "dev_wallet", "creator_wallet", "token_program", "bonding_curve", "pool_address", "migration_signature",
  "migration_instruction", "created_at", "bonded_at", "bonding_seconds", "prebond_tx_count", "quote_mint",
  "quote_symbol", "pool_base", "pool_quote", "migration_mcap_sol", "migration_mcap_usd", "migration_liquidity_usd",
  "is_ghost", "journal_date",
] as const;

export async function saveCoins(sql: Sql, coins: CollectedCoin[], journalDate: string) {
  const rows = coins.map((c) => {
    const full: Record<string, unknown> = { ...c, journal_date: journalDate };
    return Object.fromEntries(COIN_COLUMNS.map((k) => [k, full[k] ?? null]));
  });
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await sql`
      insert into coins ${sql(chunk)}
      on conflict (mint) do update set
        name = excluded.name, symbol = excluded.symbol, description = excluded.description,
        image_url = excluded.image_url, metadata_uri = excluded.metadata_uri, twitter = excluded.twitter,
        telegram = excluded.telegram, website = excluded.website, dev_wallet = excluded.dev_wallet,
        creator_wallet = excluded.creator_wallet, token_program = excluded.token_program,
        created_at = excluded.created_at, bonding_seconds = excluded.bonding_seconds,
        prebond_tx_count = excluded.prebond_tx_count, quote_symbol = excluded.quote_symbol,
        migration_mcap_sol = excluded.migration_mcap_sol, migration_mcap_usd = excluded.migration_mcap_usd,
        migration_liquidity_usd = excluded.migration_liquidity_usd, is_ghost = excluded.is_ghost,
        journal_date = excluded.journal_date`;
  }
}

export async function saveEvaluations(sql: Sql, runId: number, evals: Evaluated[]) {
  const rows = evals.map((e) => {
    // Les indicateurs CTO n'ont pas de colonne : ils vont dans le JSON des détails.
    const { cto_official, cto_recovery_multiple, ...columns } = e.metrics;
    const details = { ...e.details, cto_official, cto_recovery_multiple };
    return {
      run_id: runId,
      mint: e.coin.mint,
      ...columns,
      metrics: sql.json(details as never),
      stage: e.stage,
      status: e.status,
      reasons: sql.json(e.reasons as never),
      tags: e.tags,
      score: e.score,
      score_detail: e.scoreDetail ? sql.json(e.scoreDetail as never) : null,
      credits_used: e.creditsUsed,
    };
  });
  // Remplacement en une transaction : le journal n'apparaît jamais vide sur le site.
  await sql.begin(async (tx) => {
    await tx`delete from evaluations where run_id = ${runId}`;
    for (let i = 0; i < rows.length; i += 300) {
      await tx`insert into evaluations ${tx(rows.slice(i, i + 300) as never[])}`;
    }
  });
}

export async function finishRun(
  sql: Sql,
  runId: number,
  data: { status: string; counts: unknown; summary: unknown; solPrice: number | null; credits: number; geckoCalls: number; error?: string | null },
) {
  await sql`
    update runs set
      -- Un échec de recalcul ne masque pas le journal déjà publié.
      status = case when ${data.status} = 'failed' and status in ('collected', 'published') then status else ${data.status} end,
      counts = coalesce(${data.counts ? sql.json(data.counts as never) : null}, counts),
      summary = coalesce(${data.summary ? sql.json(data.summary as never) : null}, summary),
      sol_price_usd = coalesce(${data.solPrice}, sol_price_usd),
      -- Cumul : un recalcul consomme aussi des crédits (compteur mensuel exact).
      helius_credits = helius_credits + ${data.credits}, gecko_calls = gecko_calls + ${data.geckoCalls},
      finished_at = now(), error = ${data.error ?? null}
    where id = ${runId}`;
}
