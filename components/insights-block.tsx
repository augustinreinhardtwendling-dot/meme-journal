import type { insightsFor } from "@/lib/queries";

type Insights = Awaited<ReturnType<typeof insightsFor>>;
const CONFIANCE: Record<string, string> = { faible: "faible", moyen: "moyenne", eleve: "élevée" };

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** « À surveiller » : narratifs susceptibles de remarcher, rédigés par Claude Code. */
export function WatchlistBlock({ watchlist }: { watchlist: NonNullable<Insights["watchlist"]> }) {
  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-semibold">À surveiller</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{watchlist.resume}</p>
      <ul className="mt-3 space-y-3">
        {watchlist.narratifs.map((n, i) => (
          <li key={i} className="rounded-xl bg-surface-2 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{n.titre}</span>
              <span className="shrink-0 text-xs text-muted">confiance {CONFIANCE[n.confiance] ?? n.confiance}</span>
            </div>
            <p className="mt-1 leading-relaxed text-muted">{n.pourquoi}</p>
            {n.evenements.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[12px]">
                {n.evenements.map((e, j) => (
                  <li key={j}>
                    <span className="tabular text-muted">{e.date ?? "à venir"} · </span>
                    {e.url ? (
                      <a className="text-info" href={e.url} target="_blank" rel="noreferrer">{e.titre}</a>
                    ) : (
                      e.titre
                    )}
                  </li>
                ))}
              </ul>
            )}
            {n.sources.length > 0 && (
              <p className="mt-1 text-[11px] text-muted">
                Sources :{" "}
                {n.sources.map((u) => (
                  <a key={u} className="text-info" href={u} target="_blank" rel="noreferrer">
                    {host(u)}{" "}
                  </a>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted">Analyse automatique, pas un conseil d&apos;investissement.</p>
    </section>
  );
}

/** Récap de la semaine (publié le lundi). */
export function WeeklyRecapBlock({ recap }: { recap: NonNullable<Insights["recap"]> }) {
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className="mt-5 space-y-3 rounded-2xl border border-info/40 bg-surface p-4">
      <h2 className="font-semibold">Récap de la semaine <span className="text-sm font-normal text-muted">· {recap.periode}</span></h2>
      {list("Faits marquants", recap.faits_marquants)}
      {list("Metas gagnantes", recap.metas_gagnantes)}
      {list("Metas en baisse", recap.metas_en_baisse)}
      {recap.coins_marquants.length > 0 && list("Coins marquants", recap.coins_marquants.map((c) => `$${c.symbol} : ${c.pourquoi}`))}
      {list("Leçons", recap.lecons)}
    </section>
  );
}
