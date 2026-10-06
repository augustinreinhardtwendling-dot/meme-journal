import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../lib/config";
import { serialDevMetrics, top10Share, washMetrics } from "../../lib/detection/distribution";
import { judgeCriterion, judgeStageA } from "../../lib/detection/judge";
import { emptyMetrics } from "../../lib/types";

describe("tri A", () => {
  const mig = 39_000;
  it("garde un coin au-dessus de sa mcap de migration avec du volume", () => {
    expect(judgeStageA({ migrationMcapUsd: mig, mcapUsd: 120_000, volume24hUsd: 80_000 }, defaultConfig)).toBeNull();
  });
  it("classe mort un coin repassé sous sa mcap de migration", () => {
    expect(judgeStageA({ migrationMcapUsd: mig, mcapUsd: 20_000, volume24hUsd: 500_000 }, defaultConfig)?.code).toBe("dead_after_bond");
  });
  it("classe mort un coin sans volume", () => {
    expect(judgeStageA({ migrationMcapUsd: mig, mcapUsd: 90_000, volume24hUsd: 12_000 }, defaultConfig)?.code).toBe("dead_after_bond");
  });
  it("classe mort un coin qui n'est plus coté", () => {
    expect(judgeStageA({ migrationMcapUsd: mig, mcapUsd: null, volume24hUsd: null }, defaultConfig)?.code).toBe("dead_after_bond");
  });
});

describe("concentration", () => {
  it("ignore la pool et les comptes de programme, additionne les comptes d'un même wallet", () => {
    const r = top10Share(
      [
        { owner: "POOL", amount: 200_000_000 },
        { owner: "W1", amount: 50_000_000 },
        { owner: "W1", amount: 30_000_000 },
        { owner: "W2", amount: 40_000_000 },
        { owner: "PDA", amount: 100_000_000 },
      ],
      1_000_000_000,
      (o) => o === "POOL" || o === "PDA",
    );
    expect(r.pct).toBeCloseTo(12);
    expect(r.holders[0]).toEqual({ owner: "W1", pct: 8 });
  });
});

describe("wash trading", () => {
  it("repère beaucoup de transactions pour peu de wallets", () => {
    const w = washMetrics({ buys: 3400, sells: 3400, buyers: 12, sellers: 9 }, []);
    expect(w.txPerWallet).toBeGreaterThan(500);
    const m = { ...emptyMetrics(), wash_tx_per_wallet: w.txPerWallet };
    expect(judgeCriterion("wash_trading", m, { bondingSeconds: null, prebondTxCount: null }, defaultConfig)?.code).toBe("wash_trading");
  });

  it("mesure la part du volume faite par des wallets qui achètent et revendent en boucle", () => {
    const trades = [
      ...Array.from({ length: 10 }, (_, i) => ({ wallet: "BOT", kind: (i % 2 ? "sell" : "buy") as "buy" | "sell", volumeUsd: 100 })),
      ...Array.from({ length: 10 }, (_, i) => ({ wallet: `H${i}`, kind: "buy" as const, volumeUsd: 100 })),
    ];
    const w = washMetrics(null, trades);
    expect(w.roundtripShare).toBeCloseTo(0.5);
    expect(w.loopers).toEqual(["BOT"]);
  });

  it("ne conclut rien sur un trop petit échantillon", () => {
    expect(washMetrics(null, [{ wallet: "A", kind: "buy", volumeUsd: 10 }]).roundtripShare).toBeNull();
  });
});

describe("dev récidiviste", () => {
  const now = 1_790_000_000;
  it("compte les lancements des 30 derniers jours et la part de morts", () => {
    const launches = [
      ...Array.from({ length: 7 }, (_, i) => ({ mint: `m${i}`, createdAt: now - i * 86400, alive: i === 0 })),
      { mint: "old", createdAt: now - 40 * 86400, alive: false },
    ];
    const s = serialDevMetrics(launches, now);
    expect(s.launches).toBe(7);
    expect(s.dead).toBe(6);
    const m = { ...emptyMetrics(), dev_launches_30d: s.launches, dev_dead_30d: s.dead };
    expect(judgeCriterion("serial_dev", m, { bondingSeconds: null, prebondTxCount: null }, defaultConfig)?.code).toBe("serial_dev");
  });
});
