// Passage quotidien : collecte → tri A → tri B → score → enregistrement.
// Usage : npm run pipeline -- [--date AAAA-MM-JJ] [--kind daily|backfill] [--full] [--max-b N]
import { parseArgs } from "node:util";
import { closeDb, db, loadConfig } from "../lib/db";
import { emptyMetrics, REASON_LABELS, type Reason } from "../lib/types";
import { WSOL_MINT } from "../lib/solana";
import { journalWindow, todayUtc } from "../lib/window";
import { collect, loadCollected, refreshMissingMetadata } from "./collect";
import { finishRun, saveCoins, saveEvaluations, startRun } from "./persist";
import { quotePricesUsd } from "./sources/dexscreener";
import { geckoCalls, geckoRateLimited } from "./sources/geckoterminal";
import { CreditMeter, Helius } from "./sources/helius";
import { stageA } from "./stage-a";
import { stageB, type Evaluated } from "./stage-b";
import { log } from "./util";

const { values: args } = parseArgs({
  options: {
    date: { type: "string" },
    kind: { type: "string", default: "daily" },
    /** Mesure tous les critères sans s'arrêter à la 1re exclusion (calibrage). */
    full: { type: "boolean", default: false },
    /** Nombre max de coins analysés à l'étape B (tests). */
    "max-b": { type: "string" },
    /** Réutilise les coins déjà collectés pour ce journal (relance de l'analyse). */
    "skip-collect": { type: "boolean", default: false },
  },
});

const journalDate = args.date ?? (process.env.JOURNAL_DATE || todayUtc());
const kind = args.kind ?? "daily";
const cfg = await loadConfig();
if (args.full) cfg.stage_b.short_circuit = false;
const window = journalWindow(journalDate, cfg);
const sql = db();
const dayMeter = new CreditMeter(cfg.budget.helius_daily_credit_cap, "jour");
const helius = new Helius(process.env.HELIUS_API_KEY!, dayMeter);

log(`Journal du ${journalDate} (${kind}) — bondings du ${window.start.toISOString()} au ${window.end.toISOString()}`);
const runId = await startRun(sql, journalDate, kind, window, cfg);

try {
  let coins;
  if (args["skip-collect"]) {
    coins = await loadCollected(sql, journalDate);
    if (!coins.length) throw new Error(`aucun coin déjà collecté pour le ${journalDate}`);
    log(`${coins.length} coins rechargés depuis la base`);
    await refreshMissingMetadata(coins);
  } else {
    coins = await collect(helius, window.start, window.end, cfg);
    log(`${coins.length} coins collectés (crédits : ${dayMeter.used})`);
  }
  await saveCoins(sql, coins, journalDate);

  const ghosts = coins.filter((c) => c.is_ghost);
  const normal = coins.filter((c) => !c.is_ghost);

  log("Étape A (DexScreener)…");
  const a = await stageA(normal, cfg);
  const survivors = a.filter((x) => !x.reason);
  log(`  ${survivors.length}/${normal.length} passent l'étape A`);

  const evals: Evaluated[] = [
    ...ghosts.map((coin): Evaluated => ({
      coin,
      stage: "A",
      status: "excluded",
      metrics: emptyMetrics(),
      reasons: [{ code: "ghost_bond", label: REASON_LABELS.ghost_bond, value: coin.migration_liquidity_usd, threshold: cfg.collect.ghost_bond_max_liquidity_usd, detail: `seulement ${(coin.pool_quote ?? 0).toFixed(3)} ${coin.quote_symbol ?? ""} versés dans la pool à la migration` }],
      tags: [],
      score: null,
      scoreDetail: null,
      details: {},
      creditsUsed: 0,
    })),
    ...a.filter((x) => x.reason).map(({ coin, snap, reason }): Evaluated => ({
      coin,
      stage: "A",
      status: "dead",
      metrics: { ...emptyMetrics(), mcap_usd: snap.mcapUsd, price_usd: snap.priceUsd, volume_24h_usd: snap.volume24hUsd, liquidity_usd: snap.liquidityUsd },
      reasons: [reason as Reason],
      tags: [],
      score: null,
      scoreDetail: null,
      details: {},
      creditsUsed: 0,
    })),
  ];

  log("Étape B (on-chain)…");
  const maxB = args["max-b"] ? Number(args["max-b"]) : Infinity;
  const toAnalyze = survivors.slice(0, maxB);
  const b = await stageB(toAnalyze, { helius, sql, cfg, dayMeter });
  evals.push(...b);
  // Survivants non analysés à cause de --max-b
  for (const s of survivors.slice(toAnalyze.length)) {
    evals.push({ coin: s.coin, stage: "B", status: "not_analyzed", metrics: { ...emptyMetrics(), mcap_usd: s.snap.mcapUsd, volume_24h_usd: s.snap.volume24hUsd }, reasons: [{ code: "not_analyzed", label: REASON_LABELS.not_analyzed, detail: "limite de test --max-b" }], tags: [], score: null, scoreDetail: null, details: {}, creditsUsed: 0 });
  }
  await saveCoins(sql, coins, journalDate); // dev_wallet et réseaux complétés à l'étape B
  await saveEvaluations(sql, runId, evals);

  // Compteurs
  const byReason: Record<string, number> = {};
  for (const e of evals) for (const r of e.reasons.slice(0, 1)) byReason[r.code] = (byReason[r.code] ?? 0) + 1;
  const retained = evals.filter((e) => e.status === "retained").sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
  const counts = {
    migrations: coins.length,
    ghost: ghosts.length,
    bonded: normal.length,
    dead: evals.filter((e) => e.status === "dead").length,
    stage_a: survivors.length,
    retained: retained.length,
    excluded: evals.filter((e) => e.status === "excluded").length - ghosts.length,
    not_analyzed: evals.filter((e) => e.status === "not_analyzed").length,
    runners: retained.filter((e) => e.tags.includes("Runner")).length,
    by_reason: byReason,
  };
  const solPrice = (await quotePricesUsd([WSOL_MINT])).get(WSOL_MINT)?.price ?? null;
  const summary = {
    sol_price_usd: solPrice,
    top: retained.slice(0, 5).map((e) => ({ symbol: e.coin.symbol, score: e.score })),
    dominant_meta: null,
  };
  await finishRun(sql, runId, { status: "collected", counts, summary, solPrice, credits: dayMeter.used, geckoCalls: geckoCalls() });

  log("Terminé.");
  console.table({ ...counts, by_reason: undefined });
  console.table(byReason);
  console.table(
    retained.slice(0, 15).map((e) => ({
      ticker: e.coin.symbol,
      score: e.score,
      tags: e.tags.join(","),
      mcap: Math.round(e.metrics.mcap_usd ?? 0),
      ath: Math.round(e.metrics.ath_mcap_usd ?? 0),
      holders: e.metrics.holders,
      top10: e.metrics.top10_pct,
      credits: e.creditsUsed,
    })),
  );
  log(`Crédits Helius : ${dayMeter.used} — appels GeckoTerminal : ${geckoCalls()} (refus 429 : ${geckoRateLimited()})`);
} catch (e) {
  log("ÉCHEC :", e);
  await finishRun(sql, runId, { status: "failed", counts: null, summary: null, solPrice: null, credits: dayMeter.used, geckoCalls: geckoCalls(), error: String((e as Error).stack ?? e).slice(0, 2000) });
  process.exitCode = 1;
} finally {
  await closeDb();
}

