import { describe, expect, it } from "vitest";
import { detectInsiders } from "../../lib/detection/insiders";
import type { FundingEdge } from "../../lib/types";
import { trade } from "./helpers";

const SUPPLY = 1_000_000_000;
const base = { devWallets: new Set(["DEV"]), supply: SUPPLY, hubs: new Set<string>(), minCluster: 3 };
const fund = (wallet: string, funder: string | null): FundingEdge => ({ wallet, funder, fundedAt: 1, amountSol: 1 });

describe("insiders", () => {
  it("rattache au dev les wallets qu'il a financés", () => {
    const trades = [
      trade({ wallet: "DEV", slot: 1000, tokens: 30_000_000 }),
      trade({ wallet: "W1", slot: 1001, tokens: 60_000_000 }),
      trade({ wallet: "W2", slot: 1002, tokens: 70_000_000 }),
      trade({ wallet: "RANDOM", slot: 1003, tokens: 100_000_000 }),
    ];
    const r = detectInsiders(trades, [fund("W1", "DEV"), fund("W2", "DEV"), fund("RANDOM", "OTHER")], base);
    expect(r.devClusterPct).toBeCloseTo(16);
    expect(r.wallets.sort()).toEqual(["DEV", "W1", "W2"]);
  });

  it("relie le dev et un wallet financés par la même source", () => {
    const trades = [trade({ wallet: "DEV", slot: 1000, tokens: 10_000_000 }), trade({ wallet: "W1", slot: 1001, tokens: 150_000_000 })];
    const r = detectInsiders(trades, [fund("DEV", "SRC"), fund("W1", "SRC")], base);
    expect(r.pct).toBeCloseTo(16);
  });

  it("ne crée pas de lien via une plateforme (hub)", () => {
    const trades = [trade({ wallet: "DEV", slot: 1000, tokens: 10_000_000 }), trade({ wallet: "W1", slot: 1001, tokens: 150_000_000 })];
    const r = detectInsiders(trades, [fund("DEV", "BINANCE"), fund("W1", "BINANCE")], { ...base, hubs: new Set(["BINANCE"]) });
    expect(r.pct).toBeCloseTo(1);
    expect(r.wallets).toEqual(["DEV"]);
  });

  it("compte un groupe coordonné hors dev à partir de 3 wallets", () => {
    const trades = ["A", "B", "C"].map((w, i) => trade({ wallet: w, slot: 1001 + i, tokens: 50_000_000 }));
    const r = detectInsiders(trades, ["A", "B", "C"].map((w) => fund(w, "SRC")), base);
    expect(r.pct).toBeCloseTo(15);
    expect(r.clusters[0].funder).toBe("SRC");
  });

  it("ignore un groupe de 2 wallets hors dev", () => {
    const trades = ["A", "B"].map((w, i) => trade({ wallet: w, slot: 1001 + i, tokens: 80_000_000 }));
    const r = detectInsiders(trades, ["A", "B"].map((w) => fund(w, "SRC")), base);
    expect(r.pct).toBe(0);
  });

  it("suit une chaîne de financement (dev → W1 → W2)", () => {
    const trades = [trade({ wallet: "W2", slot: 1001, tokens: 200_000_000 })];
    const r = detectInsiders(trades, [fund("W1", "DEV"), fund("W2", "W1")], base);
    expect(r.devClusterPct).toBeCloseTo(20);
  });
});
