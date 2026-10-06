import Link from "next/link";
import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { dateLong, num } from "@/lib/format";
import { listRuns, searchCoins } from "@/lib/queries";

const STATUS = { retained: "retenu", dead: "mort", excluded: "exclu", not_analyzed: "non analysé" } as Record<string, string>;

export default async function ArchivesPage({ searchParams }: PageProps<"/archives">) {
  await connection();
  const q = String((await searchParams).q ?? "").trim();
  const [runs, results] = await Promise.all([listRuns(), q ? searchCoins(q) : Promise.resolve([])]);

  // Calendrier : regroupement par mois
  const byMonth = new Map<string, typeof runs>();
  for (const r of runs) {
    const key = r.journal_date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(r);
  }

  return (
    <AppShell active="/archives">
      <h1 className="mb-4 text-xl font-semibold">Archives</h1>
      <form className="mb-5 flex gap-2" action="/archives">
        <input
          name="q"
          defaultValue={q}
          placeholder="Ticker, nom, meta ou adresse"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-base outline-none focus:border-accent"
        />
        <button className="rounded-lg bg-accent px-4 font-medium text-accent-ink">Chercher</button>
      </form>

      {q && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm text-muted">{num(results.length)} résultat(s) pour « {q} »</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {results.map((r) => (
              <li key={r.mint}>
                <Link href={`/journal/${r.journal_date}`} className="flex items-baseline justify-between gap-2 px-4 py-2.5">
                  <span className="truncate">
                    {r.name ?? "Sans nom"} <span className="font-mono text-xs text-muted">${r.symbol}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {STATUS[r.status ?? ""] ?? "—"}
                    {r.score != null && ` · ${r.score}`} · {r.journal_date}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {[...byMonth].map(([month, list]) => (
        <section key={month} className="mb-5">
          <h2 className="mb-2 text-sm capitalize text-muted">
            {new Date(`${month}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })}
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {list.map((r) => (
              <li key={r.id}>
                <Link href={`/journal/${r.journal_date}`} className="block rounded-xl border border-line bg-surface px-3 py-2.5">
                  <div className="text-sm capitalize">{dateLong(r.journal_date)}</div>
                  <div className="tabular text-xs text-muted">
                    {num(r.counts?.retained)} retenus / {num(r.counts?.bonded)} bondés
                    {r.counts?.runners ? ` · ${r.counts.runners} runner(s)` : ""}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!runs.length && <p className="text-sm text-muted">Aucun journal enregistré.</p>}
    </AppShell>
  );
}
