// Étape 1 : tous les coins pump.fun migrés pendant la fenêtre.
import type { Sql } from "postgres";
import type { Config } from "../lib/config";
import { parseMigration, type Migration } from "../lib/onchain/parse";
import { PUMP_MIGRATION_AUTHORITY, PUMP_SUPPLY, WSOL_MINT } from "../lib/solana";
import type { ParsedTx } from "../lib/types";
import { quotePricesUsd } from "./sources/dexscreener";
import { ohlcv } from "./sources/geckoterminal";
import type { Helius } from "./sources/helius";
import { offchainMetadata, onchainMetadata } from "./sources/metadata";
import { log, mapLimit } from "./util";

/** Pool SOL/USDC très liquide (Orca) servant de référence pour le prix historique du SOL. */
const SOL_USDC_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";

export interface CollectedCoin {
  mint: string;
  name: string | null;
  symbol: string | null;
  description: string | null;
  image_url: string | null;
  metadata_uri: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  token_program: string | null;
  bonding_curve: string;
  pool_address: string;
  migration_signature: string;
  migration_instruction: string;
  bonded_at: Date;
  created_at: Date | null;
  bonding_seconds: number | null;
  prebond_tx_count: number | null;
  quote_mint: string;
  quote_symbol: string | null;
  pool_base: number;
  pool_quote: number;
  migration_mcap_sol: number | null;
  migration_mcap_usd: number | null;
  migration_liquidity_usd: number | null;
  is_ghost: boolean;
  creator_wallet: string | null;
  dev_wallet: string | null;
}

/** Toutes les vraies migrations entre `start` et `end`, dédoublonnées par mint. */
export async function listMigrations(helius: Helius, start: Date, end: Date): Promise<Migration[]> {
  const byMint = new Map<string, Migration>();
  let token: string | undefined;
  let txCount = 0;
  do {
    const page = await helius.getTransactionsForAddress(PUMP_MIGRATION_AUTHORITY, {
      transactionDetails: "full",
      sortOrder: "asc",
      limit: 100,
      paginationToken: token,
      filters: {
        blockTime: { gte: Math.floor(start.getTime() / 1000), lt: Math.floor(end.getTime() / 1000) },
        status: "succeeded",
      },
    });
    txCount += page.data.length;
    for (const tx of page.data) {
      const m = parseMigration(tx as ParsedTx);
      if (m && !byMint.has(m.mint)) byMint.set(m.mint, m);
    }
    token = page.paginationToken ?? undefined;
    if (txCount % 1000 < 100) log(`  migrations : ${txCount} tx lues, ${byMint.size} coins`);
  } while (token);
  log(`  ${txCount} tx réussies sur le compte de migration → ${byMint.size} vraies migrations`);
  return [...byMint.values()];
}

/** Prix horaire du SOL (USD) couvrant la fenêtre. */
async function solPriceByHour(end: Date): Promise<Map<number, number>> {
  const candles = await ohlcv(SOL_USDC_POOL, { timeframe: "hour", limit: 200, before: end.getTime() / 1000 + 7200 });
  return new Map(candles.map((c) => [c.time, c.close]));
}

function priceAt(series: Map<number, number>, t: number): number | null {
  const hour = Math.floor(t / 3600) * 3600;
  return series.get(hour) ?? series.get(hour - 3600) ?? series.get(hour + 3600) ?? null;
}

/** Date de la 1re tx de la curve et nombre de tx avant migration (pagination des signatures). */
async function curveHistory(helius: Helius, curve: string, migrationSig: string, maxPages: number) {
  let before = migrationSig;
  let count = 0;
  let oldest: number | null = null;
  for (let page = 0; page < maxPages; page++) {
    const sigs = await helius.getSignaturesForAddress(curve, { before, limit: 1000 });
    for (const s of sigs) if (!s.err) count++;
    const last = sigs.at(-1);
    if (last?.blockTime) oldest = last.blockTime;
    if (sigs.length < 1000) return { createdAt: oldest, count, complete: true };
    before = last!.signature;
  }
  return { createdAt: null, count, complete: false };
}

/** Recharge les coins déjà collectés pour un journal (relance de l'analyse sans refaire la collecte). */
export async function loadCollected(sql: Sql, journalDate: string): Promise<CollectedCoin[]> {
  const rows = await sql<CollectedCoin[]>`
    select mint, name, symbol, description, image_url, metadata_uri, twitter, telegram, website, token_program,
      bonding_curve, pool_address, migration_signature, migration_instruction, bonded_at, created_at, bonding_seconds,
      prebond_tx_count, quote_mint, quote_symbol, pool_base, pool_quote, migration_mcap_sol, migration_mcap_usd,
      migration_liquidity_usd, is_ghost, creator_wallet, dev_wallet
    from coins where journal_date = ${journalDate}`;
  return rows;
}

/** Complète les descriptions/réseaux manquants (passerelles IPFS indisponibles lors de la collecte). */
export async function refreshMissingMetadata(coins: CollectedCoin[]) {
  const missing = coins.filter((c) => !c.is_ghost && !c.description && c.metadata_uri);
  if (!missing.length) return;
  const md = await offchainMetadata(new Map(missing.map((c) => [c.mint, c.metadata_uri!])));
  for (const c of missing) {
    const m = md.get(c.mint);
    if (m) Object.assign(c, { description: m.description, image_url: c.image_url ?? m.image, twitter: c.twitter ?? m.twitter, telegram: c.telegram ?? m.telegram, website: c.website ?? m.website });
  }
  log(`  métadonnées complétées : ${md.size}/${missing.length}`);
}

