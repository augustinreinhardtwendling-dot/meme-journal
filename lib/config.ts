import { z } from "zod";

/**
 * Tous les seuils réglables. Les valeurs par défaut vivent ici ; la base (table settings)
 * ne stocke que ce que tu as modifié, fusionné par-dessus au chargement.
 */
export const configSchema = z.object({
  window: z.object({
    start_hours_ago: z.number().min(1).default(48),
    end_hours_ago: z.number().min(0).default(24),
    /** Heure UTC d'ancrage : la fenêtre se termine à cette heure le jour J-1. */
    anchor_utc_hour: z.number().int().min(0).max(23).default(4),
  }).prefault({}),
  collect: z.object({
    /** En dessous de cette liquidité versée dans la pool à la migration, le bonding est « fantôme ». */
    ghost_bond_max_liquidity_usd: z.number().min(0).default(1000),
    /** Pages max de signatures pour dater la création (1 000 tx par page, 1 crédit). */
    max_signature_pages: z.number().int().min(1).default(10),
  }).prefault({}),
  stage_a: z.object({
    min_mcap_vs_migration: z.number().min(0).default(1),
    min_volume_24h_usd: z.number().min(0).default(50_000),
  }).prefault({}),
  stage_b: z.object({
    min_holders: z.number().int().min(0).default(300),
    bundle_max_pct: z.number().default(10),
    insiders_max_pct: z.number().default(15),
    insider_funding_lookback_hours: z.number().default(72),
    /** Taille min d'un groupe de wallets financés par la même source (hors dev) pour être compté comme initié. */
    insider_min_cluster: z.number().int().min(2).default(3),
    /** Nombre de gros acheteurs du lancement dont on remonte le financement. */
    insider_candidates: z.number().int().min(1).default(30),
    /** Un financeur avec plus que ce solde est traité comme une plateforme (CEX…), pas une source commune. */
    hub_balance_sol: z.number().default(5000),
    /** Part de la supply que les snipers des premières secondes détiennent ENCORE. */
    snipers_max_pct: z.number().default(15),
    sniper_window_seconds: z.number().default(5),
    /** Nombre de premières transactions de la curve analysées (création + premiers trades). */
    early_tx_limit: z.number().int().min(20).max(1000).default(200),
    dev_sell_min_sold_pct: z.number().default(50),
    dev_sell_drop_pct: z.number().default(40),
    dev_sell_impact_minutes: z.number().default(60),
    /** CTO exigé « officiel » (validé sur DexScreener) pour sauver un coin après un dev sell. */
    cto_requires_dexscreener: z.boolean().default(true),
    /** Reprise minimale depuis le plus bas d'après dump pour parler de CTO. */
    cto_min_recovery_multiple: z.number().default(2),
    top10_max_pct: z.number().default(30),
    fast_bond_minutes: z.number().default(10),
    fast_bond_min_buyers: z.number().int().default(150),
    // 15 (et non 8) : les fermes à faux volume sont toutes au-dessus de 20 ; un vrai coin actif peut atteindre 8.
    wash_max_tx_per_wallet: z.number().default(15),
    wash_max_roundtrip_share: z.number().default(0.5),
    serial_dev_max_launches_30d: z.number().int().default(5),
    serial_dev_dead_share: z.number().default(0.5),
    /** Arrêter l'analyse d'un coin dès la première exclusion (économise des crédits). */
    short_circuit: z.boolean().default(true),
  }).prefault({}),
  score: z.object({
    runner_ath_multiple: z.number().default(5),
  }).prefault({}),
  fiches: z.object({
    max_per_day: z.number().int().min(0).default(10),
    model: z.string().default("sonnet"),
    max_searches_per_fiche: z.number().int().default(4),
  }).prefault({}),
  budget: z.object({
    helius_daily_credit_cap: z.number().int().default(28_000),
    /** Crédits max dépensés sur un seul coin à l'étape B. */
    helius_per_coin_cap: z.number().int().default(600),
  }).prefault({}),
  metas: z.object({
    /** Une meta est « saturée » si au moins ce nombre de coins ont bondé sur 7 jours… */
    saturation_min_bonded_7d: z.number().int().default(25),
    /** …et que moins de cette part est encore vivante 24 h après. */
    saturation_max_alive_rate: z.number().default(0.02),
  }).prefault({}),
  telegram: z.object({
    /** Découvert automatiquement au premier message envoyé au bot (pas un secret). */
    chat_id: z.string().nullable().default(null),
  }).prefault({}),
});

export type Config = z.infer<typeof configSchema>;

export const defaultConfig: Config = configSchema.parse({});

/** Fusionne la config stockée (partielle, éventuellement ancienne) avec les valeurs par défaut. */
export function parseConfig(stored: unknown): Config {
  const parsed = configSchema.safeParse(stored ?? {});
  if (parsed.success) return parsed.data;
  // Une valeur invalide en base ne doit pas bloquer le pipeline : on garde les défauts pour ce bloc.
  const out: Record<string, unknown> = {};
  const src = (stored ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(configSchema.shape)) {
    const block = configSchema.shape[key as keyof typeof configSchema.shape].safeParse(src[key] ?? {});
    out[key] = block.success ? block.data : configSchema.shape[key as keyof typeof configSchema.shape].parse({});
  }
  return out as Config;
}
