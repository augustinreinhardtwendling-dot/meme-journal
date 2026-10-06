// Types partagés entre le pipeline, la détection et l'interface.

// ---- Format brut renvoyé par le RPC Solana (jsonParsed) ----

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  transactionIndex?: number;
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null; uiAmountString: string };
}

export interface ParsedInstruction {
  programId: string;
  program?: string;
  accounts?: string[];
  data?: string;
  parsed?: { type: string; info: Record<string, unknown> } | string;
}

export interface ParsedTx {
  slot: number;
  blockTime: number | null;
  transactionIndex?: number;
  version?: number | "legacy";
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions: ParsedInstruction[];
    };
  };
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    logMessages?: string[] | null;
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[] | null;
  } | null;
}

// ---- Domaine ----

/** Achat ou vente normalisé, déduit des variations de soldes (robuste aux bundles et agrégateurs). */
export interface Trade {
  signature: string;
  slot: number;
  blockTime: number;
  /** Position dans le bloc (ordre d'exécution). */
  txIndex: number;
  /** Propriétaire du compte de token dont le solde change (le vrai détenteur). */
  wallet: string;
  /** Payeur de la transaction. */
  signer: string;
  side: "buy" | "sell";
  /** Quantité de tokens (unités entières, pas en base units). */
  tokens: number;
  /** Montant de quote (SOL en général) entré/sorti de la curve pour cette tx, réparti au prorata. */
  quote: number;
}

/** Lien de financement : `funder` a envoyé du SOL à `wallet` peu avant son premier achat. */
export interface FundingEdge {
  wallet: string;
  funder: string | null;
  fundedAt: number | null;
  amountSol: number | null;
}

export type ReasonCode =
  | "dead_after_bond"
  | "ghost_bond"
  | "min_holders"
  | "bundle"
  | "insiders"
  | "snipers"
  | "dev_sell"
  | "concentration"
  | "fast_bond"
  | "wash_trading"
  | "serial_dev"
  | "not_analyzed";

export interface Reason {
  code: ReasonCode;
  label: string;
  value?: number | null;
  threshold?: number | null;
  detail?: string;
}

export const REASON_LABELS: Record<ReasonCode, string> = {
  dead_after_bond: "Mort après bonding",
  ghost_bond: "Migration fantôme",
  min_holders: "Pas assez de holders",
  bundle: "Bundle",
  insiders: "Insiders",
  snipers: "Snipers",
  dev_sell: "Dev sell",
  concentration: "Concentration",
  fast_bond: "Bonding artificiel",
  wash_trading: "Wash trading",
  serial_dev: "Dev récidiviste",
  not_analyzed: "Non analysé",
};

export type EvaluationStatus = "retained" | "dead" | "excluded" | "not_analyzed";

/** Métriques mesurées pour un coin. `null` = pas mesuré. */
export interface Metrics {
  // Étape A
  mcap_usd: number | null;
  price_usd: number | null;
  volume_24h_usd: number | null;
  liquidity_usd: number | null;
  ath_mcap_usd: number | null;
  ath_at: string | null;
  txns_24h: number | null;
  buyers_24h: number | null;
  sellers_24h: number | null;
  // Étape B
  holders: number | null;
  top10_pct: number | null;
  bundle_pct: number | null;
  bundle_wallets: number | null;
  insiders_pct: number | null;
  insider_wallets: number | null;
  snipers_pct: number | null;
  dev_sold_pct: number | null;
  dev_sell_drop_pct: number | null;
  unique_buyers_prebond: number | null;
  wash_tx_per_wallet: number | null;
  wash_roundtrip_share: number | null;
  dev_launches_30d: number | null;
  dev_dead_30d: number | null;
  /** CTO validé sur DexScreener. */
  cto_official: boolean | null;
  /** Multiple de reprise depuis le plus bas après le dump du dev. */
  cto_recovery_multiple: number | null;
}

export function emptyMetrics(): Metrics {
  return {
    mcap_usd: null, price_usd: null, volume_24h_usd: null, liquidity_usd: null, ath_mcap_usd: null, ath_at: null,
    txns_24h: null, buyers_24h: null, sellers_24h: null, holders: null, top10_pct: null, bundle_pct: null,
    bundle_wallets: null, insiders_pct: null, insider_wallets: null, snipers_pct: null, dev_sold_pct: null,
    dev_sell_drop_pct: null, unique_buyers_prebond: null, wash_tx_per_wallet: null, wash_roundtrip_share: null,
    dev_launches_30d: null, dev_dead_30d: null, cto_official: null, cto_recovery_multiple: null,
  };
}
