// Valide les fichiers écrits par Claude Code et les enregistre en base.
// Usage : tsx pipeline/claude/ingest.ts --step classement|fiches|watchlist [--date AAAA-MM-JJ]
// Ne plante jamais le workflow : un fichier absent ou invalide = étape notée en échec, journal publié quand même.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Sql } from "postgres";
import { closeDb, db } from "../../lib/db";
import { todayUtc } from "../../lib/window";
import {
  adviceViolations,
  allText,
  classementOutputSchema,
  ficheSchema,
  fichesOutputSchema,
  nouvelleMetaSchema,
  watchlistSchema,
} from "../../lib/claude-schema";

const WORK = join(import.meta.dirname, "..", "..", "work");
const { values: args } = parseArgs({ options: { step: { type: "string" }, date: { type: "string" } } });
const date = args.date ?? (process.env.JOURNAL_DATE || todayUtc());
const sql = db();

function readJson(name: string): unknown | null {
  const p = join(WORK, name);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8").trim();
  // Tolère un bloc ```json … ``` autour du contenu.
  const body = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(body);
  } catch (e) {
    console.log(`  ⚠ ${name} n'est pas du JSON valide : ${(e as Error).message}`);
    return null;
  }
}

/** Résumé du passage Claude Code (sortie --output-format json de la CLI). */
function claudeRunInfo(step: string) {
  const info = readJson(`claude-${step}.json`) as { duration_ms?: number; is_error?: boolean; result?: string; num_turns?: number } | null;
  const text = `${info?.result ?? ""}`;
  return {
    seconds: info?.duration_ms ? Math.round(info.duration_ms / 1000) : 0,
    isError: info?.is_error ?? info == null,
    quota: /usage limit|rate limit|limit reached|quota/i.test(text),
    turns: info?.num_turns ?? null,
  };
}

async function runId(sql: Sql) {
  const [run] = await sql<{ id: number }[]>`
    select id from runs where journal_date = ${date} and status in ('collected', 'published')
    order by (kind = 'daily') desc, started_at desc limit 1`;
  return run?.id ?? null;
}

async function addDuration(sql: Sql, id: number | null, seconds: number) {
  if (id && seconds) await sql`update runs set claude_duration_s = coalesce(claude_duration_s, 0) + ${seconds} where id = ${id}`;
}

/** Enregistre les nouvelles metas valides et renvoie l'ensemble des slugs utilisables. */
async function upsertNewMetas(sql: Sql, raw: unknown[] | undefined): Promise<Set<string>> {
  const existing = new Set((await sql<{ slug: string }[]>`select slug from metas`).map((r) => r.slug));
  for (const item of raw ?? []) {
    const p = nouvelleMetaSchema.safeParse(item);
    if (!p.success || existing.has(p.data.slug)) continue;
    const parent = p.data.parent && existing.has(p.data.parent) ? p.data.parent : null;
    await sql`insert into metas (slug, label, parent, kind, description, created_by)
      values (${p.data.slug}, ${p.data.label}, ${parent}, ${p.data.kind}, ${p.data.description ?? null}, 'claude')
      on conflict (slug) do nothing`;
    existing.add(p.data.slug);
    console.log(`  nouvelle meta : ${p.data.slug} (${p.data.label})`);
  }
  return existing;
}

async function ingestClassement() {
  const id = await runId(sql);
  const run = claudeRunInfo("classement");
  await addDuration(sql, id, run.seconds);
  const out = classementOutputSchema.safeParse(readJson("classement-output.json"));
  const groups = readJson("classement-groups.json") as Record<string, string[]> | null;
  if (!out.success || !groups) {
    console.log(`classement : sortie absente ou invalide${run.quota ? " (quota Claude atteint)" : ""}`);
    return;
  }
  const valid = await upsertNewMetas(sql, out.data.nouvelles_metas);
  const rows: { mint: string; meta: string }[] = [];
  let classified = 0;
  for (const [gid, slugs] of Object.entries(out.data.classement)) {
    const mints = groups[gid];
    const ok = [...new Set(slugs)].filter((s) => valid.has(s)).slice(0, 3);
    if (!mints || !ok.length) continue;
    classified++;
    for (const mint of mints) for (const meta of ok) rows.push({ mint, meta });
  }
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await sql`insert into coin_metas (mint, meta, source)
      select * from unnest(${chunk.map((r) => r.mint)}::text[], ${chunk.map((r) => r.meta)}::text[], ${chunk.map(() => "classification")}::text[])
      on conflict (mint, meta) do nothing`;
  }
  console.log(`classement : ${classified}/${Object.keys(groups).length} groupes classés, ${rows.length} associations coin → meta`);
}

