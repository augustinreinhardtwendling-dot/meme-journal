// Recalcul ciblé après un changement de seuils : seuls les coins dont le verdict peut changer sont réanalysés.
// Les données de marché (tri A), les holders et le wash trading restent ceux du jour du journal.
// Usage : npx tsx --env-file=.env.local pipeline/reanalyze.ts 2026-09-29 2026-10-10
import type { Sql } from "postgres";
import { closeDb, db, loadConfig } from "../lib/db";
import { judgeCriterion } from "../lib/detection/judge";
import { emptyMetrics, type Metrics, type Reason, type ReasonCode } from "../lib/types";
import type { CollectedCoin } from "./collect";
import { CreditMeter, Helius } from "./sources/helius";
import { analyzeCoin } from "./stage-b";
import { log } from "./util";

const [from, to = from] = process.argv.slice(2);
if (!from) throw new Error("usage : reanalyze.ts AAAA-MM-JJ [AAAA-MM-JJ]");

const sql = db();
const cfg = await loadConfig();
const dayMeter = new CreditMeter(cfg.budget.helius_daily_credit_cap, "recalcul");
const helius = new Helius(process.env.HELIUS_API_KEY!, dayMeter);

const METRIC_KEYS = Object.keys(emptyMetrics()) as (keyof Metrics)[];

function storedMetrics(row: Record<string, unknown>): Metrics {
  const m = emptyMetrics();
  for (const k of METRIC_KEYS) if (k in row && row[k] !== undefined) (m as unknown as Record<string, unknown>)[k] = row[k];
  const d = (row.details ?? {}) as Record<string, unknown>;
  m.cto_official = (d.cto_official as boolean | null) ?? null;
  m.cto_recovery_multiple = (d.cto_recovery_multiple as number | null) ?? null;
  return m;
}

/** Recalcule les compteurs et le résumé d'un journal à partir de ses évaluations. */
export async function recomputeRunCounts(sql: Sql, runId: number) {
  const rows = await sql<{ status: string; first: string | null; tags: string[]; score: number | null; symbol: string | null }[]>`
    select e.status, e.reasons->0->>'code' as first, e.tags, e.score, c.symbol
    from evaluations e join coins c on c.mint = e.mint where e.run_id = ${runId}`;
  const byReason: Record<string, number> = {};
  for (const r of rows) if (r.first) byReason[r.first] = (byReason[r.first] ?? 0) + 1;
  const ghost = byReason.ghost_bond ?? 0;
  const retained = rows.filter((r) => r.status === "retained").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const counts = {
    migrations: rows.length,
    ghost,
    bonded: rows.length - ghost,
    dead: rows.filter((r) => r.status === "dead").length,
    stage_a: rows.filter((r) => r.status !== "dead" && r.first !== "ghost_bond").length,
    retained: retained.length,
    excluded: rows.filter((r) => r.status === "excluded").length - ghost,
    not_analyzed: rows.filter((r) => r.status === "not_analyzed").length,
    runners: retained.filter((r) => r.tags.includes("Runner")).length,
    by_reason: byReason,
  };
  const top = retained.slice(0, 5).map((r) => ({ symbol: r.symbol, score: r.score }));
  await sql`update runs set counts = ${sql.json(counts as never)},
    summary = coalesce(summary, '{}'::jsonb) || ${sql.json({ top } as never)} where id = ${runId}`;
  return counts;
}

const runs = await sql<{ id: number; journal_date: string; kind: string }[]>`
  select distinct on (journal_date) id, journal_date, kind from runs
  where journal_date between ${from} and ${to} and status in ('collected', 'published')
  order by journal_date, (kind = 'daily') desc, started_at desc`;

for (const run of runs) {
  const rows = await sql<Record<string, unknown>[]>`
    select e.*, e.metrics as details, c.*
    from evaluations e join coins c on c.mint = e.mint
    where e.run_id = ${run.id} and e.stage = 'B' and e.status = 'excluded'`;
  const candidates = rows.filter((r) => {
    const reasons = (r.reasons ?? []) as Reason[];
    if (reasons.some((x) => x.code === "snipers")) return true;
    const first = reasons[0]?.code as ReasonCode | undefined;
    if (!first) return false;
    const m = storedMetrics(r);
    return !judgeCriterion(first, m, { bondingSeconds: r.bonding_seconds as number | null, prebondTxCount: r.prebond_tx_count as number | null }, cfg);
  });
  log(`${run.journal_date} (${run.kind}) : ${candidates.length} coin(s) à réanalyser sur ${rows.length} exclus à l'étape B`);

  for (const r of candidates) {
    const m = storedMetrics(r);
    const coin = r as unknown as CollectedCoin;
    const snap = { pair: null, mcapUsd: m.mcap_usd, priceUsd: m.price_usd, volume24hUsd: m.volume_24h_usd, liquidityUsd: m.liquidity_usd };
    // Holders, wash trading et concentration : valeurs du jour du journal, pas celles d'aujourd'hui.
    const skip: ReasonCode[] = ["min_holders", "wash_trading"];
    if (m.top10_pct != null) skip.push("concentration");
    try {
      const e = await analyzeCoin(coin, snap, { helius, sql, cfg, dayMeter }, { preset: m, skip });
      const { cto_official, cto_recovery_multiple, ...columns } = e.metrics;
      const details = { ...((r.details ?? {}) as object), ...e.details, cto_official, cto_recovery_multiple, recalcul: new Date().toISOString() };
      const before = ((r.reasons ?? []) as Reason[])[0]?.label ?? "?";
      await sql`update evaluations set ${sql(columns as never)}, status = ${e.status}, reasons = ${sql.json(e.reasons as never)},
        tags = ${e.tags}, score = ${e.score}, score_detail = ${e.scoreDetail ? sql.json(e.scoreDetail as never) : null},
        metrics = ${sql.json(details as never)}, credits_used = credits_used + ${e.creditsUsed}
        where run_id = ${run.id} and mint = ${r.mint as string}`;
      log(`  $${r.symbol} : ${before} → ${e.status === "retained" ? `RETENU (score ${e.score})` : e.reasons[0]?.label}`);
    } catch (err) {
      log(`  ⚠ $${r.symbol} : ${(err as Error).message}`);
    }
  }
  const counts = await recomputeRunCounts(sql, run.id);
  log(`  → ${counts.retained} retenus (dont ${counts.runners} runners)`);
}
log(`Crédits Helius utilisés : ${dayMeter.used}`);
await closeDb();
