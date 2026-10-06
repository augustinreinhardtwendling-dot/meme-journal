// Lecture des transactions Solana à partir des variations de soldes.
// On ne dépend pas de l'ordre des comptes des instructions (qui change à chaque version de pump.fun) :
// on regarde qui a gagné ou perdu quels tokens et combien de SOL.
import { PUMP_MIGRATION_AUTHORITY, PUMP_PROGRAM, WSOL_MINT } from "../solana";
import type { ParsedInstruction, ParsedTx, TokenBalance, Trade } from "../types";

const ui = (b: TokenBalance) => Number(b.uiTokenAmount.uiAmountString ?? b.uiTokenAmount.uiAmount ?? 0);

export function accountKeys(tx: ParsedTx): string[] {
  return tx.transaction.message.accountKeys.map((k) => k.pubkey);
}

export function feePayer(tx: ParsedTx): string {
  return tx.transaction.message.accountKeys[0].pubkey;
}

export function signers(tx: ParsedTx): string[] {
  return tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey);
}

/** Variation de tokens d'un mint, par propriétaire (en unités). */
export function tokenDeltasByOwner(tx: ParsedTx, mint: string): Map<string, number> {
  const out = new Map<string, number>();
  const keys = accountKeys(tx);
  const add = (owner: string | undefined, v: number) => {
    if (!owner) return;
    out.set(owner, (out.get(owner) ?? 0) + v);
  };
  // On indexe par compte de token pour gérer les comptes créés ou fermés dans la tx.
  const pre = new Map<number, TokenBalance>();
  for (const b of tx.meta?.preTokenBalances ?? []) if (b.mint === mint) pre.set(b.accountIndex, b);
  const post = new Map<number, TokenBalance>();
  for (const b of tx.meta?.postTokenBalances ?? []) if (b.mint === mint) post.set(b.accountIndex, b);
  for (const idx of new Set([...pre.keys(), ...post.keys()])) {
    const a = pre.get(idx);
    const b = post.get(idx);
    const owner = b?.owner ?? a?.owner ?? keys[idx];
    add(owner, (b ? ui(b) : 0) - (a ? ui(a) : 0));
  }
  for (const [k, v] of out) if (Math.abs(v) < 1e-9) out.delete(k);
  return out;
}

