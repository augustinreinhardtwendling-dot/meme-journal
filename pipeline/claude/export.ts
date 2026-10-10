// Prépare les fichiers lus par Claude Code (dossier work/).
// Usage : tsx pipeline/claude/export.ts --step classement|fiches|watchlist [--date AAAA-MM-JJ]
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Sql } from "postgres";
import { closeDb, db, loadConfig } from "../../lib/db";
import { coinLinks } from "../../lib/solana";
import { todayUtc } from "../../lib/window";
import { trendingMetas } from "../sources/dexscreener";

export const WORK = join(import.meta.dirname, "..", "..", "work");

const { values: args } = parseArgs({ options: { step: { type: "string" }, date: { type: "string" } } });
const date = args.date ?? (process.env.JOURNAL_DATE || todayUtc());
const sql = db();

async function runFor(sql: Sql, d: string) {
  const [run] = await sql<{ id: number; journal_date: string; window_start: Date; window_end: Date }[]>`
    select id, journal_date, window_start, window_end from runs
    where journal_date = ${d} and status in ('collected', 'published')
    order by (kind = 'daily') desc, started_at desc limit 1`;
  if (!run) throw new Error(`aucun journal calculé pour le ${d}`);
  return run;
}

async function metasList(sql: Sql) {
  return sql<{ slug: string; label: string; parent: string | null; kind: string; description: string | null }[]>`
    select slug, label, parent, kind, description from metas order by kind, coalesce(parent, slug), slug`;
}

const norm = (s: string | null) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

async function exportClassement() {
  const run = await runFor(sql, date);
  // Tous les vrais bondings de la fenêtre (même morts ou exclus), pas encore classés.
  const coins = await sql<{ mint: string; name: string | null; symbol: string | null; description: string | null }[]>`
    select c.mint, c.name, c.symbol, c.description from coins c
    where c.journal_date = ${run.journal_date} and not c.is_ghost
      and not exists (select 1 from coin_metas cm where cm.mint = c.mint and cm.source = 'classification')`;
  // Les copies (même ticker et même nom) ne sont classées qu'une fois.
  const groups = new Map<string, { id: string; nom: string; ticker: string; description: string; n: number; mints: string[] }>();
  for (const c of coins) {
    const key = `${norm(c.symbol)}|${norm(c.name)}`;
    let g = groups.get(key);
    if (!g) {
      g = { id: `g${groups.size + 1}`, nom: c.name ?? "", ticker: c.symbol ?? "", description: "", n: 0, mints: [] };
      groups.set(key, g);
    }
    g.n++;
    g.mints.push(c.mint);
    if (!g.description && c.description) g.description = c.description.replace(/\s+/g, " ").slice(0, 160);
  }
  const list = [...groups.values()];
  const lines = list.map((g) => [g.id, g.nom, g.ticker, g.n > 1 ? `×${g.n}` : "", g.description].join(" | "));
  writeFileSync(
    join(WORK, "classement-input.json"),
    JSON.stringify({ journal: run.journal_date, metas: await metasList(sql), format_groupes: "id | nom | ticker | copies | description", groupes: lines }, null, 1),
  );
  // Correspondance groupe → mints, relue à l'ingestion (Claude n'a pas besoin des adresses).
  writeFileSync(join(WORK, "classement-groups.json"), JSON.stringify(Object.fromEntries(list.map((g) => [g.id, g.mints]))));
  console.log(`classement : ${coins.length} coins → ${list.length} groupes`);
}

