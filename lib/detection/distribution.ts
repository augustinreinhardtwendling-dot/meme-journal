// Concentration, wash trading, bonding artificiel, dev récidiviste.

export interface HolderAccount {
  owner: string;
  amount: number;
}

/**
 * Part de la supply détenue par les 10 plus gros holders, hors pool, burn et comptes de programme.
 * Plusieurs comptes d'un même propriétaire sont additionnés.
 */
export function top10Share(
  accounts: HolderAccount[],
  supply: number,
  isExcluded: (owner: string) => boolean,
) {
  const byOwner = new Map<string, number>();
  for (const a of accounts) {
    if (isExcluded(a.owner)) continue;
    byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0) + a.amount);
  }
  const top = [...byOwner].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const held = top.reduce((s, [, v]) => s + v, 0);
  return {
    pct: supply > 0 ? (held / supply) * 100 : 0,
    holders: top.map(([owner, amount]) => ({ owner, pct: supply > 0 ? (amount / supply) * 100 : 0 })),
  };
}

export interface PoolActivity {
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
}

export interface RecentTrade {
  wallet: string;
  kind: "buy" | "sell";
  volumeUsd: number;
}

/**
 * Wash trading :
 *  - nombre de transactions par wallet unique sur 24 h ;
 *  - part du volume récent faite par des wallets qui achètent ET revendent en boucle (≥ 2 de chaque).
 */
export function washMetrics(activity: PoolActivity | null, trades: RecentTrade[]) {
  const txPerWallet = activity
    ? (activity.buys + activity.sells) / Math.max(1, Math.max(activity.buyers, activity.sellers))
    : null;
  const per = new Map<string, { b: number; s: number; vol: number }>();
  let total = 0;
  for (const t of trades) {
    const e = per.get(t.wallet) ?? { b: 0, s: 0, vol: 0 };
    if (t.kind === "buy") e.b++;
    else e.s++;
    e.vol += t.volumeUsd;
    total += t.volumeUsd;
    per.set(t.wallet, e);
  }
  const loopers = [...per].filter(([, e]) => e.b >= 2 && e.s >= 2);
  const loopVol = loopers.reduce((s, [, e]) => s + e.vol, 0);
  return {
    txPerWallet,
    roundtripShare: trades.length >= 20 && total > 0 ? loopVol / total : null,
    loopers: loopers.map(([w]) => w),
  };
}

export interface DevLaunch {
  mint: string;
  createdAt: number;
  /** Encore en vie : bondé et mcap ≥ mcap de migration, ou toujours actif sur la curve. */
  alive: boolean;
}

export function serialDevMetrics(launches: DevLaunch[], now: number, days = 30) {
  const recent = launches.filter((l) => now - l.createdAt <= days * 86400);
  const dead = recent.filter((l) => !l.alive).length;
  return { launches: recent.length, dead, deadShare: recent.length ? dead / recent.length : 0 };
}
