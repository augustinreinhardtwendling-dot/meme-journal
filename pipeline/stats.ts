// Statistiques des metas : lancements, survivants, retenus, taux glissants, tendance, saturation.
// Usage : tsx pipeline/stats.ts [--date AAAA-MM-JJ] [--to AAAA-MM-JJ]
import { parseArgs } from "node:util";
import type { Sql } from "postgres";
import type { Config } from "../lib/config";
import { closeDb, db, loadConfig } from "../lib/db";
import { addDays, todayUtc } from "../lib/window";

interface DayRow {
  meta: string;
  bonded: number;
  survived_a: number;
  retained: number;
  runners: number;
}

export async function computeMetaStats(sql: Sql, day: string, cfg: Config) {
  const [run] = await sql<{ id: number }[]>`
    select id from runs where journal_date = ${day} and status in ('collected', 'published')
    order by (kind = 'daily') desc, started_at desc limit 1`;
  if (!run) return null;

  const rows = await sql<DayRow[]>`
    select cm.meta,
      count(distinct c.mint)::int as bonded,
      count(distinct c.mint) filter (where e.status <> 'dead')::int as survived_a,
      count(distinct c.mint) filter (where e.status = 'retained')::int as retained,
      count(distinct c.mint) filter (where e.status = 'retained' and 'Runner' = any(e.tags))::int as runners
    from coins c
    join coin_metas cm on cm.mint = c.mint
    join evaluations e on e.mint = c.mint and e.run_id = ${run.id}
    where c.journal_date = ${day} and not c.is_ghost
    group by cm.meta`;
  if (!rows.length) return null;

  await sql`delete from meta_stats where day = ${day}`;
  for (const r of rows) {
    await sql`insert into meta_stats (day, meta, bonded, survived_a, retained, runners, success_rate)
      values (${day}, ${r.meta}, ${r.bonded}, ${r.survived_a}, ${r.retained}, ${r.runners}, ${r.bonded ? r.retained / r.bonded : null})`;
  }

  // Taux glissants et tendance à partir des jours précédents déjà calculés.
  type Hist = { meta: string; day: string; bonded: number; survived_a: number; retained: number };
  const hist: Hist[] = await sql<Hist[]>`
    select meta, day::text as day, bonded, survived_a, retained from meta_stats
    where day between ${addDays(day, -6)} and ${day}`;
  const byMeta = new Map<string, Hist[]>();
  for (const h of hist) {
    if (!byMeta.has(h.meta)) byMeta.set(h.meta, []);
    byMeta.get(h.meta)!.push(h);
  }
  const d3 = addDays(day, -2);
  for (const r of rows) {
    const h = byMeta.get(r.meta) ?? [];
    const last3 = h.filter((x) => x.day >= d3);
    const prev = h.filter((x) => x.day < d3);
    const sum = (xs: Hist[], k: "bonded" | "survived_a" | "retained") => xs.reduce((s, x) => s + x[k], 0);
    const rate3 = sum(last3, "bonded") ? sum(last3, "retained") / sum(last3, "bonded") : null;
    const rate7 = sum(h, "bonded") ? sum(h, "retained") / sum(h, "bonded") : null;
    let trend: string | null = null;
    if (prev.length) {
      const avgRecent = sum(last3, "bonded") / 3;
      const avgPrev = sum(prev, "bonded") / Math.max(1, new Set(prev.map((x) => x.day)).size);
      trend = avgPrev === 0 ? "hausse" : avgRecent / avgPrev > 1.3 ? "hausse" : avgRecent / avgPrev < 0.7 ? "baisse" : "stable";
    }
    const bonded7 = sum(h, "bonded");
    const saturated = bonded7 >= cfg.metas.saturation_min_bonded_7d && sum(h, "survived_a") / bonded7 < cfg.metas.saturation_max_alive_rate;
    await sql`update meta_stats set rate_3d = ${rate3}, rate_7d = ${rate7}, volume_trend = ${trend}, saturated = ${saturated}
      where day = ${day} and meta = ${r.meta}`;
  }

  // Meta dominante du jour : le thème le plus lancé (hors « autre »).
  const [dom] = await sql<{ label: string; bonded: number; survived_a: number }[]>`
    select m.label, s.bonded, s.survived_a from meta_stats s join metas m on m.slug = s.meta
    where s.day = ${day} and m.kind = 'theme' and m.slug <> 'autre'
    order by s.bonded desc, s.survived_a desc limit 1`;
  if (dom) {
    const text = `${dom.label} (${dom.bonded} bondés, ${dom.survived_a} encore vivants)`;
    await sql`update runs set summary = coalesce(summary, '{}'::jsonb) || ${sql.json({ dominant_meta: text } as never)} where id = ${run.id}`;
  }
  return { metas: rows.length, dominant: dom?.label ?? null };
}

if (process.argv[1]?.endsWith("stats.ts")) {
  const { values: args } = parseArgs({ options: { date: { type: "string" }, to: { type: "string" } } });
  const from = args.date ?? (process.env.JOURNAL_DATE || todayUtc());
  const to = args.to ?? from;
  const sql = db();
  const cfg = await loadConfig();
  try {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const r = await computeMetaStats(sql, d, cfg);
      console.log(r ? `${d} : ${r.metas} metas, dominante ${r.dominant ?? "—"}` : `${d} : pas de classement`);
    }
  } finally {
    await closeDb();
  }
}
