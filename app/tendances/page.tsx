import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { TrendsChart } from "@/components/trends-chart";
import { num, pct } from "@/lib/format";
import { metaStats, type MetaDayStat } from "@/lib/queries";

const TREND = { hausse: "↗ hausse", baisse: "↘ baisse", stable: "→ stable" } as Record<string, string>;

interface Agg {
  meta: string;
  label: string;
  kind: string;
  bonded: number;
  alive: number;
  retained: number;
  runners: number;
  trend: string | null;
  saturated: boolean;
}

function aggregate(rows: MetaDayStat[], fromDay: string): Agg[] {
  const m = new Map<string, Agg>();
  const lastDay = rows.at(-1)?.day;
  for (const r of rows) {
    if (r.day < fromDay) continue;
    const a = m.get(r.meta) ?? { meta: r.meta, label: r.label, kind: r.kind, bonded: 0, alive: 0, retained: 0, runners: 0, trend: null, saturated: false };
    a.bonded += r.bonded;
    a.alive += r.survived_a;
    a.retained += r.retained;
    a.runners += r.runners;
    if (r.day === lastDay) {
      a.trend = r.volume_trend;
      a.saturated = r.saturated;
    }
    m.set(r.meta, a);
  }
  return [...m.values()].sort((x, y) => y.bonded - x.bonded);
}

function MetaTable({ title, rows }: { title: string; rows: Agg[] }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 font-medium">{title}</h2>
      <div className="-mx-1 overflow-x-auto">
        <table className="tabular w-full min-w-[480px] text-[13px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-1 py-1.5 font-normal">Meta</th>
              <th className="px-1 py-1.5 text-right font-normal">Bondés</th>
              <th className="px-1 py-1.5 text-right font-normal">Vivants</th>
              <th className="px-1 py-1.5 text-right font-normal">Retenus</th>
              <th className="px-1 py-1.5 text-right font-normal">Réussite</th>
              <th className="px-1 py-1.5 font-normal">Lancements</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.meta}>
                <td className="px-1 py-1.5">
                  {r.label}
                  {r.kind === "mecanique" && <span className="text-muted"> · mécanique</span>}
                  {r.saturated && <span className="ml-1 rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">saturée</span>}
                </td>
                <td className="whitespace-nowrap px-1 py-1.5 text-right">{num(r.bonded)}</td>
                <td className="whitespace-nowrap px-1 py-1.5 text-right">{num(r.alive)} <span className="text-muted">({pct(r.bonded ? (100 * r.alive) / r.bonded : null, 1)})</span></td>
                <td className="whitespace-nowrap px-1 py-1.5 text-right">{num(r.retained)}{r.runners ? <span className="text-muted"> · {r.runners} R</span> : null}</td>
                <td className="whitespace-nowrap px-1 py-1.5 text-right">{pct(r.bonded ? (100 * r.retained) / r.bonded : null, 1)}</td>
                <td className="px-1 py-1.5 text-muted">{r.trend ? TREND[r.trend] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function TrendsPage() {
  await connection();
  const rows = await metaStats(30);
  const days = [...new Set(rows.map((r) => r.day))].sort();

  if (!days.length) {
    return (
      <AppShell active="/tendances">
        <h1 className="mb-3 text-xl font-semibold">Tendances</h1>
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
          Pas encore de statistiques : elles apparaissent après le premier classement des metas par Claude Code.
        </p>
      </AppShell>
    );
  }

  const last7 = days[Math.max(0, days.length - 7)];
  const agg30 = aggregate(rows, days[0]);
  const agg7 = aggregate(rows, last7);
  // Les 5 thèmes les plus lancés sur la période (hors « autre ») ; couleur attachée à la meta, pas au rang du jour.
  const top = agg30.filter((a) => a.kind === "theme" && a.meta !== "autre").slice(0, 5);
  const data = days.map((d) => {
    const point: Record<string, number | string> = { day: d };
    for (const t of top) point[t.meta] = rows.find((r) => r.day === d && r.meta === t.meta)?.bonded ?? 0;
    return point;
  });

  return (
    <AppShell active="/tendances">
      <h1 className="mb-1 text-xl font-semibold">Tendances</h1>
      <p className="mb-4 text-xs text-muted">
        {days.length} jour{days.length > 1 ? "s" : ""} de données · « Vivants » = encore au-dessus de la mcap de migration avec plus de
        50 k$ de volume 24 h après · « Réussite » = retenus / bondés.
      </p>

      <section className="mb-5 rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-2 font-medium">Coins bondés par jour — les 5 thèmes les plus lancés</h2>
        <TrendsChart data={data} series={top.map((t) => ({ key: t.meta, label: t.label }))} />
      </section>

      <MetaTable title="7 derniers jours" rows={agg7} />
      <MetaTable title={`${days.length} derniers jours`} rows={agg30} />
    </AppShell>
  );
}
