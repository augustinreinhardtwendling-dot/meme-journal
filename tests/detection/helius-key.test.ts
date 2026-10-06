import { describe, expect, it } from "vitest";
import { normalizeHeliusKey } from "../../pipeline/sources/helius";

describe("clé Helius", () => {
  const key = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
  it("garde une clé propre", () => expect(normalizeHeliusKey(key)).toBe(key));
  it("retire espaces et retours à la ligne", () => expect(normalizeHeliusKey(` ${key}\n`)).toBe(key));
  it("extrait la clé d'une URL RPC collée en entier", () =>
    expect(normalizeHeliusKey(`https://mainnet.helius-rpc.com/?api-key=${key}`)).toBe(key));
  it("retire des guillemets", () => expect(normalizeHeliusKey(`"${key}"`)).toBe(key));
});
