// GeckoTerminal (gratuit, sans clé, 30 req/min) : holders, activité de la pool, trades, OHLCV.
import { RateLimitedClient } from "./http";

const BASE = "https://api.geckoterminal.com/api/v2/networks/solana";
// 30 req/min annoncées, mais des refus (429) apparaissent avant : 1 requête toutes les 3 s.
const client = new RateLimitedClient("GeckoTerminal", 3000, 20_000);

type Attr<T> = { data: { attributes: T } };

export interface GeckoTokenInfo {
  holders: number | null;
  top10Pct: number | null;
  developer: string | null;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  websites: string[];
  imageUrl: string | null;
  completedAt: string | null;
  migratedPool: string | null;
}

export async function tokenInfo(mint: string): Promise<GeckoTokenInfo | null> {
  const res = await client.getJson<
    Attr<{
      holders?: { count?: number; distribution_percentage?: { top_10?: string } };
      developer_address?: string;
      description?: string;
      twitter_handle?: string;
      telegram_handle?: string;
      websites?: string[];
      image_url?: string;
      launchpad_details?: { completed_at?: string; migrated_destination_pool_address?: string };
    }>
  >(`${BASE}/tokens/${mint}/info`, { allow404: true });
  if (!res) return null;
  const a = res.data.attributes;
  return {
    holders: a.holders?.count ?? null,
    top10Pct: a.holders?.distribution_percentage?.top_10 ? Number(a.holders.distribution_percentage.top_10) : null,
    developer: a.developer_address ?? null,
    description: a.description ?? null,
    twitter: a.twitter_handle ?? null,
    telegram: a.telegram_handle ?? null,
    websites: a.websites ?? [],
    imageUrl: a.image_url && !a.image_url.includes("missing") ? a.image_url : null,
    completedAt: a.launchpad_details?.completed_at ?? null,
    migratedPool: a.launchpad_details?.migrated_destination_pool_address ?? null,
  };
}

export interface GeckoPool {
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
  createdAt: string | null;
}

export async function poolActivity(pool: string): Promise<GeckoPool | null> {
  const res = await client.getJson<
    Attr<{ pool_created_at?: string; transactions?: { h24?: { buys: number; sells: number; buyers: number; sellers: number } } }>
  >(`${BASE}/pools/${pool}`, { allow404: true });
  const t = res?.data.attributes.transactions?.h24;
  if (!res || !t) return null;
  return { ...t, createdAt: res.data.attributes.pool_created_at ?? null };
}

export interface GeckoTrade {
  wallet: string;
  kind: "buy" | "sell";
  volumeUsd: number;
  time: number;
  /** Prix du token en USD lors du trade. */
  priceUsd: number | null;
}

/** Les ~300 derniers trades (24 h max) de la pool. */
export async function poolTrades(pool: string, mint: string): Promise<GeckoTrade[]> {
  const res = await client.getJson<{
    data: {
      attributes: {
        tx_from_address: string;
        kind: "buy" | "sell";
        volume_in_usd: string;
        block_timestamp: string;
        from_token_address: string;
        price_from_in_usd: string;
        price_to_in_usd: string;
      };
    }[];
  }>(`${BASE}/pools/${pool}/trades`, { allow404: true });
  return (res?.data ?? []).map(({ attributes: a }) => ({
    wallet: a.tx_from_address,
    kind: a.kind,
    volumeUsd: Number(a.volume_in_usd),
    time: Date.parse(a.block_timestamp) / 1000,
    priceUsd: Number(a.from_token_address === mint ? a.price_from_in_usd : a.price_to_in_usd) || null,
  }));
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Bougies en USD (prix du token). `timeframe` minute/hour/day ; `aggregate` 1,5,15 (minute) ou 1,4,12 (hour).
 * Jusqu'à 1 000 bougies, les plus récentes avant `before` (secondes).
 */
export async function ohlcv(
  pool: string,
  opts: { timeframe: "minute" | "hour" | "day"; aggregate?: number; limit?: number; before?: number; token?: "base" | "quote" },
): Promise<Candle[]> {
  const q = new URLSearchParams({
    aggregate: String(opts.aggregate ?? 1),
    limit: String(opts.limit ?? 1000),
    currency: "usd",
    token: opts.token ?? "base",
  });
  if (opts.before) q.set("before_timestamp", String(Math.floor(opts.before)));
  const res = await client.getJson<{ data: { attributes: { ohlcv_list: number[][] } } }>(
    `${BASE}/pools/${pool}/ohlcv/${opts.timeframe}?${q}`,
    { allow404: true },
  );
  return (res?.data.attributes.ohlcv_list ?? [])
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
}

export const geckoCalls = () => client.calls;
export const geckoRateLimited = () => client.rateLimited;
