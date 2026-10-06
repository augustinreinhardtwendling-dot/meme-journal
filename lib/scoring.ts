// Score 0–100 = qualité de la distribution (50) + performance après bonding (50).
import type { Config } from "./config";
import type { Metrics } from "./types";

const clamp = (x: number) => Math.max(0, Math.min(1, x));
/** 1 quand la mesure est nulle, 0 quand elle atteint le seuil d'exclusion ; neutre (0,5) si non mesurée. */
const belowThreshold = (v: number | null, max: number) => (v == null ? 0.5 : clamp(1 - v / max));

export interface ScoreDetail {
  distribution: number;
  performance: number;
  parts: Record<string, number>;
}

export function computeScore(m: Metrics, migrationMcapUsd: number | null, cfg: Config): { score: number; detail: ScoreDetail } {
  const b = cfg.stage_b;
  const parts: Record<string, number> = {};

  // --- Distribution (50)
  parts.top10 = 12 * belowThreshold(m.top10_pct, b.top10_max_pct);
  parts.bundle = 8 * belowThreshold(m.bundle_pct, b.bundle_max_pct);
  parts.insiders = 10 * belowThreshold(m.insiders_pct, b.insiders_max_pct);
  parts.snipers = 8 * belowThreshold(m.snipers_pct, b.snipers_max_pct);
  parts.holders = 8 * (m.holders == null ? 0.5 : clamp(Math.log10(Math.max(1, m.holders) / b.min_holders) / Math.log10(30)));
  parts.wash = 4 * belowThreshold(m.wash_roundtrip_share, b.wash_max_roundtrip_share);
  const distribution = parts.top10 + parts.bundle + parts.insiders + parts.snipers + parts.holders + parts.wash;

  // --- Performance (50)
  const mig = migrationMcapUsd && migrationMcapUsd > 0 ? migrationMcapUsd : null;
  const nowMult = mig && m.mcap_usd ? m.mcap_usd / mig : null;
  const athMult = mig && m.ath_mcap_usd ? m.ath_mcap_usd / mig : null;
  parts.current = 20 * (nowMult == null ? 0 : clamp(Math.log2(nowMult) / 5)); // 32× → max
  parts.ath = 15 * (athMult == null ? 0 : clamp(Math.log2(athMult) / Math.log2(50))); // 50× → max
  const volRatio = m.volume_24h_usd != null && m.mcap_usd ? m.volume_24h_usd / m.mcap_usd : null;
  // Volume sain : entre 0,3× et 3× la mcap par jour ; trop peu = coin oublié, beaucoup trop = churn.
  parts.volume = 7 * (volRatio == null ? 0 : volRatio < 0.3 ? clamp(volRatio / 0.3) : volRatio <= 3 ? 1 : clamp(1 - (volRatio - 3) / 12));
  const liqRatio = m.liquidity_usd != null && m.mcap_usd ? m.liquidity_usd / m.mcap_usd : null;
  parts.liquidity = 8 * (liqRatio == null ? 0 : clamp(liqRatio / 0.08));
  const performance = parts.current + parts.ath + parts.volume + parts.liquidity;

  for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 10) / 10;
  return {
    score: Math.round(distribution + performance),
    detail: { distribution: Math.round(distribution), performance: Math.round(performance), parts },
  };
}

export function isRunner(m: Metrics, migrationMcapUsd: number | null, cfg: Config): boolean {
  return !!(migrationMcapUsd && m.ath_mcap_usd && m.ath_mcap_usd >= cfg.score.runner_ath_multiple * migrationMcapUsd);
}