export async function collect(helius: Helius, start: Date, end: Date, cfg: Config): Promise<CollectedCoin[]> {
  log("Collecte des migrations…");
  const migrations = await listMigrations(helius, start, end);
  if (!migrations.length) return [];

  // Prix de la quote au moment de la migration
  const solHours = await solPriceByHour(end);
  const otherQuotes = [...new Set(migrations.map((m) => m.quoteMint).filter((q) => q !== WSOL_MINT))];
  const otherPrices = otherQuotes.length ? await quotePricesUsd(otherQuotes) : new Map();
  const quoteSymbols = new Map<string, string>([[WSOL_MINT, "SOL"]]);
  for (const q of otherQuotes) quoteSymbols.set(q, otherPrices.get(q)?.symbol ?? q.slice(0, 4));

  // Wallet « creator » inscrit dans la bonding curve (offset 49)
  const curves = await helius.getMultipleAccounts<{ data: [string, string] }>(
    migrations.map((m) => m.bondingCurve),
    "base64",
  );
  const creators = new Map<string, string>();
  const { PublicKey } = await import("@solana/web3.js");
  migrations.forEach((m, i) => {
    const raw = curves[i]?.data?.[0];
    if (!raw) return;
    const buf = Buffer.from(raw, "base64");
    if (buf.length >= 81) creators.set(m.mint, new PublicKey(buf.subarray(49, 81)).toBase58());
  });

  const coins: CollectedCoin[] = migrations.map((m) => {
    const quoteUsd = m.quoteMint === WSOL_MINT ? priceAt(solHours, m.blockTime) : otherPrices.get(m.quoteMint)?.price ?? null;
    const priceInQuote = m.poolBase > 0 ? m.poolQuote / m.poolBase : 0;
    const mcapQuote = priceInQuote * PUMP_SUPPLY;
    const liquidityUsd = quoteUsd != null ? m.poolQuote * quoteUsd : null;
    return {
      mint: m.mint,
      name: null,
      symbol: null,
      description: null,
      image_url: null,
      metadata_uri: null,
      twitter: null,
      telegram: null,
      website: null,
      token_program: null,
      bonding_curve: m.bondingCurve,
      pool_address: m.pool,
      migration_signature: m.signature,
      migration_instruction: m.instruction,
      bonded_at: new Date(m.blockTime * 1000),
      created_at: null,
      bonding_seconds: null,
      prebond_tx_count: null,
      quote_mint: m.quoteMint,
      quote_symbol: quoteSymbols.get(m.quoteMint) ?? null,
      pool_base: m.poolBase,
      pool_quote: m.poolQuote,
      migration_mcap_sol: m.quoteMint === WSOL_MINT ? mcapQuote : null,
      migration_mcap_usd: quoteUsd != null ? mcapQuote * quoteUsd : null,
      migration_liquidity_usd: liquidityUsd,
      is_ghost: liquidityUsd != null && liquidityUsd < cfg.collect.ghost_bond_max_liquidity_usd,
      creator_wallet: creators.get(m.mint) ?? null,
      dev_wallet: creators.get(m.mint) ?? null,
    };
  });
  const real = coins.filter((c) => !c.is_ghost);
  log(`  ${real.length} bondings normaux, ${coins.length - real.length} migrations fantômes`);

  // Métadonnées : nom/ticker on-chain pour tous, JSON IPFS pour les vrais bondings
  log("Métadonnées…");
  const onchain = await onchainMetadata(helius, coins.map((c) => c.mint));
  for (const c of coins) {
    const md = onchain.get(c.mint);
    if (!md) continue;
    c.name = md.name;
    c.symbol = md.symbol;
    c.metadata_uri = md.uri;
    c.token_program = md.tokenProgram;
  }
  const uris = new Map(real.filter((c) => c.metadata_uri).map((c) => [c.mint, c.metadata_uri!]));
  const offchain = await offchainMetadata(uris);
  for (const c of real) {
    const md = offchain.get(c.mint);
    if (!md) continue;
    Object.assign(c, { description: md.description, image_url: md.image, twitter: md.twitter, telegram: md.telegram, website: md.website });
  }
  log(`  métadonnées IPFS : ${offchain.size}/${uris.size}`);

  // Date de création et nombre de tx avant bonding
  log("Dates de création…");
  let dated = 0;
  await mapLimit(real, 8, async (c) => {
    if (++dated % 200 === 0) log(`  ${dated}/${real.length} (crédits : ${helius.meter.used})`);
    try {
      const h = await curveHistory(helius, c.bonding_curve, c.migration_signature, cfg.collect.max_signature_pages);
      c.prebond_tx_count = h.count;
      if (h.createdAt) {
        c.created_at = new Date(h.createdAt * 1000);
        c.bonding_seconds = Math.max(0, Math.round((c.bonded_at.getTime() - c.created_at.getTime()) / 1000));
      }
    } catch (e) {
      log(`  ⚠ historique ${c.mint} : ${(e as Error).message}`);
    }
  });
  return coins;
}
