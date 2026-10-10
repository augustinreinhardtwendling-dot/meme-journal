// Applique les seuils aux métriques mesurées. Fonction pure : sert au pipeline ET au recalcul
// des verdicts (calibrage) sans refaire d'appels.
import type { Config } from "../config";
import { REASON_LABELS, type Metrics, type Reason, type ReasonCode } from "../types";

const fmt = (n: number, d = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: d });

function reason(code: ReasonCode, value: number | null, threshold: number | null, detail: string): Reason {
  return { code, label: REASON_LABELS[code], value, threshold, detail };
}

export interface StageAInput {
  migrationMcapUsd: number | null;
  mcapUsd: number | null;
  volume24hUsd: number | null;
}

export function judgeStageA(m: StageAInput, cfg: Config): Reason | null {
  const minMcap = m.migrationMcapUsd != null ? m.migrationMcapUsd * cfg.stage_a.min_mcap_vs_migration : null;
  if (m.mcapUsd == null) return reason("dead_after_bond", null, null, "plus aucune cotation sur DexScreener");
  if (minMcap != null && m.mcapUsd < minMcap)
    return reason("dead_after_bond", m.mcapUsd, minMcap, `mcap ${fmt(m.mcapUsd, 0)} $ < mcap de migration ${fmt(minMcap, 0)} $`);
  const vol = m.volume24hUsd ?? 0;
  if (vol < cfg.stage_a.min_volume_24h_usd)
    return reason("dead_after_bond", vol, cfg.stage_a.min_volume_24h_usd, `volume 24 h ${fmt(vol, 0)} $ < ${fmt(cfg.stage_a.min_volume_24h_usd, 0)} $`);
  return null;
}

export interface StageBExtra {
  bondingSeconds: number | null;
  prebondTxCount: number | null;
}

/** Ordre = du moins cher au plus cher à mesurer (même ordre que l'analyse). */
export const STAGE_B_ORDER: ReasonCode[] = [
  "min_holders",
  "wash_trading",
  "concentration",
  "fast_bond",
  "bundle",
  "snipers",
  "insiders",
  "dev_sell",
  "serial_dev",
];

/** Évalue un critère de l'étape B. `null` si non mesuré ou si le critère passe. */
export function judgeCriterion(code: ReasonCode, m: Metrics, x: StageBExtra, cfg: Config): Reason | null {
  const b = cfg.stage_b;
  switch (code) {
    case "min_holders":
      return m.holders != null && m.holders < b.min_holders
        ? reason(code, m.holders, b.min_holders, `${m.holders} holders < ${b.min_holders}`)
        : null;
    case "wash_trading": {
      if (m.wash_tx_per_wallet != null && m.wash_tx_per_wallet > b.wash_max_tx_per_wallet)
        return reason(code, m.wash_tx_per_wallet, b.wash_max_tx_per_wallet, `${fmt(m.wash_tx_per_wallet)} tx par wallet unique sur 24 h`);
      if (m.wash_roundtrip_share != null && m.wash_roundtrip_share > b.wash_max_roundtrip_share)
        return reason(code, m.wash_roundtrip_share, b.wash_max_roundtrip_share, `${fmt(m.wash_roundtrip_share * 100, 0)} % du volume récent fait par des wallets qui achètent et revendent en boucle`);
      return null;
    }
    case "concentration":
      return m.top10_pct != null && m.top10_pct > b.top10_max_pct
        ? reason(code, m.top10_pct, b.top10_max_pct, `top 10 holders (hors pool) : ${fmt(m.top10_pct)} % de la supply`)
        : null;
    case "fast_bond": {
      if (x.bondingSeconds == null || x.bondingSeconds >= b.fast_bond_minutes * 60) return null;
      const buyers = m.unique_buyers_prebond;
      if (buyers == null || buyers >= b.fast_bond_min_buyers) return null;
      return reason(code, buyers, b.fast_bond_min_buyers, `bondé en ${fmt(x.bondingSeconds / 60)} min avec ${buyers} acheteurs uniques`);
    }
    case "bundle":
      return m.bundle_pct != null && m.bundle_pct > b.bundle_max_pct
        ? reason(code, m.bundle_pct, b.bundle_max_pct, `${m.bundle_wallets ?? "?"} wallets ont pris ${fmt(m.bundle_pct)} % dans le bloc de création`)
        : null;
    case "snipers": {
      // On juge sur ce que les snipers détiennent encore ; à défaut de mesure (anciens journaux), sur ce qu'ils ont acheté.
      const held = m.snipers_held_pct ?? m.snipers_pct;
      if (held == null || held <= b.snipers_max_pct) return null;
      const detail =
        m.snipers_held_pct != null
          ? `les snipers des ${b.sniper_window_seconds} premières secondes détiennent encore ${fmt(m.snipers_held_pct)} % de la supply (achat : ${fmt(m.snipers_pct ?? 0)} %)`
          : `${fmt(held)} % de la supply achetée dans les ${b.sniper_window_seconds} premières secondes`;
      return reason(code, held, b.snipers_max_pct, detail);
    }
    case "insiders":
      return m.insiders_pct != null && m.insiders_pct > b.insiders_max_pct
        ? reason(code, m.insiders_pct, b.insiders_max_pct, `dev + ${m.insider_wallets ?? "?"} wallets liés : ${fmt(m.insiders_pct)} % de la supply`)
        : null;
    case "dev_sell": {
      if (m.dev_sold_pct == null || m.dev_sell_drop_pct == null) return null;
      if (m.dev_sold_pct < b.dev_sell_min_sold_pct || m.dev_sell_drop_pct < b.dev_sell_drop_pct) return null;
      if (isCto(m, cfg)) return null;
      return reason(code, m.dev_sell_drop_pct, b.dev_sell_drop_pct, `le dev et ses wallets ont vendu ${fmt(m.dev_sold_pct, 0)} % de leurs tokens, chute de ${fmt(m.dev_sell_drop_pct, 0)} %`);
    }
    case "serial_dev": {
      if (m.dev_launches_30d == null || m.dev_launches_30d <= b.serial_dev_max_launches_30d) return null;
      const dead = m.dev_dead_30d ?? 0;
      if (dead / m.dev_launches_30d <= b.serial_dev_dead_share) return null;
      return reason(code, m.dev_launches_30d, b.serial_dev_max_launches_30d, `${m.dev_launches_30d} tokens lancés en 30 jours, dont ${dead} morts`);
    }
    default:
      return null;
  }
}

/** Le coin a subi un dev sell mais la communauté l'a repris et il est reparti. */
export function isCto(m: Metrics, cfg: Config): boolean {
  const b = cfg.stage_b;
  const dumped = (m.dev_sold_pct ?? 0) >= b.dev_sell_min_sold_pct && (m.dev_sell_drop_pct ?? 0) >= b.dev_sell_drop_pct;
  if (!dumped) return false;
  if (b.cto_requires_dexscreener && !m.cto_official) return false;
  return (m.cto_recovery_multiple ?? 0) >= b.cto_min_recovery_multiple;
}

export function judgeStageB(m: Metrics, x: StageBExtra, cfg: Config): Reason[] {
  return STAGE_B_ORDER.map((c) => judgeCriterion(c, m, x, cfg)).filter((r): r is Reason => r !== null);
}