async function ingestFiches() {
  const id = await runId(sql);
  const run = claudeRunInfo("fiches");
  await addDuration(sql, id, run.seconds);
  const input = readJson("fiches-input.json") as { coins?: { mint: string; symbol: string }[] } | null;
  const expected = new Map((input?.coins ?? []).map((c) => [c.mint, c.symbol]));
  if (!expected.size) {
    console.log("fiches : aucune fiche demandée");
    if (id) await sql`update runs set claude_status = coalesce(claude_status, 'skipped') where id = ${id}`;
    return;
  }
  const parsed = fichesOutputSchema.safeParse(readJson("fiches-output.json"));
  const valid = parsed.success ? await upsertNewMetas(sql, parsed.data.nouvelles_metas) : new Set<string>();
  const done = new Set<string>();
  const errors = new Map<string, string>();

  for (const raw of parsed.success ? parsed.data.fiches : []) {
    const p = ficheSchema.safeParse(raw);
    const mint = (raw as { mint?: string })?.mint ?? "?";
    if (!p.success) {
      errors.set(mint, p.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "));
      continue;
    }
    const f = p.data;
    if (!expected.has(f.mint)) continue;
    const advice = adviceViolations(allText(f));
    if (advice.length) {
      errors.set(f.mint, `formulation de conseil interdite (${advice.join(", ")})`);
      continue;
    }
    if (!f.catalyseur.identifie && !/non identifi/i.test(f.catalyseur.resume)) {
      f.catalyseur.resume = `Catalyseur non identifié. ${f.catalyseur.resume}`;
    }
    f.metas = f.metas.filter((m) => valid.has(m));
    await sql`update fiches set status = 'done', content = ${sql.json(f as never)}, can_rerun = ${f.peut_remarcher.verdict},
      confidence = ${f.peut_remarcher.confiance}, model = 'claude-code', last_error = null, attempts = attempts + 1, updated_at = now()
      where mint = ${f.mint}`;
    for (const meta of f.metas) {
      await sql`insert into coin_metas (mint, meta, source) values (${f.mint}, ${meta}, 'fiche') on conflict (mint, meta) do nothing`;
    }
    done.add(f.mint);
  }

  // Claude Code n'a pas tourné (jeton absent, étape sautée) : la fiche attend, sans compter de tentative.
  const ran = existsSync(join(WORK, "claude-fiches.json"));
  const reasonMissing = !ran ? "Claude Code non lancé" : run.quota ? "quota Claude atteint" : run.isError ? "passage Claude Code en échec" : "fiche absente de la sortie";
  for (const [mint, symbol] of expected) {
    if (done.has(mint)) continue;
    const err = errors.get(mint) ?? reasonMissing;
    const counts = ran || errors.has(mint) ? 1 : 0;
    await sql`update fiches set attempts = attempts + ${counts}, last_error = ${err},
      status = case when attempts + ${counts} >= 3 then 'failed' else 'pending' end, updated_at = now() where mint = ${mint}`;
    console.log(`  ✗ $${symbol} : ${err}`);
  }
  const status = done.size === expected.size ? "ok" : done.size ? "partial" : !ran ? "pending" : run.quota ? "quota" : "failed";
  if (id) await sql`update runs set claude_status = ${status} where id = ${id}`;
  console.log(`fiches : ${done.size}/${expected.size} enregistrées (statut ${status})`);
}

async function ingestWatchlist() {
  const id = await runId(sql);
  const run = claudeRunInfo("watchlist");
  await addDuration(sql, id, run.seconds);
  const p = watchlistSchema.safeParse(readJson("watchlist-output.json"));
  if (!p.success) {
    console.log(`watchlist : sortie absente ou invalide${p.error ? ` (${p.error.issues[0]?.path.join(".")} : ${p.error.issues[0]?.message})` : ""}`);
    return;
  }
  const advice = adviceViolations(allText(p.data));
  if (advice.length) {
    console.log(`watchlist rejetée : formulation de conseil (${advice.join(", ")})`);
    return;
  }
  const { recap_hebdo, ...watch } = p.data;
  await sql`insert into insights (kind, journal_date, content) values ('watchlist', ${date}, ${sql.json(watch as never)})
    on conflict (kind, journal_date) do update set content = excluded.content, created_at = now()`;
  if (recap_hebdo) {
    await sql`insert into insights (kind, journal_date, period_start, period_end, content)
      values ('weekly_recap', ${date}, ${date}::date - 7, ${date}::date - 1, ${sql.json(recap_hebdo as never)})
      on conflict (kind, journal_date) do update set content = excluded.content, created_at = now()`;
  }
  console.log(`watchlist : ${watch.narratifs.length} narratifs${recap_hebdo ? " + récap hebdo" : ""}`);
}

try {
  if (args.step === "classement") await ingestClassement();
  else if (args.step === "fiches") await ingestFiches();
  else if (args.step === "watchlist") await ingestWatchlist();
  else throw new Error("--step classement|fiches|watchlist");
} catch (e) {
  console.log(`ingestion ${args.step} : erreur ${(e as Error).message}`);
} finally {
  await closeDb();
}
