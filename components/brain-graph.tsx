"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type ForceGraphType from "force-graph";
import type { BrainCoin, BrainLink, BrainMeta } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Modèle du graphe
// ---------------------------------------------------------------------------

interface GNode {
  id: string;
  type: "coin" | "meta";
  label: string;
  /** Index de couleur (0–4) ou -1 = gris. La couleur suit la meta, jamais le rang du jour. */
  colorIdx: number;
  r: number;
  coin?: BrainCoin;
  meta?: BrainMeta;
  x?: number;
  y?: number;
}

interface GLink {
  source: string | GNode;
  target: string | GNode;
  type: "meta" | "coin";
  link?: BrainLink;
}

export const LINK_KIND_LABEL: Record<string, string> = {
  meme_dev: "Même équipe (même dev)",
  financement_commun: "Même équipe (même financeur)",
  copie: "Copie",
  meme_vague: "Même vague",
  catalyseur: "Même catalyseur",
  ecosysteme: "Même écosystème",
  narratif: "Même narratif",
  reponse: "Réponse / prolongement",
  celebrite: "Même célébrité",
  autre: "Lien",
};

const BROAD = new Set(["crypto-meta", "actualite", "culture-internet", "celebrite", "animal", "ia", "politique", "sport", "autre"]);

/** Meta « principale » d'un coin : la plus précise (sous-thème > thème précis > thème large > mécanique). */
function primaryMeta(c: BrainCoin): string | null {
  const rank = (m: BrainCoin["metas"][number]) =>
    m.kind === "mecanique" ? 3 : m.parent ? 0 : BROAD.has(m.slug) ? 2 : 1;
  return [...c.metas].sort((a, b) => rank(a) - rank(b))[0]?.slug ?? null;
}

const idOf = (end: string | GNode) => (typeof end === "string" ? end : end.id);

function buildGraph(coins: BrainCoin[], metas: BrainMeta[], links: BrainLink[]) {
  // Les 5 metas principales les plus fréquentes reçoivent une couleur ; les autres restent grises.
  const counts = new Map<string, number>();
  for (const c of coins) {
    const p = primaryMeta(c);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);
  const colorOf = (slug: string | null) => (slug ? top.indexOf(slug) : -1);

  const used = new Set(coins.flatMap((c) => c.metas.map((m) => m.slug)));
  const nodes: GNode[] = [
    ...metas
      .filter((m) => used.has(m.slug))
      .map((m) => ({ id: `meta:${m.slug}`, type: "meta" as const, label: m.label, colorIdx: colorOf(m.slug), r: 7, meta: m })),
    ...coins.map((c) => ({
      id: c.mint,
      type: "coin" as const,
      label: `$${c.symbol ?? "?"}`,
      colorIdx: colorOf(primaryMeta(c)),
      r: 3 + Math.max(0, Math.min(100, c.score ?? 40)) / 22,
      coin: c,
    })),
  ];
  const glinks: GLink[] = [
    ...coins.flatMap((c) => c.metas.map((m) => ({ source: c.mint, target: `meta:${m.slug}`, type: "meta" as const }))),
    ...links.map((l) => ({ source: l.a, target: l.b, type: "coin" as const, link: l })),
  ];
  return { nodes, links: glinks, top: top.map((s) => metas.find((m) => m.slug === s)?.label ?? s) };
}

// ---------------------------------------------------------------------------
// Couleurs (lues dans les variables CSS du thème clair/sombre)
// ---------------------------------------------------------------------------

interface Palette {
  series: string[];
  muted: string;
  line: string;
  fg: string;
  surface: string;
  accent: string;
  warn: string;
}

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim() || "#888888";
  return {
    series: [1, 2, 3, 4, 5].map((i) => v(`--series-${i}`)),
    muted: v("--muted"),
    line: v("--line"),
    fg: v("--foreground"),
    surface: v("--surface-2"),
    accent: v("--accent"),
    warn: v("--warn"),
  };
}

