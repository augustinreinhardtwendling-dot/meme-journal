// Bundle et snipers : qui a acheté au tout début, et combien.
import type { Trade } from "../types";

export interface LaunchContext {
  createSlot: number;
  createTime: number;
  /** Dev + wallets assimilés (signataire de la création, wallet « creator » de la curve). */
  devWallets: Set<string>;
  supply: number;
}

export interface BuyerShare {
  wallet: string;
  tokens: number;
  pct: number;
}

function sumByWallet(trades: Trade[], supply: number): BuyerShare[] {
  const m = new Map<string, number>();
  for (const t of trades) m.set(t.wallet, (m.get(t.wallet) ?? 0) + t.tokens);
  return [...m]
    .map(([wallet, tokens]) => ({ wallet, tokens, pct: (tokens / supply) * 100 }))
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * Bundle : achats (hors dev) exécutés dans le même bloc que la création du coin.
 * Seul un bundle (Jito) ou un bot collé à la création peut atterrir dans ce bloc.
 */
export function detectBundle(trades: Trade[], ctx: LaunchContext) {
  const buys = trades.filter((t) => t.side === "buy" && t.slot === ctx.createSlot && !ctx.devWallets.has(t.wallet));
  const buyers = sumByWallet(buys, ctx.supply);
  return {
    pct: buyers.reduce((s, b) => s + b.pct, 0),
    wallets: buyers,
    slot: ctx.createSlot,
  };
}

/** Snipers : achats (hors dev) dans les `windowSeconds` qui suivent la création (bloc de création inclus). */
export function detectSnipers(trades: Trade[], ctx: LaunchContext, windowSeconds: number) {
  // Un slot Solana dure ~400 ms ; blockTime n'a qu'une précision d'une seconde, on s'appuie sur les slots.
  const maxSlot = ctx.createSlot + Math.floor(windowSeconds / 0.4);
  const buys = trades.filter((t) => t.side === "buy" && t.slot <= maxSlot && !ctx.devWallets.has(t.wallet));
  const buyers = sumByWallet(buys, ctx.supply);
  return {
    pct: buyers.reduce((s, b) => s + b.pct, 0),
    wallets: buyers,
    untilSlot: maxSlot,
  };
}

/** Les plus gros acheteurs nets de la période observée (candidats à l'analyse des liens). */
export function topBuyers(trades: Trade[], supply: number, limit: number): BuyerShare[] {
  return sumByWallet(
    trades.filter((t) => t.side === "buy"),
    supply,
  ).slice(0, limit);
}
