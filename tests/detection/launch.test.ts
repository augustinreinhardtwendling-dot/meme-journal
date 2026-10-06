import { describe, expect, it } from "vitest";
import { detectBundle, detectSnipers } from "../../lib/detection/launch";
import { trade } from "./helpers";

const SUPPLY = 1_000_000_000;
const ctx = { createSlot: 1000, createTime: 1_790_000_000, devWallets: new Set(["DEV"]), supply: SUPPLY };

describe("bundle", () => {
  it("additionne les achats hors dev du bloc de création", () => {
    const trades = [
      trade({ wallet: "DEV", slot: 1000, tokens: 50_000_000 }),
      trade({ wallet: "B1", slot: 1000, tokens: 40_000_000 }),
      trade({ wallet: "B2", slot: 1000, tokens: 40_000_000 }),
      trade({ wallet: "B3", slot: 1000, tokens: 30_000_000 }),
      trade({ wallet: "LATER", slot: 1001, tokens: 90_000_000 }),
    ];
    const r = detectBundle(trades, ctx);
    expect(r.pct).toBeCloseTo(11);
    expect(r.wallets.map((w) => w.wallet)).toEqual(["B1", "B2", "B3"]);
  });

  it("additionne plusieurs achats d'un même wallet", () => {
    const r = detectBundle(
      [trade({ wallet: "B1", slot: 1000, tokens: 30_000_000 }), trade({ wallet: "B1", slot: 1000, tokens: 30_000_000 })],
      ctx,
    );
    expect(r.wallets).toHaveLength(1);
    expect(r.pct).toBeCloseTo(6);
  });

  it("ignore les ventes et les blocs suivants", () => {
    const r = detectBundle(
      [trade({ wallet: "S", slot: 1000, tokens: 80_000_000, side: "sell" }), trade({ wallet: "X", slot: 1002, tokens: 80_000_000 })],
      ctx,
    );
    expect(r.pct).toBe(0);
  });

  it("ne compte pas le dev ni ses wallets assimilés", () => {
    const r = detectBundle([trade({ wallet: "DEV2", slot: 1000, tokens: 200_000_000 })], { ...ctx, devWallets: new Set(["DEV", "DEV2"]) });
    expect(r.pct).toBe(0);
  });
});

describe("snipers", () => {
  it("compte les achats des 5 premières secondes (≈ 12 slots), bloc de création inclus", () => {
    const trades = [
      trade({ wallet: "A", slot: 1000, tokens: 50_000_000 }),
      trade({ wallet: "B", slot: 1012, tokens: 60_000_000 }),
      trade({ wallet: "C", slot: 1013, tokens: 70_000_000 }),
      trade({ wallet: "DEV", slot: 1001, tokens: 100_000_000 }),
    ];
    const r = detectSnipers(trades, ctx, 5);
    expect(r.untilSlot).toBe(1012);
    expect(r.pct).toBeCloseTo(11);
  });
});
