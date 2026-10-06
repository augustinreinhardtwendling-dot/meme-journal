// Dev sell : le dev (ou un wallet lié) a vendu une grosse partie de ses tokens et fait chuter le prix.

export interface WalletFlow {
  wallet: string;
  /** Tokens obtenus (achats + transferts reçus). */
  acquired: number;
  sells: { time: number; tokens: number }[];
}

export interface PricePoint {
  time: number;
  price: number;
}

export interface DevSellResult {
  soldPct: number;
  /** Chute maximale (en %) entre le prix juste avant la plus grosse vague de ventes et le plus bas qui suit. */
  dropPct: number | null;
  dumpAt: number | null;
  lowAfterDump: number | null;
  /** Prix actuel / plus bas après le dump. */
  recoveryMultiple: number | null;
}

/** Regroupe les ventes proches dans le temps (moins de `gapSeconds` entre deux ventes). */
function sellWaves(sells: { time: number; tokens: number }[], gapSeconds: number) {
  const sorted = [...sells].sort((a, b) => a.time - b.time);
  const waves: { start: number; end: number; tokens: number }[] = [];
  for (const s of sorted) {
    const last = waves.at(-1);
    if (last && s.time - last.end <= gapSeconds) {
      last.end = s.time;
      last.tokens += s.tokens;
    } else waves.push({ start: s.time, end: s.time, tokens: s.tokens });
  }
  return waves;
}

export function analyzeDevSell(
  flows: WalletFlow[],
  prices: PricePoint[],
  opts: { impactMinutes: number; currentPrice: number | null; waveGapSeconds?: number },
): DevSellResult {
  const acquired = flows.reduce((s, f) => s + f.acquired, 0);
  const allSells = flows.flatMap((f) => f.sells);
  const sold = allSells.reduce((s, x) => s + x.tokens, 0);
  const soldPct = acquired > 0 ? Math.min(100, (sold / acquired) * 100) : 0;
  const empty: DevSellResult = { soldPct, dropPct: null, dumpAt: null, lowAfterDump: null, recoveryMultiple: null };
  if (sold === 0 || prices.length === 0) return empty;

  const waves = sellWaves(allSells, opts.waveGapSeconds ?? 600);
  const biggest = waves.sort((a, b) => b.tokens - a.tokens)[0];
  const series = [...prices].sort((a, b) => a.time - b.time);
  const before = series.filter((p) => p.time <= biggest.start).at(-1) ?? series.find((p) => p.time >= biggest.start);
  const windowEnd = biggest.end + opts.impactMinutes * 60;
  const after = series.filter((p) => p.time >= biggest.start && p.time <= windowEnd);
  if (!before || after.length === 0) return { ...empty, dumpAt: biggest.start };
  const low = Math.min(...after.map((p) => p.price));
  const dropPct = Math.max(0, (1 - low / before.price) * 100);
  return {
    soldPct,
    dropPct,
    dumpAt: biggest.start,
    lowAfterDump: low,
    recoveryMultiple: opts.currentPrice && low > 0 ? opts.currentPrice / low : null,
  };
}
