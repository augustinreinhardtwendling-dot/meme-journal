import Link from "next/link";
import { dateLong, dateTime, num, usd } from "@/lib/format";
import { excludedCoins, retainedCoins, type RunRow } from "@/lib/queries";
import { addDays, todayUtc } from "@/lib/window";
import { CoinCard } from "./coin-card";
import { ExcludedBlock } from "./excluded-block";

export async function JournalView({ run }: { run: RunRow }) {
  const [retained, excluded] = await Promise.all([retainedCoins(run.id), excludedCoins(run.id)]);
  const c = run.counts;
  const runners = retained.filter((r) => r.tags.includes("Runner")).length;
  const fichesPending = run.claude_status == null || ["pending", "failed", "quota"].includes(run.claude_status);

  return (
    <>
      <header className="mb-4 flex items-end justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Journal</p>
          <h1 className="text-xl font-semibold capitalize">{dateLong(run.journal_date)}</h1>
          <p className="mt-0.5 text-xs text-muted">
            Coins bondés du {dateTime(run.window_start)} au {dateTime(run.window_end)} · au moins 24 h de recul
          </p>
        </div>
        <div className="flex shrink-0 gap-1 text-sm">
          <Link className="rounded-lg border border-line px-2.5 py-1 text-info" href={`/journal/${addDays(run.journal_date, -1)}`} aria-label="Journal de la veille">‹</Link>
          {run.journal_date < todayUtc() && (
            <Link className="rounded-lg border border-line px-2.5 py-1 text-info" href={`/journal/${addDays(run.journal_date, 1)}`} aria-label="Journal du lendemain">›</Link>
          )}
        </div>
      </header>

      <section className="mb-5 rounded-2xl border border-line bg-surface p-4 text-sm leading-7">
        <ul className="tabular">
          <li><span className="text-muted">SOL :</span> {usd(run.sol_price_usd)}</li>
          <li>
            <span className="text-muted">Entonnoir :</span> {num(c?.bonded)} bondés → {num(c?.stage_a)} encore vivants → {" "}
            <span className="font-semibold text-accent">{num(c?.retained)} retenus</span>
            {runners > 0 && <span className="text-muted"> (dont {runners} runner{runners > 1 ? "s" : ""})</span>}
          </li>
          <li className="text-xs leading-5 text-muted">
            + {num(c?.ghost)} migrations fantômes ignorées. « Vivants » = mcap au-dessus de celle de la migration et plus de 50 k$ de
            volume sur 24 h ; les autres sont écartés pour manipulation (détail dans « Exclus »).
          </li>
          <li><span className="text-muted">Meta dominante :</span> {run.summary?.dominant_meta ?? <span className="text-muted">classement à venir (étape 4)</span>}</li>
        </ul>
        {fichesPending && retained.length > 0 && (
          <p className="mt-2 text-xs text-warn">Fiches en attente : elles seront rédigées par Claude Code au prochain passage.</p>
        )}
      </section>

      <section className="space-y-3">
        {retained.length ? (
          retained.map((coin) => <CoinCard key={coin.mint} coin={coin} />)
        ) : (
          <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">Aucun coin retenu ce jour-là.</p>
        )}
      </section>

      <section className="mt-5">
        <ExcludedBlock coins={excluded} />
      </section>
    </>
  );
}
