// Client RPC Helius : limite de débit (offre gratuite = 10 req/s), relances, et compteur de crédits.
import type { ParsedTx, SignatureInfo } from "../../lib/types";

export class BudgetExceeded extends Error {
  constructor(scope: string) {
    super(`budget Helius atteint (${scope})`);
  }
}

/** Compteur de crédits pour un périmètre (la journée, un coin…). */
export class CreditMeter {
  used = 0;
  constructor(readonly cap: number, readonly scope: string, readonly parent?: CreditMeter) {}
  reserve(cost: number) {
    if (this.used + cost > this.cap) throw new BudgetExceeded(this.scope);
    this.parent?.reserve(cost);
    this.used += cost;
  }
  refund(credits: number) {
    this.used -= credits;
    this.parent?.refund(credits);
  }
  child(cap: number, scope: string) {
    return new CreditMeter(cap, scope, this);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GtfaOptions {
  transactionDetails?: "signatures" | "full";
  sortOrder?: "asc" | "desc";
  limit?: number;
  paginationToken?: string;
  filters?: {
    blockTime?: { gte?: number; lte?: number; gt?: number; lt?: number };
    slot?: { gte?: number; lte?: number; gt?: number; lt?: number };
    status?: "succeeded" | "failed" | "any";
    tokenAccounts?: "none" | "balanceChanged" | "all";
    tokenTransfer?: { mint?: string; direction?: "in" | "out" | "any"; with?: string };
  };
}

export class Helius {
  private recent: number[] = [];
  calls = 0;

  constructor(
    private readonly apiKey: string,
    readonly meter: CreditMeter,
    private readonly maxPerSecond = 8,
  ) {}

  private async throttle() {
    for (;;) {
      const now = Date.now();
      this.recent = this.recent.filter((t) => now - t < 1000);
      if (this.recent.length < this.maxPerSecond) {
        this.recent.push(now);
        return;
      }
      await sleep(1000 - (now - this.recent[0]) + 5);
    }
  }

  async rpc<T>(method: string, params: unknown[], cost = 1, meter: CreditMeter = this.meter): Promise<T> {
    meter.reserve(cost);
    let lastError = "";
    for (let attempt = 0; attempt < 7; attempt++) {
      await this.throttle();
      this.calls++;
      let res: Response;
      try {
        res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        lastError = (e as Error).message;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        await sleep(Math.min(30_000, 1000 * 2 ** attempt));
        continue;
      }
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      if (body.error) {
        // -32005 (nœud en retard) / -32014 (statut de bloc indisponible) : erreurs transitoires
        if ([-32005, -32014].includes(body.error.code)) {
          lastError = body.error.message;
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new Error(`${method}: ${body.error.message}`);
      }
      return body.result as T;
    }
    throw new Error(`${method}: échec après relances (${lastError})`);
  }

  getSignaturesForAddress(address: string, opts: { before?: string; until?: string; limit?: number } = {}, meter?: CreditMeter) {
    return this.rpc<SignatureInfo[]>("getSignaturesForAddress", [address, { limit: 1000, ...opts }], 1, meter);
  }

  getTransaction(signature: string, meter?: CreditMeter) {
    return this.rpc<ParsedTx | null>(
      "getTransaction",
      [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "finalized" }],
      1,
      meter,
    );
  }

  /** Coût : 10 crédits (signatures) ; 10 crédits par tranche de 100 tx renvoyées (full). */
  async getTransactionsForAddress(address: string, opts: GtfaOptions, meter: CreditMeter = this.meter) {
    const full = opts.transactionDetails === "full";
    const limit = opts.limit ?? 100;
    const reserved = full ? Math.max(10, Math.ceil(limit / 100) * 10) : 10;
    const params = {
      ...opts,
      limit,
      ...(full ? { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 } : {}),
    };
    const res = await this.rpc<{ data: (ParsedTx & SignatureInfo)[]; paginationToken: string | null }>(
      "getTransactionsForAddress",
      [address, params],
      reserved,
      meter,
    );
    if (full) {
      const actual = Math.max(10, Math.ceil(res.data.length / 100) * 10);
      if (actual < reserved) meter.refund(reserved - actual);
    }
    return res;
  }

  async getMultipleAccounts<T = unknown>(addresses: string[], encoding: "jsonParsed" | "base64" = "jsonParsed", meter?: CreditMeter) {
    const out: (T | null)[] = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const res = await this.rpc<{ value: (T | null)[] }>(
        "getMultipleAccounts",
        [addresses.slice(i, i + 100), { encoding }],
        1,
        meter,
      );
      out.push(...res.value);
    }
    return out;
  }

  getTokenLargestAccounts(mint: string, meter?: CreditMeter) {
    return this.rpc<{ value: { address: string; amount: string; uiAmount: number | null; decimals: number }[] }>(
      "getTokenLargestAccounts",
      [mint],
      1,
      meter,
    );
  }

  getTokenSupply(mint: string, meter?: CreditMeter) {
    return this.rpc<{ value: { amount: string; decimals: number; uiAmount: number | null } }>("getTokenSupply", [mint], 1, meter);
  }

  getBalance(address: string, meter?: CreditMeter) {
    return this.rpc<{ value: number }>("getBalance", [address], 1, meter);
  }
}
