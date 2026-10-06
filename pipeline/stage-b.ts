// Étape B : analyse on-chain des survivants, du critère le moins cher au plus cher.
import type { Sql } from "postgres";
import type { Config } from "../lib/config";
import { analyzeDevSell, type PricePoint } from "../lib/detection/devsell";
import { serialDevMetrics, top10Share, washMetrics } from "../lib/detection/distribution";
import { detectInsiders } from "../lib/detection/insiders";
import { judgeCriterion, isCto, STAGE_B_ORDER, type StageBExtra } from "../lib/detection/judge";
import { detectBundle, detectSnipers, topBuyers, type LaunchContext } from "../lib/detection/launch";
import { computeScore, isRunner } from "../lib/scoring";
import { INCINERATOR, isProgramOwned, PUMP_SUPPLY } from "../lib/solana";
import { emptyMetrics, type Metrics, type Reason, type ReasonCode, type Trade } from "../lib/types";
import type { CollectedCoin } from "./collect";
import {
  curvePrices,
  devLaunches,
  fetchLaunch,
  fetchMoreTrades,
  fundingEdges,
  largestHolders,
  launchesAlive,
  resolveHubs,
  walletFlow,
  type CurveCtx,
  type LaunchData,
} from "./onchain";
import { dexSnapshots, hasOfficialCto, type DexSnapshot } from "./sources/dexscreener";
import * as gecko from "./sources/geckoterminal";
import { BudgetExceeded, type CreditMeter, type Helius } from "./sources/helius";
import { log, mapLimit } from "./util";

export interface Evaluated {
  coin: CollectedCoin;
  stage: "A" | "B";
  status: "retained" | "dead" | "excluded" | "not_analyzed";
  metrics: Metrics;
  reasons: Reason[];
  tags: string[];
  score: number | null;
  scoreDetail: unknown;
  details: Record<string, unknown>;
  creditsUsed: number;
}

interface Ctx {
  helius: Helius;
  sql: Sql;
  cfg: Config;
  dayMeter: CreditMeter;
}

