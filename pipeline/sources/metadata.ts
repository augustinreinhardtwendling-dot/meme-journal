// Métadonnées des coins : nom/ticker/URI on-chain (Token-2022 ou Metaplex), puis JSON hébergé sur IPFS.
import { metaplexMetadataPda, TOKEN_2022_PROGRAM } from "../../lib/solana";
import type { CreditMeter, Helius } from "./helius";

export interface CoinMetadata {
  name: string | null;
  symbol: string | null;
  uri: string | null;
  tokenProgram: "spl-token" | "token-2022" | null;
  description: string | null;
  image: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
}

type ParsedMint = {
  owner: string;
  data: { parsed?: { info?: { extensions?: { extension: string; state: { name?: string; symbol?: string; uri?: string } }[] } } } | [string, string];
};

const clean = (s: string | undefined | null) => (s ? s.replace(/\0/g, "").trim() || null : null);

/** Décode name/symbol/uri d'un compte Metaplex (borsh). */
function decodeMetaplex(b64: string) {
  const buf = Buffer.from(b64, "base64");
  let o = 1 + 32 + 32;
  const str = () => {
    const len = buf.readUInt32LE(o);
    o += 4;
    const s = buf.subarray(o, o + len).toString("utf8");
    o += len;
    return clean(s);
  };
  return { name: str(), symbol: str(), uri: str() };
}

export async function onchainMetadata(helius: Helius, mints: string[], meter?: CreditMeter) {
  const out = new Map<string, Pick<CoinMetadata, "name" | "symbol" | "uri" | "tokenProgram">>();
  const accounts = await helius.getMultipleAccounts<ParsedMint>(mints, "jsonParsed", meter);
  const legacy: string[] = [];
  mints.forEach((mint, i) => {
    const acc = accounts[i];
    if (!acc) return;
    if (acc.owner === TOKEN_2022_PROGRAM && !Array.isArray(acc.data)) {
      const ext = acc.data.parsed?.info?.extensions?.find((e) => e.extension === "tokenMetadata");
      if (ext) {
        out.set(mint, { name: clean(ext.state.name), symbol: clean(ext.state.symbol), uri: clean(ext.state.uri), tokenProgram: "token-2022" });
        return;
      }
    }
    legacy.push(mint);
  });
  if (legacy.length) {
    const pdas = legacy.map(metaplexMetadataPda);
    const metas = await helius.getMultipleAccounts<{ data: [string, string] }>(pdas, "base64", meter);
    legacy.forEach((mint, i) => {
      const m = metas[i];
      if (!m) return;
      try {
        out.set(mint, { ...decodeMetaplex(m.data[0]), tokenProgram: "spl-token" });
      } catch {
        /* compte illisible : on laisse vide */
      }
    });
  }
  return out;
}

// Ordre testé le 6/10/2026 : la passerelle de pump.fun et 4everland répondent vite ; ipfs.io et dweb.link
// limitent fortement les rafales de requêtes.
const GATEWAYS = [
  "https://pump.mypinata.cloud/ipfs/",
  "https://4everland.io/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

function candidates(uri: string): string[] {
  const cid = uri.match(/\/ipfs\/([^/?#]+.*)$/)?.[1] ?? uri.match(/^ipfs:\/\/(.+)$/)?.[1];
  if (!cid) return [uri];
  return GATEWAYS.map((g) => g + cid);
}

async function fetchJson(uri: string): Promise<Record<string, unknown> | null> {
  for (const url of candidates(uri)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      /* passerelle suivante */
    }
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Récupère le JSON de métadonnées de chaque URI (8 en parallèle). */
export async function offchainMetadata(uris: Map<string, string>) {
  const out = new Map<string, Pick<CoinMetadata, "description" | "image" | "twitter" | "telegram" | "website">>();
  const entries = [...uris];
  let i = 0;
  async function worker() {
    while (i < entries.length) {
      const [mint, uri] = entries[i++];
      const j = await fetchJson(uri);
      if (!j) continue;
      const ext = (j.extensions ?? {}) as Record<string, unknown>;
      out.set(mint, {
        description: str(j.description)?.slice(0, 1500) ?? null,
        image: str(j.image),
        twitter: str(j.twitter) ?? str(ext.twitter),
        telegram: str(j.telegram) ?? str(ext.telegram),
        website: str(j.website) ?? str(ext.website),
      });
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}
