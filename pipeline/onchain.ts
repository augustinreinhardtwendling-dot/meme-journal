// Récupération des données on-chain de l'étape B (Helius). Les calculs eux-mêmes sont dans lib/detection.
import type { Sql } from "postgres";
import type { DevLaunch, HolderAccount } from "../lib/detection/distribution";
import type { WalletFlow } from "../lib/detection/devsell";
import {
  curvePrice,
  extractCurveTrades,
  feePayer,
  incomingSolTransfers,
  isCreateTx,
  quoteDelta,
  tokenDeltasByOwner,
} from "../lib/onchain/parse";
import { WSOL_MINT } from "../lib/solana";
import type { FundingEdge, ParsedTx, Trade } from "../lib/types";
import type { CreditMeter, Helius } from "./sources/helius";

export interface CurveCtx {
  mint: string;
  bondingCurve: string;
  quoteMint: string;
  migrationSignature: string;
}

export interface LaunchData {
  createSignature: string;
  createSlot: number;
  createTime: number;
  /** Signataire (payeur) de la tx de création. */
  devSigner: string;
  trades: Trade[];
  /** Toutes les tx avant migration ont été lues. */
  complete: boolean;
  txRead: number;
}

/** Création + premiers trades de la curve, du plus ancien au plus récent. */
export async function fetchLaunch(helius: Helius, c: CurveCtx, limit: number, meter: CreditMeter): Promise<LaunchData | null> {
  const page = await helius.getTransactionsForAddress(
    c.bondingCurve,
    { transactionDetails: "full", sortOrder: "asc", limit, filters: { status: "succeeded" } },
    meter,
  );
  const txs = page.data as ParsedTx[];
  const createIdx = txs.findIndex(isCreateTx);
  if (createIdx < 0) return null;
  const create = txs[createIdx];
  const trades: Trade[] = [];
  let complete = page.paginationToken == null;
  for (const tx of txs.slice(createIdx)) {
    if (tx.transaction.signatures[0] === c.migrationSignature) {
      complete = true;
      break;
    }
    trades.push(...extractCurveTrades(tx, c));
  }
  return {
    createSignature: create.transaction.signatures[0],
    createSlot: create.slot,
    createTime: create.blockTime ?? 0,
    devSigner: feePayer(create),
    trades,
    complete,
    txRead: txs.length,
  };
}

/** Lit la suite des trades avant migration (pour compter les acheteurs uniques d'un bonding rapide). */
export async function fetchMoreTrades(helius: Helius, c: CurveCtx, afterSlot: number, limit: number, meter: CreditMeter) {
  const page = await helius.getTransactionsForAddress(
    c.bondingCurve,
    { transactionDetails: "full", sortOrder: "asc", limit, filters: { status: "succeeded", slot: { gt: afterSlot } } },
    meter,
  );
  const trades: Trade[] = [];
  let reachedMigration = page.paginationToken == null;
  for (const tx of page.data as ParsedTx[]) {
    if (tx.transaction.signatures[0] === c.migrationSignature) {
      reachedMigration = true;
      break;
    }
    trades.push(...extractCurveTrades(tx, c));
  }
  return { trades, reachedMigration };
}

/** Prix de la curve (en quote par token) entre deux instants. */
export async function curvePrices(helius: Helius, c: CurveCtx, from: number, to: number, meter: CreditMeter) {
  const page = await helius.getTransactionsForAddress(
    c.bondingCurve,
    {
      transactionDetails: "full",
      sortOrder: "asc",
      limit: 100,
      filters: { status: "succeeded", blockTime: { gte: Math.floor(from), lte: Math.ceil(to) } },
    },
    meter,
  );
  return (page.data as ParsedTx[])
    .map((tx) => ({ time: tx.blockTime ?? 0, price: curvePrice(tx, c) }))
    .filter((p): p is { time: number; price: number } => p.price != null);
}

// ---------------------------------------------------------------------------
// Holders
// ---------------------------------------------------------------------------

export async function largestHolders(helius: Helius, mint: string, meter: CreditMeter) {
  const [largest, supply] = await Promise.all([
    helius.getTokenLargestAccounts(mint, meter),
    helius.getTokenSupply(mint, meter),
  ]);
  const accounts = await helius.getMultipleAccounts<{ data: { parsed?: { info?: { owner?: string } } } }>(
    largest.value.map((a) => a.address),
    "jsonParsed",
    meter,
  );
  const holders: HolderAccount[] = largest.value.map((a, i) => ({
    owner: accounts[i]?.data?.parsed?.info?.owner ?? a.address,
    amount: Number(a.uiAmount ?? 0),
  }));
  return { holders, supply: Number(supply.value.uiAmount ?? 0) };
}