function baseMetrics(snap: DexSnapshot): Metrics {
  const m = emptyMetrics();
  m.mcap_usd = snap.mcapUsd;
  m.price_usd = snap.priceUsd;
  m.volume_24h_usd = snap.volume24hUsd;
  m.liquidity_usd = snap.liquidityUsd;
  m.txns_24h = snap.pair?.txns?.h24 ? snap.pair.txns.h24.buys + snap.pair.txns.h24.sells : null;
  return m;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const short = (list: { wallet: string; pct: number }[], n = 10) => list.slice(0, n).map((w) => ({ wallet: w.wallet, pct: round(w.pct) }));

async function analyzeCoin(coin: CollectedCoin, snap: DexSnapshot, ctx: Ctx): Promise<Evaluated> {
  const { helius, sql, cfg } = ctx;
  const b = cfg.stage_b;
  const meter = ctx.dayMeter.child(cfg.budget.helius_per_coin_cap, coin.mint);
  const m = baseMetrics(snap);
  const extra: StageBExtra = { bondingSeconds: coin.bonding_seconds, prebondTxCount: coin.prebond_tx_count };
  const details: Record<string, unknown> = {};
  const reasons: Reason[] = [];
  const curve: CurveCtx = {
    mint: coin.mint,
    bondingCurve: coin.bonding_curve,
    quoteMint: coin.quote_mint,
    migrationSignature: coin.migration_signature,
  };
  const devWallets = new Set([coin.creator_wallet].filter((x): x is string => !!x));

  let launch: LaunchData | null | undefined;
  const getLaunch = async () => {
    if (launch === undefined) {
      launch = await fetchLaunch(helius, curve, b.early_tx_limit, meter);
      if (launch) {
        devWallets.add(launch.devSigner);
        coin.dev_wallet = launch.devSigner;
      }
    }
    return launch;
  };
  const launchCtx = (l: LaunchData): LaunchContext => ({
    createSlot: l.createSlot,
    createTime: l.createTime,
    devWallets,
    supply: PUMP_SUPPLY,
  });
  let insiderWallets: string[] = [];

  const measure: Record<ReasonCode, () => Promise<void>> = {
    min_holders: async () => {
      const info = await gecko.tokenInfo(coin.mint);
      m.holders = info?.holders ?? null;
      if (info) {
        coin.description ??= info.description;
        coin.image_url ??= info.imageUrl;
        coin.twitter ??= info.twitter ? `https://x.com/${info.twitter}` : null;
        coin.telegram ??= info.telegram ? `https://t.me/${info.telegram}` : null;
        coin.website ??= info.websites[0] ?? null;
      }
    },
    wash_trading: async () => {
      const [activity, trades] = await Promise.all([gecko.poolActivity(coin.pool_address), gecko.poolTrades(coin.pool_address, coin.mint)]);
      const w = washMetrics(activity, trades);
      m.wash_tx_per_wallet = w.txPerWallet != null ? round(w.txPerWallet) : null;
      m.wash_roundtrip_share = w.roundtripShare != null ? round(w.roundtripShare, 3) : null;
      if (activity) {
        m.buyers_24h = activity.buyers;
        m.sellers_24h = activity.sellers;
        m.txns_24h = activity.buys + activity.sells;
      }
      details.wash = { loopers: w.loopers.length, sample: trades.length };
    },
    concentration: async () => {
      const { holders, supply } = await largestHolders(helius, coin.mint, meter);
      const excluded = (owner: string) =>
        owner === coin.pool_address || owner === coin.bonding_curve || owner === INCINERATOR || isProgramOwned(owner);
      const t = top10Share(holders, supply || PUMP_SUPPLY, excluded);
      m.top10_pct = round(t.pct);
      details.top_holders = t.holders.map((h) => ({ owner: h.owner, pct: round(h.pct) }));
    },
    fast_bond: async () => {
      if (coin.bonding_seconds == null || coin.bonding_seconds >= b.fast_bond_minutes * 60) return;
      const l = await getLaunch();
      if (!l) return;
      const buyers = new Set(l.trades.filter((t) => t.side === "buy").map((t) => t.wallet));
      let complete = l.complete;
      let lastSlot = l.trades.at(-1)?.slot ?? l.createSlot;
      // Lire la suite tant qu'on n'a ni tout lu, ni dépassé le seuil d'acheteurs (2 pages max).
      for (let i = 0; !complete && buyers.size < b.fast_bond_min_buyers && i < 2; i++) {
        const more = await fetchMoreTrades(helius, curve, lastSlot, 1000, meter);
        for (const t of more.trades) if (t.side === "buy") buyers.add(t.wallet);
        complete = more.reachedMigration;
        lastSlot = more.trades.at(-1)?.slot ?? lastSlot;
        if (!more.trades.length) break;
      }
      m.unique_buyers_prebond = buyers.size;
    },
    bundle: async () => {
      const l = await getLaunch();
      if (!l) return;
      const r = detectBundle(l.trades, launchCtx(l));
      m.bundle_pct = round(r.pct);
      m.bundle_wallets = r.wallets.length;
      details.bundle = { slot: r.slot, wallets: short(r.wallets) };
    },
    snipers: async () => {
      const l = await getLaunch();
      if (!l) return;
      const r = detectSnipers(l.trades, launchCtx(l), b.sniper_window_seconds);
      m.snipers_pct = round(r.pct);
      details.snipers = { until_slot: r.untilSlot, wallets: short(r.wallets) };
    },
    insiders: async () => {
      const l = await getLaunch();
      if (!l) return;
      const top = topBuyers(l.trades, PUMP_SUPPLY, b.insider_candidates);
      const firstTrade = new Map<string, Trade>();
      for (const t of l.trades) if (!firstTrade.has(t.wallet)) firstTrade.set(t.wallet, t);
      const candidates = [
        ...[...devWallets].map((w) => ({ wallet: w, firstSignature: l.createSignature, firstTime: l.createTime })),
        ...top
          .filter((t) => !devWallets.has(t.wallet))
          .map((t) => ({ wallet: t.wallet, firstSignature: firstTrade.get(t.wallet)!.signature, firstTime: firstTrade.get(t.wallet)!.blockTime })),
      ];
      const edges = await fundingEdges(helius, sql, candidates, b.insider_funding_lookback_hours, meter);
      // Seuls les financeurs qui créeraient un lien (partagés, ou financeur du dev) sont vérifiés comme hubs.
      const count = new Map<string, number>();
      for (const e of edges) if (e.funder) count.set(e.funder, (count.get(e.funder) ?? 0) + 1);
      const devFunders = edges.filter((e) => devWallets.has(e.wallet) && e.funder).map((e) => e.funder!);
      const linking = [...count].filter(([f, n]) => n >= 2 || devFunders.includes(f)).map(([f]) => f);
      const hubs = await resolveHubs(helius, sql, linking, b.hub_balance_sol, meter);
      const r = detectInsiders(l.trades, edges, { devWallets, supply: PUMP_SUPPLY, hubs, minCluster: b.insider_min_cluster });
      m.insiders_pct = round(r.pct);
      m.insider_wallets = r.wallets.length;
      insiderWallets = r.clusters.filter((c) => c.containsDev).flatMap((c) => c.wallets);
      details.insiders = {
        dev: [...devWallets],
        clusters: r.clusters.slice(0, 6).map((c) => ({ funder: c.funder, dev: c.containsDev, pct: round(c.pct), wallets: c.wallets.slice(0, 12) })),
        hubs_ignored: [...hubs],
      };
    },
    dev_sell: async () => {
      const wallets = [...new Set([...devWallets, ...insiderWallets])].slice(0, 8);
      const flows = [];
      for (const w of wallets) flows.push(await walletFlow(helius, w, coin.mint, coin.quote_mint, meter));
      const sold = flows.reduce((s, f) => s + f.sells.reduce((a, x) => a + x.tokens, 0), 0);
      if (sold === 0) {
        m.dev_sold_pct = 0;
        m.dev_sell_drop_pct = 0;
        details.dev_sell = { wallets: wallets.length, sold: 0 };
        return;
      }
      // Prix autour de la plus grosse vague de ventes
      const sells = flows.flatMap((f) => f.sells).sort((a, b2) => b2.tokens - a.tokens);
      const t0 = sells[0].time;
      const horizon = b.dev_sell_impact_minutes * 60;
      let prices: PricePoint[] = [];
      let currentPrice: number | null = null;
      if (t0 >= coin.bonded_at.getTime() / 1000) {
        const candles = await gecko.ohlcv(coin.pool_address, {
          timeframe: "minute",
          aggregate: 1,
          limit: Math.min(1000, b.dev_sell_impact_minutes + 30),
          before: t0 + horizon + 60,
        });
        prices = candles.flatMap((c) => [
          { time: c.time, price: c.open },
          { time: c.time + 30, price: c.low },
        ]);
        currentPrice = snap.priceUsd;
      } else {
        prices = await curvePrices(helius, curve, t0 - 300, t0 + horizon, meter);
        currentPrice = snap.pair?.priceNative ? Number(snap.pair.priceNative) : null;
      }
      const r = analyzeDevSell(flows, prices, { impactMinutes: b.dev_sell_impact_minutes, currentPrice });
      m.dev_sold_pct = round(r.soldPct, 1);
      m.dev_sell_drop_pct = r.dropPct != null ? round(r.dropPct, 1) : null;
      m.cto_recovery_multiple = r.recoveryMultiple != null ? round(r.recoveryMultiple) : null;
      if ((m.dev_sold_pct ?? 0) >= b.dev_sell_min_sold_pct && (m.dev_sell_drop_pct ?? 0) >= b.dev_sell_drop_pct) {
        m.cto_official = await hasOfficialCto(coin.mint);
      }
      details.dev_sell = {
        wallets: wallets.length,
        dump_at: r.dumpAt ? new Date(r.dumpAt * 1000).toISOString() : null,
        transfers_out: round(flows.reduce((s, f) => s + f.transfersOut, 0), 0),
      };
    },
    serial_dev: async () => {
      const dev = coin.dev_wallet ?? coin.creator_wallet;
      if (!dev) return;
      const now = Date.now() / 1000;
      const { launches, truncated } = await devLaunches(helius, dev, now - 30 * 86400, 3, meter);
      const others = launches.filter((l) => l.mint !== coin.mint);
      const statuses = await launchesAlive(
        helius,
        others,
        async (mints) => {
          const snaps = await dexSnapshots(mints.map((mint) => ({ mint })));
          const ref = coin.migration_mcap_usd ?? 0;
          return new Set(mints.filter((x) => (snaps.get(x)?.mcapUsd ?? 0) >= ref));
        },
        now,
        meter,
      );
      const s = serialDevMetrics([...statuses, { mint: coin.mint, createdAt: now, alive: true }], now);
      m.dev_launches_30d = s.launches;
      m.dev_dead_30d = s.dead;
      details.serial_dev = { dev, truncated };
    },
    // Codes non utilisés à l'étape B
    dead_after_bond: async () => {},
    ghost_bond: async () => {},
    not_analyzed: async () => {},
  };

  let partial: string | null = null;
  for (const code of STAGE_B_ORDER) {
    try {
      await measure[code]();
    } catch (e) {
      if (e instanceof BudgetExceeded && e.message.includes(coin.mint)) {
        partial = `budget du coin atteint pendant « ${code} »`;
        break;
      }
      if (e instanceof BudgetExceeded) throw e;
      details[`error_${code}`] = (e as Error).message.slice(0, 200);
      continue;
    }
    const r = judgeCriterion(code, m, extra, cfg);
    if (r) {
      reasons.push(r);
      if (b.short_circuit) break;
    }
  }
  if (partial) details.partial = partial;

  const tags: string[] = [];
  if (isCto(m, cfg)) tags.push("CTO");
  let score: number | null = null;
  let scoreDetail: unknown = null;
  const status = reasons.length ? "excluded" : "retained";
  if (status === "retained") {
    try {
      await fillAth(coin, m);
    } catch (e) {
      details.error_ath = (e as Error).message.slice(0, 200);
    }
    if (isRunner(m, coin.migration_mcap_usd, cfg)) tags.push("Runner");
    const s = computeScore(m, coin.migration_mcap_usd, cfg);
    score = s.score;
    scoreDetail = s.detail;
  }
  return { coin, stage: "B", status, metrics: m, reasons, tags, score, scoreDetail, details, creditsUsed: meter.used };
}

/** ATH après migration : plus haut des bougies 15 min de la pool (USD) × supply. */
async function fillAth(coin: CollectedCoin, m: Metrics) {
  const candles = await gecko.ohlcv(coin.pool_address, { timeframe: "minute", aggregate: 15, limit: 1000 });
  const after = candles.filter((c) => c.time >= coin.bonded_at.getTime() / 1000 - 900);
  if (!after.length) return;
  const best = after.reduce((a, c) => (c.high > a.high ? c : a));
  m.ath_mcap_usd = Math.round(best.high * PUMP_SUPPLY);
  m.ath_at = new Date(best.time * 1000).toISOString();
  if (m.mcap_usd != null && m.ath_mcap_usd < m.mcap_usd) m.ath_mcap_usd = m.mcap_usd;
}

export async function stageB(items: { coin: CollectedCoin; snap: DexSnapshot }[], ctx: Ctx): Promise<Evaluated[]> {
  // Les plus prometteurs d'abord : si le budget du jour s'épuise, ce sont les moins intéressants qui attendent.
  const sorted = [...items].sort((a, b) => (b.snap.mcapUsd ?? 0) - (a.snap.mcapUsd ?? 0));
  let exhausted = false;
  let done = 0;
  return mapLimit(sorted, 3, async ({ coin, snap }) => {
    if (!exhausted) {
      try {
        const r = await analyzeCoin(coin, snap, ctx);
        if (++done % 10 === 0) log(`  étape B : ${done}/${sorted.length} (crédits du jour : ${ctx.dayMeter.used})`);
        return r;
      } catch (e) {
        if (!(e instanceof BudgetExceeded)) {
          log(`  ⚠ ${coin.symbol} ${coin.mint} : ${(e as Error).message}`);
          return notAnalyzed(coin, snap, (e as Error).message);
        }
        exhausted = true;
      }
    }
    return notAnalyzed(coin, snap, "budget Helius du jour atteint");
  });
}

function notAnalyzed(coin: CollectedCoin, snap: DexSnapshot, why: string): Evaluated {
  return {
    coin,
    stage: "B",
    status: "not_analyzed",
    metrics: baseMetrics(snap),
    reasons: [{ code: "not_analyzed", label: "Non analysé", detail: why }],
    tags: [],
    score: null,
    scoreDetail: null,
    details: {},
    creditsUsed: 0,
  };
}
