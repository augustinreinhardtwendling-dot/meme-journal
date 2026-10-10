// Libellés français des réglages affichés dans la page Réglages.
export const SETTINGS_FIELDS: { section: string; title: string; fields: { key: string; label: string; unit?: string; step?: number }[] }[] = [
  {
    section: "window",
    title: "Fenêtre d'évaluation",
    fields: [
      { key: "start_hours_ago", label: "Début (heures avant l'ancrage)", unit: "h" },
      { key: "end_hours_ago", label: "Fin (heures avant l'ancrage)", unit: "h" },
      { key: "anchor_utc_hour", label: "Heure d'ancrage (UTC)", unit: "h" },
    ],
  },
  {
    section: "stage_a",
    title: "Tri A — tient-il après le bonding ?",
    fields: [
      { key: "min_mcap_vs_migration", label: "Mcap minimale (× mcap de migration)", step: 0.1 },
      { key: "min_volume_24h_usd", label: "Volume 24 h minimal", unit: "$" },
    ],
  },
  {
    section: "stage_b",
    title: "Tri B — distribution et manipulations",
    fields: [
      { key: "min_holders", label: "Holders minimum" },
      { key: "bundle_max_pct", label: "Bundle max", unit: "%", step: 0.5 },
      { key: "insiders_max_pct", label: "Insiders max", unit: "%", step: 0.5 },
      { key: "insider_funding_lookback_hours", label: "Recherche des financements", unit: "h" },
      { key: "insider_min_cluster", label: "Taille min. d'un groupe coordonné", unit: "wallets" },
      { key: "snipers_max_pct", label: "Snipers max (part encore détenue)", unit: "%", step: 0.5 },
      { key: "sniper_window_seconds", label: "Fenêtre des snipers", unit: "s" },
      { key: "dev_sell_min_sold_pct", label: "Dev sell : part vendue minimale", unit: "%" },
      { key: "dev_sell_drop_pct", label: "Dev sell : chute minimale", unit: "%" },
      { key: "dev_sell_impact_minutes", label: "Dev sell : fenêtre d'impact", unit: "min" },
      { key: "cto_min_recovery_multiple", label: "CTO : reprise minimale depuis le plus bas", unit: "×", step: 0.1 },
      { key: "top10_max_pct", label: "Top 10 max (hors pool)", unit: "%", step: 0.5 },
      { key: "fast_bond_minutes", label: "Bonding rapide : durée", unit: "min" },
      { key: "fast_bond_min_buyers", label: "Bonding rapide : acheteurs minimum" },
      { key: "wash_max_tx_per_wallet", label: "Wash : tx par wallet max", step: 0.5 },
      { key: "wash_max_roundtrip_share", label: "Wash : part du volume en boucle max", step: 0.05 },
      { key: "serial_dev_max_launches_30d", label: "Dev récidiviste : lancements max sur 30 j" },
      { key: "serial_dev_dead_share", label: "Dev récidiviste : part de morts", step: 0.05 },
    ],
  },
  {
    section: "score",
    title: "Score",
    fields: [{ key: "runner_ath_multiple", label: "Runner : ATH ≥ × mcap de migration", step: 0.5 }],
  },
  {
    section: "fiches",
    title: "Fiches Claude Code",
    fields: [
      { key: "max_per_day", label: "Fiches maximum par jour" },
      { key: "max_searches_per_fiche", label: "Recherches web max par fiche" },
    ],
  },
  {
    section: "budget",
    title: "Budget Helius",
    fields: [
      { key: "helius_daily_credit_cap", label: "Crédits max par jour" },
      { key: "helius_per_coin_cap", label: "Crédits max par coin" },
    ],
  },
];
