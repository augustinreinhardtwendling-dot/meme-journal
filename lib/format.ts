// Formats d'affichage (français).

export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Md$`;
  if (abs >= 1e6) return `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M$`;
  if (abs >= 1e3) return `${(n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k$`;
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
}

export function multiple(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `×${n.toLocaleString("fr-FR", { maximumFractionDigits: n >= 10 ? 0 : 1 })}`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;
  return `${(seconds / 86400).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j`;
}

export function dateLong(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
}

export function shortAddress(a: string | null | undefined): string {
  if (!a) return "—";
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/** URL X/Twitter propre à partir d'un handle ou d'une URL. */
export function xUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^https?:\/\//.test(v)) return v;
  return `https://x.com/${v.replace(/^@/, "")}`;
}

/** Passerelle IPFS plus rapide pour les images. */
export function imageUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const cid = u.match(/\/ipfs\/(.+)$/)?.[1];
  return cid ? `https://pump.mypinata.cloud/ipfs/${cid}` : u;
}
