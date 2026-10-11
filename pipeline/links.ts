// Second cerveau : liens FACTUELS entre coins retenus (aucun appel payant, recalculés à chaque passage).
//  - même wallet de dev ou de creator ;
//  - wallets de dev financés par la même source juste avant le lancement ;
//  - copie (même ticker ou même nom) ;
//  - même meta précise à 2 jours d'intervalle (une « vague »).
// Usage : tsx pipeline/links.ts
import type { Sql } from "postgres";
import { closeDb, db } from "../lib/db";
import { shortAddress } from "../lib/format";

export interface RetainedRef {
  mint: string;
  symbol: string | null;
  name: string | null;
  dev_wallet: string | null;
  creator_wallet: string | null;
  journal_date: string;
  bonded_at: Date;
}

interface Link {
  a: string;
  b: string;
  kind: "meme_dev" | "financement_commun" | "copie" | "meme_vague";
  strength: number;
  explanation: string;
}

/** Les coins retenus dans le journal « officiel » de chaque jour. */
export async function retainedCoins(sql: Sql): Promise<RetainedRef[]> {
  return sql<RetainedRef[]>`
    with official as (
      select distinct on (journal_date) id from runs where status in ('collected', 'published')
      order by journal_date, (kind = 'daily') desc, started_at desc)
    select distinct on (c.mint) c.mint, c.symbol, c.name, c.dev_wallet, c.creator_wallet, c.journal_date::text as journal_date, c.bonded_at
    from evaluations e join official o on o.id = e.run_id join coins c on c.mint = e.mint
    where e.status = 'retained'
    order by c.mint`;
}

const norm = (s: string | null) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const sym = (c: RetainedRef) => `$${c.symbol ?? "?"}`;
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000;

function pairs<T>(xs: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]]);
  return out;
}