function alpha(hex: string, a: number) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------

export function BrainGraph({ coins, metas, links }: { coins: BrainCoin[]; metas: BrainMeta[]; links: BrainLink[] }) {
  const graph = useMemo(() => buildGraph(coins, metas, links), [coins, metas, links]);
  const boxRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphType<GNode, GLink> | null>(null);
  const selRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Voisins de chaque nœud (pour la mise en évidence et le panneau).
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of graph.links) {
      const a = idOf(l.source);
      const b = idOf(l.target);
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, [graph]);

  useEffect(() => {
    let disposed = false;
    let fg: ForceGraphType<GNode, GLink> | null = null;
    let palette = readPalette();
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onTheme = () => (palette = readPalette());
    media.addEventListener("change", onTheme);
    const box = boxRef.current!;
    const observer = new ResizeObserver(() => fg?.width(box.clientWidth).height(box.clientHeight));

    import("force-graph").then(({ default: ForceGraph }) => {
      if (disposed) return;
      const colorFor = (n: GNode) => (n.colorIdx >= 0 ? palette.series[n.colorIdx] : palette.muted);
      const isActive = (id: string) => {
        const sel = selRef.current;
        return !sel || id === sel || !!neighbors.get(sel)?.has(id);
      };
      const touchesSel = (l: GLink) => {
        const sel = selRef.current;
        return !!sel && (idOf(l.source) === sel || idOf(l.target) === sel);
      };

      fg = new ForceGraph<GNode, GLink>(box)
        .width(box.clientWidth)
        .height(box.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")
        .graphData({ nodes: graph.nodes.map((n) => ({ ...n })), links: graph.links.map((l) => ({ ...l })) })
        .nodeId("id")
        .nodeLabel(() => "")
        .nodeCanvasObject((node, ctx, scale) => {
          const active = isActive(node.id);
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          ctx.globalAlpha = active ? 1 : 0.15;
          ctx.beginPath();
          ctx.arc(x, y, node.r, 0, 2 * Math.PI);
          if (node.type === "meta") {
            ctx.fillStyle = palette.surface;
            ctx.fill();
            ctx.lineWidth = 2 / scale;
            ctx.strokeStyle = colorFor(node);
            ctx.setLineDash(node.meta?.kind === "mecanique" ? [3 / scale, 2 / scale] : []);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            ctx.fillStyle = colorFor(node);
            ctx.fill();
            if (node.id === selRef.current) {
              ctx.lineWidth = 2.5 / scale;
              ctx.strokeStyle = palette.fg;
              ctx.stroke();
            }
          }
          // Libellés : toujours pour les metas ; pour les coins dès qu'on zoome ou qu'ils sont liés à la sélection.
          const showLabel = node.type === "meta" || scale > 1.6 || (!!selRef.current && active);
          if (showLabel) {
            const size = (node.type === "meta" ? 12 : 10.5) / scale;
            ctx.font = `${node.type === "meta" ? "600 " : ""}${size}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = palette.fg;
            ctx.fillText(node.label, x, y + node.r + 2 / scale);
          }
          ctx.globalAlpha = 1;
        })
        .nodePointerAreaPaint((node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, node.r + 4, 0, 2 * Math.PI);
          ctx.fill();
        })
        .linkColor((l) => {
          const on = !selRef.current || touchesSel(l);
          if (l.type === "meta") return alpha(palette.muted, on ? 0.35 : 0.06);
          const k = l.link?.kind ?? "autre";
          const base = l.link?.source === "claude" ? palette.accent : k === "meme_dev" || k === "financement_commun" ? palette.warn : palette.fg;
          return alpha(base, on ? (k === "meme_vague" ? 0.45 : 0.85) : 0.08);
        })
        .linkWidth((l) => (l.type === "meta" ? 0.6 : 0.6 + (l.link?.strength ?? 1) * 0.6) * (touchesSel(l) ? 1.6 : 1))
        .linkLineDash((l) => (l.link?.kind === "meme_vague" ? [2, 2] : l.link?.kind === "copie" ? [5, 3] : null))
        .cooldownTicks(220)
        .onNodeClick((node) => select(node.id))
        .onBackgroundClick(() => select(null));

      fg.d3Force("charge")?.strength?.((n: GNode) => (n.type === "meta" ? -170 : -40));
      const linkForce = fg.d3Force("link") as unknown as { distance: (fn: (l: GLink) => number) => { strength: (fn: (l: GLink) => number) => void } };
      linkForce
        ?.distance((l) => (l.type === "meta" ? 42 : 22 + 12 * (3 - (l.link?.strength ?? 1))))
        .strength((l) => (l.type === "meta" ? 0.2 : 0.45));
      let fitted = false;
      fg.onEngineStop(() => {
        if (!fitted) {
          fitted = true;
          fg?.zoomToFit(500, 30);
        }
      });
      fgRef.current = fg;
      observer.observe(box);
    });

    return () => {
      disposed = true;
      media.removeEventListener("change", onTheme);
      observer.disconnect();
      fg?._destructor();
      fgRef.current = null;
    };
  }, [graph, neighbors]);

  function select(id: string | null) {
    selRef.current = id;
    setSelected(id);
    const fg = fgRef.current;
    if (!fg) return;
    const node = id ? fg.graphData().nodes.find((n) => n.id === id) : null;
    if (node && node.x != null && node.y != null) {
      fg.centerAt(node.x, node.y, 600);
      fg.zoom(Math.max(fg.zoom(), 2.2), 600);
    } else {
      fg.zoom(fg.zoom() * 0.999, 50); // redessine pour retirer la mise en évidence
    }
  }

  const sel = selected ? graph.nodes.find((n) => n.id === selected) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-2 flex gap-2">
          <input
            list="brain-coins"
            placeholder="Chercher un ticker…"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            onChange={(e) => {
              const hit = graph.nodes.find((n) => n.type === "coin" && n.label.toLowerCase() === e.target.value.trim().toLowerCase());
              if (hit) select(hit.id);
            }}
          />
          <datalist id="brain-coins">
            {graph.nodes.filter((n) => n.type === "coin").map((n) => (
              <option key={n.id} value={n.label}>{n.coin?.name ?? ""}</option>
            ))}
          </datalist>
          <button onClick={() => { select(null); fgRef.current?.zoomToFit(500, 30); }} className="rounded-lg border border-line px-3 text-sm text-muted">
            Vue d&apos;ensemble
          </button>
        </div>
        <div ref={boxRef} className="h-[58dvh] min-h-[360px] w-full touch-none overflow-hidden rounded-2xl border border-line bg-surface lg:h-[72dvh]" />
        <Legend top={graph.top} />
      </div>
      <aside className="lg:max-h-[78dvh] lg:overflow-y-auto">
        {sel ? (
          sel.type === "coin" ? (
            <CoinPanel node={sel} links={links} coins={coins} onSelect={select} />
          ) : (
            <MetaPanel node={sel} coins={coins} onSelect={select} />
          )
        ) : (
          <p className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
            Touche un point pour voir pourquoi le coin a marché et pourquoi il est relié aux autres. Les gros cercles sont les
            metas (catégories) ; touche-les pour voir leurs coins. Pince ou fais défiler pour zoomer.
          </p>
        )}
      </aside>
    </div>
  );
}

function Legend({ top }: { top: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {top.map((label, i) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${i + 1})` }} />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted" /> autres metas
      </span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-accent" /> lien de sens (Claude)</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-warn" /> même équipe</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-foreground/70" /> copie / même vague</span>
    </div>
  );
}

function CoinPanel({ node, links, coins, onSelect }: { node: GNode; links: BrainLink[]; coins: BrainCoin[]; onSelect: (id: string) => void }) {
  const c = node.coin!;
  const mine = links
    .filter((l) => l.a === c.mint || l.b === c.mint)
    .map((l) => ({ ...l, other: coins.find((x) => x.mint === (l.a === c.mint ? l.b : l.a)) }))
    .filter((l) => l.other)
    .sort((x, y) => y.strength - x.strength || (x.source === "claude" ? -1 : 1));
  return (
    <article className="space-y-4 rounded-2xl border border-line bg-surface p-4 text-sm">
      <header>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">
            {c.name ?? "Sans nom"} <span className="font-mono text-xs text-muted">${c.symbol}</span>
          </h2>
          {c.score != null && <span className="tabular text-lg font-semibold text-accent">{c.score}</span>}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          Journal du{" "}
          <Link className="text-info" href={`/journal/${c.journal_date}`}>
            {new Date(`${c.journal_date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}
          </Link>
          {c.ath_mult ? ` · ATH ×${c.ath_mult.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}` : ""}
          {c.tags.length ? ` · ${c.tags.join(", ")}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {c.metas.map((m) => (
            <button key={m.slug} onClick={() => onSelect(`meta:${m.slug}`)} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              {m.label}
            </button>
          ))}
        </div>
      </header>

      <section>
        <h3 className="font-medium">Pourquoi il a marché</h3>
        {c.pourquoi ? (
          <p className="mt-1 leading-relaxed text-muted">{c.pourquoi}</p>
        ) : (
          <p className="mt-1 text-xs text-warn">Fiche en attente : elle sera rédigée au prochain passage.</p>
        )}
        {c.catalyseur && (
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            <span className="font-medium text-foreground">Catalyseur : </span>
            {c.catalyseur.resume}
          </p>
        )}
      </section>

      <section>
        <h3 className="font-medium">Liens avec d&apos;autres coins retenus ({mine.length})</h3>
        {mine.length ? (
          <ul className="mt-2 space-y-2">
            {mine.map((l, i) => (
              <li key={i} className="rounded-xl bg-surface-2 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <button onClick={() => onSelect(l.other!.mint)} className="font-medium text-info">
                    ${l.other!.symbol} <span className="text-xs font-normal text-muted">{l.other!.name}</span>
                  </button>
                  <span className="shrink-0 text-[11px] text-muted">{LINK_KIND_LABEL[l.kind] ?? l.kind}</span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{l.explanation}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted">
                  {l.source === "claude" ? "analyse Claude" : "donnée on-chain / calcul"} · force {"●".repeat(l.strength)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted">Aucun lien trouvé pour l&apos;instant avec les autres coins retenus.</p>
        )}
      </section>
    </article>
  );
}

function MetaPanel({ node, coins, onSelect }: { node: GNode; coins: BrainCoin[]; onSelect: (id: string) => void }) {
  const m = node.meta!;
  const members = coins.filter((c) => c.metas.some((x) => x.slug === m.slug));
  const rate = m.bonded ? (100 * m.retained_hist) / m.bonded : null;
  return (
    <article className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-sm">
      <header>
        <h2 className="text-base font-semibold">{m.label}</h2>
        <p className="text-xs text-muted">{m.kind === "mecanique" ? "Mécanique" : "Thème"}{m.description ? ` · ${m.description}` : ""}</p>
      </header>
      <p className="tabular text-[13px] text-muted">
        Depuis le début : {m.bonded.toLocaleString("fr-FR")} coins bondés, {m.alive.toLocaleString("fr-FR")} encore vivants 24 h après,{" "}
        {m.retained_hist} retenus{rate != null ? ` (${rate.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %)` : ""}.
      </p>
      <section>
        <h3 className="font-medium">Coins retenus de cette meta ({members.length})</h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {members.map((c) => (
            <li key={c.mint}>
              <button onClick={() => onSelect(c.mint)} className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] text-info">
                ${c.symbol}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
