// DexScreener (gratuit, sans clé) : prix, mcap, volume, liquidité, réseaux, CTO.
import { RateLimitedClient } from "./http";

const BASE = "https://api.dexscreener.com";
// Les endpoints tokens/pairs acceptent 300 req/min ; on reste à ~4 req/s.
const client = new RateLimitedClient("DexScreener", 250);

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys: number; sells: number } };
  pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
}

export interface DexSnapshot {
  pair: DexPair | null;
  mcapUsd: number | null;
  priceUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
}

/** Données de marché par mint, par lots de 30. La pair retenue est la pool de migration si présente. */
export async function dexSnapshots(items: { mint: string; pool?: string | null }[]): Promise<Map<string, DexSnapshot>> {
  const out = new Map<string, DexSnapshot>();
  for (let i = 0; i < items.length; i += 30) {
    const batch = items.slice(i, i + 30);
    const pairs = (await client.getJson<DexPair[]>(`${BASE}/tokens/v1/solana/${batch.map((b) => b.mint).join(",")}`)) ?? [];
    for (const { mint, pool } of batch) {
      const mine = pairs.filter((p) => p.baseToken.address === mint);
      const pair =
        mine.find((p) => p.pairAddress === pool) ??
        mine.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ??
        null;
      // Volume total sur toutes les pools du token (certains coins ont plusieurs pools)
      const volume = mine.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0);
      out.set(mint, {
        pair,
        mcapUsd: pair?.marketCap ?? pair?.fdv ?? null,
        priceUsd: pair?.priceUsd ? Number(pair.priceUsd) : null,
        volume24hUsd: pair ? volume : null,
        liquidityUsd: pair?.liquidity?.usd ?? null,
      });
    }
  }
  return out;
}

/** Prix USD actuel de tokens de quote (SOL, PUMP…) : la pair la plus liquide de chacun. */
export async function quotePricesUsd(mints: string[]): Promise<Map<string, { price: number; symbol: string }>> {
  const out = new Map<string, { price: number; symbol: string }>();
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const pairs = (await client.getJson<DexPair[]>(`${BASE}/tokens/v1/solana/${batch.join(",")}`)) ?? [];
    for (const m of batch) {
      const best = pairs
        .filter((p) => p.baseToken.address === m && p.priceUsd)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (best?.priceUsd) out.set(m, { price: Number(best.priceUsd), symbol: best.baseToken.symbol });
    }
  }
  return out;
}

/** Commandes payées sur DexScreener : un « communityTakeover » approuvé = CTO officiel. */
export async function hasOfficialCto(mint: string): Promise<boolean> {
  const res = await client.getJson<{ orders?: { type: string; status: string }[] }>(`${BASE}/orders/v1/solana/${mint}`, {
    allow404: true,
  });
  return !!res?.orders?.some((o) => o.type === "communityTakeover" && o.status === "approved");
}

/** Metas tendance du moment (contexte pour les fiches). */
export async function trendingMetas() {
  return (
    (await client.getJson<{ name: string; slug: string; tokenCount: number; marketCap: number; volume: number; marketCapChange?: { h24?: number } }[]>(
      `${BASE}/metas/trending/v1`,
    )) ?? []
  );
}

export const dexscreenerCalls = () => client.calls;