// ---------------------------------------------------------------------------
// Financement des wallets (avec cache en base)
// ---------------------------------------------------------------------------

export interface FundingCandidate {
  wallet: string;
  /** 1re tx du wallet sur ce coin : on cherche le financement juste avant. */
  firstSignature: string;
  firstTime: number;
}

/** Plus récent apport de SOL (≥ 0,05 SOL) reçu d'un autre wallet avant `firstSignature`, dans la limite de `lookbackHours`. */
async function findFunder(helius: Helius, cand: FundingCandidate, lookbackHours: number, meter: CreditMeter): Promise<FundingEdge> {
  const sigs = await helius.getSignaturesForAddress(cand.wallet, { before: cand.firstSignature, limit: 15 }, meter);
  let inspected = 0;
  for (const s of sigs) {
    if (s.err) continue;
    if (s.blockTime && cand.firstTime - s.blockTime > lookbackHours * 3600) break;
    if (inspected++ >= 4) break;
    const tx = await helius.getTransaction(s.signature, meter);
    if (!tx) continue;
    const incoming = incomingSolTransfers(tx, cand.wallet)
      .filter((t) => t.from !== cand.wallet && t.sol >= 0.05)
      .sort((a, b) => b.sol - a.sol)[0];
    if (incoming) return { wallet: cand.wallet, funder: incoming.from, fundedAt: tx.blockTime ?? null, amountSol: incoming.sol };
  }
  return { wallet: cand.wallet, funder: null, fundedAt: null, amountSol: null };
}

export async function fundingEdges(
  helius: Helius,
  sql: Sql,
  candidates: FundingCandidate[],
  lookbackHours: number,
  meter: CreditMeter,
): Promise<FundingEdge[]> {
  if (!candidates.length) return [];
  const cached = await sql<{ wallet: string; funder: string | null; funded_at: Date | null; amount_sol: number | null; checked_at: Date }[]>`
    select wallet, funder, funded_at, amount_sol, checked_at from wallet_funding
    where wallet in ${sql(candidates.map((c) => c.wallet))}`;
  const byWallet = new Map(cached.map((r) => [r.wallet, r]));
  const out: FundingEdge[] = [];
  for (const cand of candidates) {
    const hit = byWallet.get(cand.wallet);
    // Le cache vaut si le financement trouvé précède ce lancement et reste dans la fenêtre de recherche,
    // ou si l'absence de financement a été vérifiée après ce lancement.
    if (hit) {
      const fundedAt = hit.funded_at ? hit.funded_at.getTime() / 1000 : null;
      if (fundedAt != null && fundedAt <= cand.firstTime && cand.firstTime - fundedAt <= lookbackHours * 3600) {
        out.push({ wallet: cand.wallet, funder: hit.funder, fundedAt, amountSol: hit.amount_sol });
        continue;
      }
    }
    const edge = await findFunder(helius, cand, lookbackHours, meter);
    out.push(edge);
    await sql`
      insert into wallet_funding (wallet, funder, funded_at, amount_sol, checked_at)
      values (${edge.wallet}, ${edge.funder}, ${edge.fundedAt ? new Date(edge.fundedAt * 1000) : null}, ${edge.amountSol}, now())
      on conflict (wallet) do update set funder = excluded.funder, funded_at = excluded.funded_at,
        amount_sol = excluded.amount_sol, checked_at = now()`;
  }
  return out;
}

/** Financeurs à traiter comme des plateformes : déjà connus, ou solde énorme (vérifié et mémorisé). */
export async function resolveHubs(helius: Helius, sql: Sql, funders: string[], hubBalanceSol: number, meter: CreditMeter) {
  const hubs = new Set<string>();
  if (!funders.length) return hubs;
  const known = await sql<{ address: string; kind: string }[]>`select address, kind from known_wallets where address in ${sql(funders)}`;
  const knownSet = new Set(known.map((k) => k.address));
  for (const k of known) if (["cex", "bridge", "hub", "program", "fee"].includes(k.kind)) hubs.add(k.address);
  for (const f of funders) {
    if (knownSet.has(f)) continue;
    const bal = (await helius.getBalance(f, meter)).value / 1e9;
    if (bal >= hubBalanceSol) {
      hubs.add(f);
      await sql`insert into known_wallets (address, label, kind) values (${f}, ${`hub (solde ${Math.round(bal)} SOL)`}, 'hub')
        on conflict (address) do nothing`;
    }
  }
  return hubs;
}

