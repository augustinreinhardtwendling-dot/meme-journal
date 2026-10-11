// Suivi temporaire du passage de test : une ligne à chaque changement d'état.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const d = process.argv[2];
let last = "";
const started = Date.now();
for (;;) {
  try {
    const [r] = await sql`
      select r.claude_status, r.claude_duration_s, r.summary->>'dominant_meta' as dom,
        (select count(*) from coin_metas cm join coins c on c.mint = cm.mint where c.journal_date = ${d} and cm.source = 'classification')::int as classes,
        (select count(*) from fiches f join coins c on c.mint = f.mint where c.journal_date = ${d} and f.status = 'done')::int as fiches_ok,
        (select count(*) from fiches f join coins c on c.mint = f.mint where c.journal_date = ${d})::int as fiches_total,
        (select count(*) from insights where journal_date = ${d} and kind = 'watchlist')::int as watch
      from runs r where r.journal_date = ${d} and r.kind = 'daily'`;
    const line = `classement : ${r.classes} associations · fiches : ${r.fiches_ok}/${r.fiches_total} · statut Claude : ${r.claude_status} · durée cumulée : ${r.claude_duration_s ?? 0} s · meta dominante : ${r.dom ?? "—"} · À surveiller : ${r.watch ? "oui" : "non"}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (r.watch || Date.now() - started > 80 * 60_000) break;
  } catch (e) {
    console.log(`erreur : ${(e as Error).message}`);
  }
  await new Promise((ok) => setTimeout(ok, 60_000));
}
await sql.end();
