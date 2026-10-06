// Insiders : le dev et les wallets liés à lui, ou des groupes de wallets financés par une même source.
import type { FundingEdge, Trade } from "../types";

export interface InsiderContext {
  devWallets: Set<string>;
  supply: number;
  /** Adresses à ne jamais considérer comme « source commune » (CEX, bridges, gros hubs). */
  hubs: Set<string>;
  /** Taille minimale d'un groupe hors dev pour qu'il compte. */
  minCluster: number;
}

export interface InsiderCluster {
  root: string;
  funder: string | null;
  wallets: string[];
  containsDev: boolean;
  tokens: number;
  pct: number;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Regroupe les acheteurs par source de financement :
 *  - un wallet financé par le dev (ou par un wallet du groupe du dev) rejoint le groupe du dev ;
 *  - des wallets financés par la même source juste avant le lancement forment un groupe.
 * Les sources « hubs » (plateformes d'échange…) ne créent pas de lien.
 * Résultat : part de la supply achetée par le groupe du dev et par les groupes coordonnés.
 */
export function detectInsiders(trades: Trade[], funding: FundingEdge[], ctx: InsiderContext) {
  const uf = new UnionFind();
  const devs = [...ctx.devWallets];
  for (let i = 1; i < devs.length; i++) uf.union(devs[0], devs[i]);

  const funderOf = new Map<string, string>();
  for (const e of funding) {
    if (!e.funder || ctx.hubs.has(e.funder) || e.funder === e.wallet) continue;
    funderOf.set(e.wallet, e.funder);
    uf.union(e.wallet, e.funder);
  }

  const bought = new Map<string, number>();
  for (const t of trades) if (t.side === "buy") bought.set(t.wallet, (bought.get(t.wallet) ?? 0) + t.tokens);

  // Groupes parmi les wallets acheteurs (+ dev même s'il n'a pas acheté)
  const groups = new Map<string, string[]>();
  for (const w of new Set([...bought.keys(), ...devs])) {
    const r = uf.find(w);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(w);
  }

  const devRoot = devs.length ? uf.find(devs[0]) : null;
  const clusters: InsiderCluster[] = [];
  for (const [root, wallets] of groups) {
    const containsDev = root === devRoot;
    const buyers = wallets.filter((w) => bought.has(w));
    if (!containsDev && buyers.length < ctx.minCluster) continue;
    if (containsDev && buyers.length === 0) continue;
    const tokens = buyers.reduce((s, w) => s + (bought.get(w) ?? 0), 0);
    const funders = new Set(buyers.map((w) => funderOf.get(w)).filter(Boolean));
    clusters.push({
      root,
      funder: funders.size === 1 ? [...funders][0]! : null,
      wallets: buyers,
      containsDev,
      tokens,
      pct: (tokens / ctx.supply) * 100,
    });
  }
  clusters.sort((a, b) => b.tokens - a.tokens);
  const devCluster = clusters.find((c) => c.containsDev);
  return {
    /** Dev + wallets liés + groupes coordonnés. */
    pct: clusters.reduce((s, c) => s + c.pct, 0),
    devClusterPct: devCluster?.pct ?? 0,
    wallets: clusters.flatMap((c) => c.wallets),
    clusters,
  };
}
