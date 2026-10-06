import type { ParsedTx, Trade } from "../../lib/types";

let n = 0;
export function trade(p: Partial<Trade> & Pick<Trade, "wallet" | "slot" | "tokens">): Trade {
  n++;
  return {
    signature: `sig${n}`,
    blockTime: 1_790_000_000 + Math.floor((p.slot - 1000) * 0.4),
    txIndex: n,
    signer: p.wallet,
    side: "buy",
    quote: 0,
    ...p,
  };
}

/** Transaction minimale : soldes de tokens et de SOL avant/après. */
export function tx(opts: {
  keys: string[];
  sol?: [number, number][];
  tokens?: { idx: number; mint: string; owner: string; pre?: number; post?: number }[];
  logs?: string[];
  slot?: number;
  instructions?: ParsedTx["transaction"]["message"]["instructions"];
}): ParsedTx {
  const sol = opts.sol ?? opts.keys.map(() => [0, 0] as [number, number]);
  const bal = (amount: number) => ({ amount: String(Math.round(amount * 1e6)), decimals: 6, uiAmount: amount, uiAmountString: String(amount) });
  return {
    slot: opts.slot ?? 1000,
    blockTime: 1_790_000_000,
    transaction: {
      signatures: [`tx${++n}`],
      message: {
        accountKeys: opts.keys.map((pubkey, i) => ({ pubkey, signer: i === 0, writable: true })),
        instructions: opts.instructions ?? [],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: sol.map(([pre]) => pre * 1e9),
      postBalances: sol.map(([, post]) => post * 1e9),
      preTokenBalances: (opts.tokens ?? []).filter((t) => t.pre !== undefined).map((t) => ({ accountIndex: t.idx, mint: t.mint, owner: t.owner, uiTokenAmount: bal(t.pre!) })),
      postTokenBalances: (opts.tokens ?? []).filter((t) => t.post !== undefined).map((t) => ({ accountIndex: t.idx, mint: t.mint, owner: t.owner, uiTokenAmount: bal(t.post!) })),
      logMessages: opts.logs ?? [],
      innerInstructions: [],
    },
  };
}
