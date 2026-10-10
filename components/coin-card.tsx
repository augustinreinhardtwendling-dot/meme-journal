import { coinLinks } from "@/lib/solana";
import { duration, imageUrl, multiple, num, pct, usd, xUrl } from "@/lib/format";
import type { RetainedCoin } from "@/lib/queries";
import { FicheView, RerunVerdict } from "./fiche-view";

function Avatar({ src, label }: { src: string | null; label: string }) {
  const url = imageUrl(src);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- images IPFS externes, pas d'optimiseur Vercel (quota Hobby)
    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-xl bg-surface-2 object-cover" />
  ) : (
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface-2 text-sm font-semibold text-muted">
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "accent" | "warn" | "info" | "muted" }) {
  const tones = {
    accent: "bg-accent/15 text-accent",
    warn: "bg-warn/15 text-warn",
    info: "bg-info/15 text-info",
    muted: "bg-surface-2 text-muted",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="tabular truncate text-sm font-medium">{value}</div>
      {sub && <div className="tabular text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function scoreTone(score: number | null) {
  if (score == null) return "text-muted";
  if (score >= 70) return "text-accent";
  if (score >= 50) return "text-info";
  return "text-warn";
}

export function CoinCard({ coin }: { coin: RetainedCoin }) {
  const links = coinLinks(coin.mint);
  const mig = coin.migration_mcap_usd;
  const athMult = mig && coin.ath_mcap_usd ? coin.ath_mcap_usd / mig : null;
  const nowMult = mig && coin.mcap_usd ? coin.mcap_usd / mig : null;
  const x = xUrl(coin.twitter);

  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <header className="flex items-start gap-3">
        <Avatar src={coin.image_url} label={coin.symbol ?? coin.name ?? "?"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-base font-semibold">{coin.name ?? "Sans nom"}</h3>
            <span className="shrink-0 font-mono text-xs text-muted">${coin.symbol}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {coin.tags.includes("Runner") && <Tag tone="accent">Runner</Tag>}
            {coin.tags.includes("CTO") && <Tag tone="info">CTO</Tag>}
            {(coin.metas ?? []).map((m) => (
              <Tag key={m}>{m}</Tag>
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className={`tabular text-2xl font-semibold leading-none ${scoreTone(coin.score)}`}>{coin.score ?? "—"}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-muted">score</div>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-surface-2 p-3">
        <Stat label="Migration" value={usd(mig)} sub={coin.bonding_seconds != null ? `bondé en ${duration(coin.bonding_seconds)}` : undefined} />
        <Stat label="ATH" value={usd(coin.ath_mcap_usd)} sub={multiple(athMult)} />
        <Stat label="Actuelle" value={usd(coin.mcap_usd)} sub={multiple(nowMult)} />
      </div>

      <dl className="tabular mt-3 grid grid-cols-4 gap-2 text-[12px]">
        <div><dt className="text-muted">Holders</dt><dd>{num(coin.holders)}</dd></div>
        <div><dt className="text-muted">Top 10</dt><dd>{pct(coin.top10_pct, 0)}</dd></div>
        <div><dt className="text-muted">Vol. 24 h</dt><dd>{usd(coin.volume_24h_usd)}</dd></div>
        <div><dt className="text-muted">Liquidité</dt><dd>{usd(coin.liquidity_usd)}</dd></div>
      </dl>

      {coin.fiche ? (
        <>
          <RerunVerdict fiche={coin.fiche} />
          <FicheView fiche={coin.fiche} />
        </>
      ) : (
        <>
          {coin.description && <p className="mt-3 line-clamp-3 text-sm text-muted">{coin.description}</p>}
          <p className="mt-2 text-xs text-warn">Fiche en attente : rédigée par Claude Code au prochain passage.</p>
        </>
      )}

      <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <a className="text-info" href={links.pumpfun} target="_blank" rel="noreferrer">pump.fun</a>
        <a className="text-info" href={links.dexscreener} target="_blank" rel="noreferrer">DexScreener</a>
        <a className="text-info" href={links.solscan} target="_blank" rel="noreferrer">Solscan</a>
        {x && <a className="text-info" href={x} target="_blank" rel="noreferrer">X</a>}
        {coin.telegram && <a className="text-info" href={coin.telegram} target="_blank" rel="noreferrer">Telegram</a>}
      </nav>
    </article>
  );
}