function groupBy<T>(xs: T[], key: (x: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

export async function computeRuleLinks(sql: Sql): Promise<Link[]> {
  const coins = await retainedCoins(sql);
  const byMint = new Map(coins.map((c) => [c.mint, c]));
  const links: Link[] = [];
  const add = (x: RetainedRef, y: RetainedRef, kind: Link["kind"], strength: number, explanation: string) => {
    const [a, b] = x.mint < y.mint ? [x.mint, y.mint] : [y.mint, x.mint];
    links.push({ a, b, kind, strength, explanation });
  };

  // 1. Même wallet de dev (signataire de la création) ou même wallet « creator » de la curve.
  for (const field of ["dev_wallet", "creator_wallet"] as const) {
    for (const [wallet, group] of groupBy(coins, (c) => c[field])) {
      for (const [x, y] of pairs(group)) {
        add(x, y, "meme_dev", 3, `${sym(x)} et ${sym(y)} ont été lancés par le même wallet (${shortAddress(wallet)}) : même équipe derrière les deux coins.`);
      }
    }
  }

  // 2. Wallets de dev financés par la même source (hors plateformes d'échange et hubs).
  const devFunders = await sql<{ wallet: string; funder: string }[]>`
    select w.wallet, w.funder from wallet_funding w
    where w.funder is not null and w.wallet in ${sql(coins.flatMap((c) => [c.dev_wallet, c.creator_wallet]).filter((x): x is string => !!x).concat(""))}
      and not exists (select 1 from known_wallets k where k.address = w.funder)`;
  const funderOf = new Map(devFunders.map((r) => [r.wallet, r.funder]));
  const byFunder = groupBy(coins, (c) => (c.dev_wallet && funderOf.get(c.dev_wallet)) || (c.creator_wallet && funderOf.get(c.creator_wallet)) || null);
  for (const [funder, group] of byFunder) {
    for (const [x, y] of pairs(group)) {
      if (x.dev_wallet && x.dev_wallet === y.dev_wallet) continue; // déjà couvert par « même dev »
      add(x, y, "financement_commun", 3, `Les wallets de dev de ${sym(x)} et ${sym(y)} ont reçu leurs SOL de la même source (${shortAddress(funder)}) juste avant le lancement : probablement la même équipe.`);
    }
  }

  // 3. Copie : même ticker ou même nom.
  const seenCopy = new Set<string>();
  for (const key of [(c: RetainedRef) => norm(c.symbol), (c: RetainedRef) => norm(c.name)]) {
    for (const [, group] of groupBy(coins, (c) => key(c) || null)) {
      const sorted = [...group].sort((p, q) => p.bonded_at.getTime() - q.bonded_at.getTime());
      for (const [x, y] of pairs(sorted)) {
        const id = [x.mint, y.mint].sort().join("|");
        if (seenCopy.has(id)) continue;
        seenCopy.add(id);
        const gap = Math.round(daysBetween(x.bonded_at.toISOString(), y.bonded_at.toISOString()) * 24);
        const when = gap < 24 ? `${gap} h plus tard` : `${Math.round(gap / 24)} jour(s) plus tard`;
        const day = (c: RetainedRef) => new Date(c.bonded_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
        const text =
          norm(x.symbol) === norm(y.symbol)
            ? `Deux coins ${sym(x)} : le second (bondé le ${day(y)}) a repris le nom du premier (bondé le ${day(x)}), ${when}. Les deux versions ont marché : c'est le thème qui portait, pas un seul coin.`
            : `${sym(y)} reprend le nom de ${sym(x)} (« ${x.name ?? "?"} ») et a bondé ${when}. Les deux versions ont marché : c'est le thème qui portait, pas un seul coin.`;
        add(x, y, "copie", 2, text);
      }
    }
  }

  // 4. Même meta précise à 2 jours d'intervalle (hors metas fourre-tout).
  const metaRows = await sql<{ mint: string; meta: string; label: string }[]>`
    select cm.mint, cm.meta, m.label from coin_metas cm join metas m on m.slug = cm.meta
    where cm.mint in ${sql(coins.map((c) => c.mint).concat(""))}
      and m.kind = 'theme' and m.slug not in ('autre', 'crypto-meta', 'actualite', 'culture-internet', 'celebrite', 'animal', 'ia', 'politique', 'sport')`;
  const seenWave = new Set<string>();
  for (const [meta, rows] of groupBy(metaRows, (r) => r.meta)) {
    const label = rows[0].label;
    const group = rows.map((r) => byMint.get(r.mint)!).filter(Boolean);
    for (const [x, y] of pairs(group)) {
      const id = [x.mint, y.mint, meta].sort().join("|");
      if (seenWave.has(id) || daysBetween(x.journal_date, y.journal_date) > 2) continue;
      seenWave.add(id);
      const gap = daysBetween(x.journal_date, y.journal_date);
      const when = gap === 0 ? "le même jour" : gap === 1 ? "à un jour d'intervalle" : `à ${gap} jours d'intervalle`;
      add(x, y, "meme_vague", 1, `Même meta « ${label} », ${when} : les deux font partie de la même vague de lancements.`);
    }
  }

  // Un seul lien par paire et par type (le plus fort).
  const dedup = new Map<string, Link>();
  for (const l of links) {
    const k = `${l.a}|${l.b}|${l.kind}`;
    if (!dedup.has(k) || dedup.get(k)!.strength < l.strength) dedup.set(k, l);
  }
  return [...dedup.values()];
}

export async function saveRuleLinks(sql: Sql) {
  const links = await computeRuleLinks(sql);
  await sql.begin(async (tx) => {
    await tx`delete from coin_links where source = 'regle'`;
    for (const l of links) {
      await tx`insert into coin_links (mint_a, mint_b, kind, strength, explanation, source)
        values (${l.a}, ${l.b}, ${l.kind}, ${l.strength}, ${l.explanation}, 'regle') on conflict do nothing`;
    }
  });
  return links;
}

if (process.argv[1]?.endsWith("links.ts")) {
  const sql = db();
  try {
    const links = await saveRuleLinks(sql);
    const byKind: Record<string, number> = {};
    for (const l of links) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
    console.log(`liens factuels : ${links.length}`, byKind);
  } finally {
    await closeDb();
  }
}
