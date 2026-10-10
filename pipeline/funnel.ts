// Calibrage : combien de coins chaque filtre élimine, à partir des métriques déjà stockées (aucun appel payant).
// Usage : npx tsx --env-file=.env.local pipeline/funnel.ts 2026-10-01 2026-10-07 [--apply]
//   --apply : réécrit les verdicts avec les seuils actuels (table settings).
import { closeDb, db, loadConfig } from "../lib/db";
import { isCto, judgeCriterion, judgeStageA, STAGE_B_ORDER } from "../lib/detection/judge";
import { computeScore, isRunner } from "../lib/scoring";
import { emptyMetrics, REASON_LABELS, type Metrics, type Reason } from "../lib/types";

const [from, to = from] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!from) throw new Error("usage : funnel.ts AAAA-MM-JJ [AAAA-MM-JJ] [--apply]");

const sql = db();
const cfg = await loadConfig();
const rows = await sql<(Metrics & Record<string, unknown>)[]>`
  select e.*, e.metrics as details, c.migration_mcap_usd, c.is_ghost, c.bonding_seconds, c.prebond_tx_count, r.journal_date
  from evaluations e join runs r on r.id = e.run_id join coins c on c.mint = e.mint
  where r.journal_date between ${from} and ${to}
    and r.id in (select distinct on (journal_date) id from runs where journal_date between ${from} and ${to}
                 order by journal_date, (kind = 'daily') desc, started_at desc)`;

const pick = (r: Record<string, unknown>): Metrics => {
  const m = emptyMetrics();
  for (const k of Object.keys(m) as (keyof Metrics)[]) if (k in r) (m as unknown as Record<string, unknown>)[k] = r[k];
  const d = (r.details ?? {}) as Record<string, unknown>;
  m.cto_official = (d.cto_official as boolean | null) ?? null;
  m.cto_recovery_multiple = (d.cto_recovery_multiple as number | null) ?? null;
  return m;
};

const total = rows.length;
const ghosts = rows.filter((r) => r.is_ghost);
const normal = rows.filter((r) => !r.is_ghost);
const aFail = normal.filter((r) =>
  judgeStageA({ migrationMcapUsd: r.migration_mcap_usd as number, mcapUsd: r.mcap_usd, volume24hUsd: r.volume_24h_usd }, cfg),
);
const survivors = normal.filter((r) => !aFail.includes(r) && r.stage === "B" && r.status !== "not_analyzed");

console.log(`\nJournaux du ${from} au ${to}`);
console.log(`  migrations : ${total}  (fantômes : ${ghosts.length})`);
console.log(`  bondings normaux : ${normal.length}`);
console.log(`  morts après bonding (tri A) : ${aFail.length}`);
console.log(`  survivants analysés à l'étape B : ${survivors.length}`);

// Chaque critère pris isolément (utile si l'analyse a été faite avec --full)
console.log("\nÉchecs par critère (isolément) parmi les survivants analysés :");
const table: Record<string, { echecs: number; mesures: number }> = {};
for (const code of STAGE_B_ORDER) {
  let measured = 0;
  let failed = 0;
  for (const r of survivors) {
    const m = pick(r);
    const extra = { bondingSeconds: r.bonding_seconds as number | null, prebondTxCount: r.prebond_tx_count as number | null };
    const reason = judgeCriterion(code, m, extra, cfg);
    if (reason) failed++;
    if (reason || hasMeasure(code, m, extra)) measured++;
  }
  table[REASON_LABELS[code]] = { echecs: failed, mesures: measured };
}
console.table(table);

// Entonnoir séquentiel avec les seuils actuels
let still = survivors;
const funnel: Record<string, number> = { "Survivants tri A": still.length };
for (const code of STAGE_B_ORDER) {
  still = still.filter((r) => !judgeCriterion(code, pick(r), { bondingSeconds: r.bonding_seconds as number | null, prebondTxCount: r.prebond_tx_count as number | null }, cfg));
  funnel[`après ${REASON_LABELS[code].toLowerCase()}`] = still.length;
}
console.log("\nEntonnoir (dans l'ordre d'analyse) :");
console.table(funnel);

// Distribution des métriques pour choisir les seuils
const q = (xs: number[], p: number) => (xs.length ? xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);
const dist: Record<string, unknown> = {};
for (const k of ["holders", "top10_pct", "bundle_pct", "snipers_pct", "snipers_held_pct", "insiders_pct", "dev_sold_pct", "dev_sell_drop_pct", "wash_tx_per_wallet", "wash_roundtrip_share", "dev_launches_30d"] as const) {
  const xs = survivors.map((r) => r[k] as number | null).filter((x): x is number => x != null);
  dist[k] = { n: xs.length, p25: q([...xs], 0.25), mediane: q([...xs], 0.5), p75: q([...xs], 0.75), p90: q([...xs], 0.9) };
}
console.log("\nDistribution des métriques (survivants) :");
console.table(dist);

if (apply) {
  let changed = 0;
  for (const r of survivors) {
    const m = pick(r);
    const extra = { bondingSeconds: r.bonding_seconds as number | null, prebondTxCount: r.prebond_tx_count as number | null };
    const reasons: Reason[] = STAGE_B_ORDER.map((c) => judgeCriterion(c, m, extra, cfg)).filter((x): x is Reason => !!x);
    const status = reasons.length ? "excluded" : "retained";
    const tags = [...(isCto(m, cfg) ? ["CTO"] : []), ...(status === "retained" && isRunner(m, r.migration_mcap_usd as number, cfg) ? ["Runner"] : [])];
    const s = status === "retained" ? computeScore(m, r.migration_mcap_usd as number, cfg) : null;
    await sql`update evaluations set status = ${status}, reasons = ${sql.json(reasons as never)}, tags = ${tags},
      score = ${s?.score ?? null}, score_detail = ${s ? sql.json(s.detail as never) : null}
      where run_id = ${r.run_id as number} and mint = ${r.mint as string}`;
    if (status !== r.status) changed++;
  }
  console.log(`\nVerdicts réécrits avec les seuils actuels (${changed} changements de statut).`);
}
await closeDb();

function hasMeasure(code: string, m: Metrics, x: { bondingSeconds: number | null }) {
  switch (code) {
    case "min_holders": return m.holders != null;
    case "wash_trading": return m.wash_tx_per_wallet != null || m.wash_roundtrip_share != null;
    case "concentration": return m.top10_pct != null;
    case "fast_bond": return x.bondingSeconds != null;
    case "bundle": return m.bundle_pct != null;
    case "snipers": return m.snipers_held_pct != null || m.snipers_pct != null;
    case "insiders": return m.insiders_pct != null;
    case "dev_sell": return m.dev_sold_pct != null;
    case "serial_dev": return m.dev_launches_30d != null;
    default: return false;
  }
}