// ---------------------------------------------------------------------------
// Flux de tokens d'un wallet (achats, ventes, transferts)
// ---------------------------------------------------------------------------

export async function walletFlow(helius: Helius, wallet: string, mint: string, quoteMint: string, meter: CreditMeter): Promise<WalletFlow & { transfersOut: number }> {
  const page = await helius.getTransactionsForAddress(
    wallet,
    {
      transactionDetails: "full",
      sortOrder: "asc",
      limit: 100,
      filters: { status: "succeeded", tokenAccounts: "balanceChanged", tokenTransfer: { mint, direction: "any" } },
    },
    meter,
  );
  let acquired = 0;
  let transfersOut = 0;
  const sells: { time: number; tokens: number }[] = [];
  for (const tx of page.data as ParsedTx[]) {
    const d = tokenDeltasByOwner(tx, mint).get(wallet) ?? 0;
    if (d > 0) acquired += d;
    else if (d < 0) {
      // Vente = les tokens partent et la quote (ou du SOL, via un agrégateur) arrive.
      const q = quoteDelta(tx, wallet, quoteMint) + (quoteMint === WSOL_MINT ? 0 : quoteDelta(tx, wallet, WSOL_MINT));
      if (q > 0) sells.push({ time: tx.blockTime ?? 0, tokens: -d });
      else transfersOut += -d;
    }
  }
  return { wallet, acquired, sells, transfersOut };
}

// ---------------------------------------------------------------------------
// Lancements récents d'un dev
// ---------------------------------------------------------------------------

export async function devLaunches(helius: Helius, dev: string, sinceSec: number, maxPages: number, meter: CreditMeter) {
  const launches: { mint: string; curve: string; createdAt: number }[] = [];
  let token: string | undefined;
  let pages = 0;
  let truncated = false;
  do {
    const page = await helius.getTransactionsForAddress(
      dev,
      { transactionDetails: "full", sortOrder: "desc", limit: 100, paginationToken: token, filters: { status: "succeeded", blockTime: { gte: Math.floor(sinceSec) } } },
      meter,
    );
    for (const tx of page.data as ParsedTx[]) {
      if (feePayer(tx) !== dev || !isCreateTx(tx)) continue;
      const pre = new Set((tx.meta?.preTokenBalances ?? []).map((b) => b.mint));
      const created = (tx.meta?.postTokenBalances ?? [])
        .filter((b) => !pre.has(b.mint) && b.mint !== WSOL_MINT)
        .sort((a, b) => Number(b.uiTokenAmount.amount) - Number(a.uiTokenAmount.amount))[0];
      if (created?.owner) launches.push({ mint: created.mint, curve: created.owner, createdAt: tx.blockTime ?? 0 });
    }
    token = page.paginationToken ?? undefined;
    pages++;
    if (token && pages >= maxPages) truncated = true;
  } while (token && pages < maxPages);
  return { launches, truncated };
}

/** Une curve encore incomplète plus de 24 h après sa création = lancement mort. */
export async function launchesAlive(
  helius: Helius,
  launches: { mint: string; curve: string; createdAt: number }[],
  aliveBonded: (mints: string[]) => Promise<Set<string>>,
  now: number,
  meter: CreditMeter,
): Promise<DevLaunch[]> {
  const curves = await helius.getMultipleAccounts<{ data: [string, string] }>(launches.map((l) => l.curve), "base64", meter);
  const bonded = launches.filter((_, i) => {
    const raw = curves[i]?.data?.[0];
    return raw ? Buffer.from(raw, "base64")[48] === 1 : false;
  });
  const alive = await aliveBonded(bonded.map((l) => l.mint));
  return launches.map((l) => ({
    mint: l.mint,
    createdAt: l.createdAt,
    alive: alive.has(l.mint) || (!bonded.includes(l) && now - l.createdAt < 86400),
  }));
}