async function exportFiches() {
  const cfg = await loadConfig();
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `CLAUDE_MODEL=${cfg.fiches.model}
`);
  const run = await runFor(sql, date);
  const max = cfg.fiches.max_per_day;
  // D'abord les retenus du jour (meilleur score), puis les fiches en attente des jours précédents.
  const today = await sql<{ mint: string }[]>`
    select e.mint from evaluations e left join fiches f on f.mint = e.mint
    where e.run_id = ${run.id} and e.status = 'retained' and (f.status is null or f.status <> 'done')
    order by e.score desc nulls last limit ${max}`;
  const backlog = await sql<{ mint: string }[]>`
    select mint from fiches where status in ('pending', 'failed') and attempts < 3
      and mint not in ${sql(today.length ? today.map((t) => t.mint) : [""])}
    order by created_at limit ${Math.max(0, max - today.length)}`;
  const mints = [...today, ...backlog].map((r) => r.mint);
  if (!mints.length) {
    writeFileSync(join(WORK, "fiches-input.json"), JSON.stringify({ journal: run.journal_date, coins: [] }));
    console.log("fiches : rien à rédiger");
    return;
  }
  await sql`insert into fiches (mint, run_id, status) select unnest(${mints}::text[]), ${run.id}, 'pending'
    on conflict (mint) do update set status = case when fiches.status = 'done' then 'done' else 'pending' end, updated_at = now()`;

  const rows = await sql<Record<string, unknown>[]>`
    select distinct on (c.mint) c.mint, c.name, c.symbol, c.description, c.twitter, c.telegram, c.website, c.dev_wallet,
      c.created_at, c.bonded_at, c.bonding_seconds, c.prebond_tx_count, round(c.migration_mcap_usd) as migration_mcap_usd,
      c.quote_symbol, c.journal_date, round(e.mcap_usd) as mcap_usd, round(e.ath_mcap_usd) as ath_mcap_usd, e.ath_at,
      round(e.volume_24h_usd) as volume_24h_usd, round(e.liquidity_usd) as liquidity_usd, e.holders, e.top10_pct,
      e.bundle_pct, e.snipers_pct, e.snipers_held_pct, e.insiders_pct, e.dev_sold_pct, e.dev_sell_drop_pct,
      e.unique_buyers_prebond, e.buyers_24h, e.sellers_24h, e.score, e.tags, e.metrics->'dev_sell' as dev_sell
    from coins c join evaluations e on e.mint = c.mint
    where c.mint in ${sql(mints)}
    order by c.mint, e.evaluated_at desc`;
  const coins = mints
    .map((m) => rows.find((r) => r.mint === m))
    .filter(Boolean)
    .map((r) => ({ ...r!, liens: { ...coinLinks(r!.mint as string), x: r!.twitter, telegram: r!.telegram, site: r!.website } }));
  writeFileSync(
    join(WORK, "fiches-input.json"),
    JSON.stringify(
      {
        journal: run.journal_date,
        date_redaction: todayUtc(),
        max_recherches_par_fiche: cfg.fiches.max_searches_per_fiche,
        metas: await metasList(sql),
        coins,
      },
      null,
      1,
    ),
  );
  console.log(`fiches : ${coins.length} coin(s) à documenter (${today.length} du jour, ${backlog.length} en attente)`);
}

async function exportWatchlist() {
  const run = await runFor(sql, date);
  const stats = await sql`
    select s.meta, m.label, m.kind, s.day, s.bonded, s.survived_a, s.retained, s.runners, s.rate_3d, s.rate_7d, s.volume_trend, s.saturated
    from meta_stats s join metas m on m.slug = s.meta
    where s.day between ${run.journal_date}::date - 6 and ${run.journal_date}::date and s.bonded > 0
    order by s.day desc, s.bonded desc`;
  const fiches = await sql`
    select c.symbol, c.name, c.journal_date, f.content->'catalyseur'->>'resume' as catalyseur, f.content->'metas' as metas,
      f.content->'peut_remarcher' as peut_remarcher
    from fiches f join coins c on c.mint = f.mint
    where f.status = 'done' and c.journal_date between ${run.journal_date}::date - 7 and ${run.journal_date}::date
    order by c.journal_date desc`;
  const isMonday = new Date(`${run.journal_date}T12:00:00Z`).getUTCDay() === 1;
  const week = isMonday
    ? await sql`
        select r.journal_date, r.counts->'retained' as retenus, r.summary->'dominant_meta' as meta_dominante,
          (select json_agg(json_build_object('symbol', c.symbol, 'score', e.score, 'tags', e.tags))
             from evaluations e join coins c on c.mint = e.mint where e.run_id = r.id and e.status = 'retained') as coins
        from runs r where r.kind = 'daily' and r.journal_date between ${run.journal_date}::date - 7 and ${run.journal_date}::date - 1
        order by r.journal_date`
    : [];
  const trending = await trendingMetas().catch(() => []);
  writeFileSync(
    join(WORK, "watchlist-input.json"),
    JSON.stringify(
      {
        journal: run.journal_date,
        lundi_recap_hebdo: isMonday,
        stats_metas_7j: stats,
        fiches_recentes: fiches,
        metas_tendance_dexscreener: trending.slice(0, 15).map((t) => ({ nom: t.name, slug: t.slug, coins: t.tokenCount, mcap: Math.round(t.marketCap), var_24h_pct: t.marketCapChange?.h24 ?? null })),
        semaine_precedente: week,
      },
      null,
      1,
    ),
  );
  console.log(`watchlist : ${stats.length} lignes de stats, ${fiches.length} fiches récentes${isMonday ? ", récap hebdo demandé" : ""}`);
}

mkdirSync(WORK, { recursive: true });
try {
  if (args.step === "classement") await exportClassement();
  else if (args.step === "fiches") await exportFiches();
  else if (args.step === "watchlist") await exportWatchlist();
  else throw new Error("--step classement|fiches|watchlist");
} finally {
  await closeDb();
}