export function tokenBalanceOfOwner(tx: ParsedTx, owner: string, mint: string, when: "pre" | "post"): number {
  const list = when === "pre" ? tx.meta?.preTokenBalances : tx.meta?.postTokenBalances;
  return (list ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((s, b) => s + ui(b), 0);
}

/** Variation de SOL natif d'un compte (en SOL). */
export function lamportDelta(tx: ParsedTx, address: string): number {
  const i = accountKeys(tx).indexOf(address);
  if (i < 0 || !tx.meta) return 0;
  return (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9;
}

/** Variation de la « quote » détenue par un propriétaire : SOL natif + WSOL, ou le token de quote. */
export function quoteDelta(tx: ParsedTx, owner: string, quoteMint: string): number {
  if (quoteMint === WSOL_MINT) {
    return lamportDelta(tx, owner) + (tokenDeltasByOwner(tx, WSOL_MINT).get(owner) ?? 0);
  }
  return tokenDeltasByOwner(tx, quoteMint).get(owner) ?? 0;
}

export function logs(tx: ParsedTx): string[] {
  return tx.meta?.logMessages ?? [];
}

/** Noms des instructions pump.fun appelées (Create, CreateV2, Buy, Sell, MigrateV2…). */
export function pumpInstructionNames(tx: ParsedTx): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  for (const line of logs(tx)) {
    const invoke = line.match(/^Program (\w+) invoke \[\d+\]/);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program (\w+) (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    const ins = line.match(/^Program log: Instruction: (\w+)/);
    if (ins && stack.at(-1) === PUMP_PROGRAM) out.push(ins[1]);
  }
  return out;
}

export function isCreateTx(tx: ParsedTx): boolean {
  return pumpInstructionNames(tx).some((n) => n === "Create" || n === "CreateV2");
}

function allInstructions(tx: ParsedTx): ParsedInstruction[] {
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions);
  return [...tx.transaction.message.instructions, ...inner];
}

export interface Migration {
  signature: string;
  slot: number;
  blockTime: number;
  mint: string;
  quoteMint: string;
  bondingCurve: string;
  pool: string;
  /** Tokens et quote versés dans la pool à sa création. */
  poolBase: number;
  poolQuote: number;
  instruction: string;
}

/**
 * Reconnaît une vraie migration pump.fun → PumpSwap. Renvoie null pour les appels « à vide »
 * (curve déjà migrée), fréquents : des bots rappellent migrate après coup et la tx réussit sans rien faire.
 */
export function parseMigration(tx: ParsedTx): Migration | null {
  if (!tx.meta || tx.meta.err) return null;
  const names = pumpInstructionNames(tx);
  const instruction = names.find((n) => n.startsWith("Migrate"));
  if (!instruction) return null;
  if (logs(tx).some((l) => /already migrated/i.test(l))) return null;

  const ix = allInstructions(tx).find(
    (i) => i.programId === PUMP_PROGRAM && i.accounts?.[1] === PUMP_MIGRATION_AUTHORITY,
  );
  const mint = ix?.accounts?.[2];
  if (!mint) return null;

  const deltas = tokenDeltasByOwner(tx, mint);
  // La curve : celui qui détenait les tokens avant et plus rien après.
  let bondingCurve: string | undefined;
  let pool: string | undefined;
  let poolBase = 0;
  for (const [owner, d] of deltas) {
    if (d < 0 && tokenBalanceOfOwner(tx, owner, mint, "post") === 0) bondingCurve = owner;
    if (d > poolBase) {
      poolBase = d;
      pool = owner;
    }
  }
  if (!bondingCurve || !pool) return null;

  // La quote : l'autre token détenu par la pool après la tx.
  const poolHoldings = (tx.meta.postTokenBalances ?? []).filter((b) => b.owner === pool && b.mint !== mint);
  const quote = poolHoldings.sort((a, b) => ui(b) - ui(a))[0];
  const quoteMint = quote?.mint ?? WSOL_MINT;
  const poolQuote = quote ? ui(quote) : 0;

  return {
    signature: tx.transaction.signatures[0],
    slot: tx.slot,
    blockTime: tx.blockTime ?? 0,
    mint,
    quoteMint,
    bondingCurve,
    pool,
    poolBase,
    poolQuote,
    instruction,
  };
}

/**
 * Trades d'une transaction sur la bonding curve : chaque propriétaire (hors curve) dont le solde du
 * mint varie est un acheteur (+) ou un vendeur (−). La quote échangée est répartie au prorata.
 */
export function extractCurveTrades(
  tx: ParsedTx,
  ctx: { mint: string; bondingCurve: string; quoteMint: string },
): Trade[] {
  if (!tx.meta || tx.meta.err) return [];
  const deltas = tokenDeltasByOwner(tx, ctx.mint);
  const curveTokens = deltas.get(ctx.bondingCurve) ?? 0;
  if (curveTokens === 0) return [];
  const curveQuote = Math.abs(quoteDelta(tx, ctx.bondingCurve, ctx.quoteMint));
  const signature = tx.transaction.signatures[0];
  const signer = feePayer(tx);
  const parts = [...deltas].filter(([owner, d]) => owner !== ctx.bondingCurve && d !== 0);
  const totalAbs = parts.reduce((s, [, d]) => s + Math.abs(d), 0) || 1;
  return parts.map(([wallet, d]) => ({
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? 0,
    txIndex: tx.transactionIndex ?? 0,
    wallet,
    signer,
    side: d > 0 ? "buy" : "sell",
    tokens: Math.abs(d),
    quote: (curveQuote * Math.abs(d)) / totalAbs,
  }));
}

/** Prix (en quote par token) implicite d'une tx sur la curve, ou null. */
export function curvePrice(tx: ParsedTx, ctx: { mint: string; bondingCurve: string; quoteMint: string }): number | null {
  const tokens = Math.abs(tokenDeltasByOwner(tx, ctx.mint).get(ctx.bondingCurve) ?? 0);
  const quote = Math.abs(quoteDelta(tx, ctx.bondingCurve, ctx.quoteMint));
  if (tokens < 1 || quote === 0) return null;
  return quote / tokens;
}

/** Plus grosse entrée de SOL reçue par `wallet` depuis un autre wallet dans la tx (financement). */
export function incomingSolTransfers(tx: ParsedTx, wallet: string): { from: string; sol: number }[] {
  const out: { from: string; sol: number }[] = [];
  for (const ix of allInstructions(tx)) {
    if (typeof ix.parsed !== "object" || !ix.parsed) continue;
    if (ix.program !== "system") continue;
    const { type, info } = ix.parsed;
    if ((type === "transfer" || type === "transferWithSeed") && info.destination === wallet && typeof info.lamports === "number") {
      out.push({ from: String(info.source), sol: info.lamports / 1e9 });
    }
  }
  return out;
}
