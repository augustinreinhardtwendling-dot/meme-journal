import { coinLinks } from "@/lib/solana";
import { num, usd } from "@/lib/format";
import type { ExcludedCoin } from "@/lib/queries";
import { REASON_LABELS, type ReasonCode } from "@/lib/types";

const ORDER: ReasonCode[] = [
  "dead_after_bond", "ghost_bond", "min_holders", "wash_trading", "concentration", "fast_bond",
  "bundle", "snipers", "insiders", "dev_sell", "serial_dev", "not_analyzed",
];
const SHOWN_PER_REASON = 150;

/** Bloc repliable : compteur par raison, puis le détail de chaque coin écarté. */
export function ExcludedBlock({ coins }: { coins: ExcludedCoin[] }) {
  const groups = new Map<ReasonCode, ExcludedCoin[]>();
  for (const c of coins) {
    const code = (c.reasons[0]?.code ?? "not_analyzed") as ReasonCode;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)!.push(c);
  }
  const ordered = ORDER.filter((c) => groups.has(c));
  if (!coins.length) return null;

  return (
    <details className="rounded-2xl border border-line bg-surface">
      <summary className="flex items-center justify-between p-4">
        <span className="font-medium">Exclus <span className="tabular text-muted">({num(coins.length)})</span></span>
        <span className="text-xs text-muted">afficher</span>
      </summary>
      <div className="border-t border-line px-4 pb-4 pt-3">
        <ul className="mb-3 flex flex-wrap gap-1.5 text-[12px]">
          {ordered.map((code) => (
            <li key={code} className="tabular rounded-full bg-surface-2 px-2.5 py-1">
              {num(groups.get(code)!.length)} {REASON_LABELS[code].toLowerCase()}
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          {ordered.map((code) => {
            const list = groups.get(code)!;
            return (
              <details key={code} className="rounded-xl bg-surface-2">
                <summary className="flex justify-between px-3 py-2 text-sm">
                  <span>{REASON_LABELS[code]}</span>
                  <span className="tabular text-muted">{num(list.length)}</span>
                </summary>
                <ul className="divide-y divide-line px-3 pb-2 text-[13px]">
                  {list.slice(0, SHOWN_PER_REASON).map((c) => (
                    <li key={c.mint} className="py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <a href={coinLinks(c.mint).dexscreener} target="_blank" rel="noreferrer" className="truncate font-medium">
                          {c.name ?? "Sans nom"} <span className="font-mono text-xs text-muted">${c.symbol}</span>
                        </a>
                        <span className="tabular shrink-0 text-xs text-muted">{usd(c.mcap_usd)}</span>
                      </div>
                      {c.reasons.map((r, i) => (
                        <p key={i} className="text-xs text-muted">{r.detail ?? r.label}</p>
                      ))}
                    </li>
                  ))}
                  {list.length > SHOWN_PER_REASON && (
                    <li className="py-2 text-xs text-muted">… et {num(list.length - SHOWN_PER_REASON)} autres</li>
                  )}
                </ul>
              </details>
            );
          })}
        </div>
      </div>
    </details>
  );
}
