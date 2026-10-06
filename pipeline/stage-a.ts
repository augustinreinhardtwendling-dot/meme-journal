// Étape A (gratuite) : le coin tient-il encore après la migration ?
import type { Config } from "../lib/config";
import { judgeStageA } from "../lib/detection/judge";
import type { Reason } from "../lib/types";
import type { CollectedCoin } from "./collect";
import { dexSnapshots, type DexSnapshot } from "./sources/dexscreener";

export interface StageAResult {
  coin: CollectedCoin;
  snap: DexSnapshot;
  reason: Reason | null;
}

export async function stageA(coins: CollectedCoin[], cfg: Config): Promise<StageAResult[]> {
  const snaps = await dexSnapshots(coins.map((c) => ({ mint: c.mint, pool: c.pool_address })));
  return coins.map((coin) => {
    const snap = snaps.get(coin.mint) ?? { pair: null, mcapUsd: null, priceUsd: null, volume24hUsd: null, liquidityUsd: null };
    return {
      coin,
      snap,
      reason: judgeStageA(
        { migrationMcapUsd: coin.migration_mcap_usd, mcapUsd: snap.mcapUsd, volume24hUsd: snap.volume24hUsd },
        cfg,
      ),
    };
  });
}
