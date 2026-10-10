import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../lib/config";
import { judgeCriterion } from "../../lib/detection/judge";
import { associatedTokenAddress, TOKEN_2022_PROGRAM } from "../../lib/solana";
import { emptyMetrics } from "../../lib/types";

const extra = { bondingSeconds: 3600, prebondTxCount: 900 };

describe("snipers : part encore détenue", () => {
  it("n'exclut pas des snipers qui ont revendu", () => {
    const m = { ...emptyMetrics(), snipers_pct: 46.7, snipers_held_pct: 2.1 };
    expect(judgeCriterion("snipers", m, extra, defaultConfig)).toBeNull();
  });

  it("exclut des snipers qui détiennent encore plus de 15 %", () => {
    const m = { ...emptyMetrics(), snipers_pct: 40, snipers_held_pct: 22.5 };
    const r = judgeCriterion("snipers", m, extra, defaultConfig);
    expect(r?.code).toBe("snipers");
    expect(r?.detail).toContain("détiennent encore");
  });

  it("se rabat sur la part achetée pour les anciens journaux sans mesure", () => {
    const m = { ...emptyMetrics(), snipers_pct: 30 };
    expect(judgeCriterion("snipers", m, extra, defaultConfig)?.code).toBe("snipers");
  });

  it("dérive le bon compte de token associé (cas réel PumpSwap, Token-2022)", () => {
    expect(
      associatedTokenAddress("EyQd3XPWhsuy49JXgaVXxuiUebfeq1XrjL7gKTVbAnZA", "ASYY2YVsKmhWMSLDQVzVsXb8s5thY3a5YdtgDeLupump", TOKEN_2022_PROGRAM),
    ).toBe("7cSiEEgC2o7grDSrtMtcSa9aUgTwvDjy6RqPMgv4hzGv");
  });
});

describe("wash trading : seuil 15", () => {
  it("laisse passer un coin très actif à 8 tx par wallet", () => {
    const m = { ...emptyMetrics(), wash_tx_per_wallet: 8.0, wash_roundtrip_share: 0.2 };
    expect(judgeCriterion("wash_trading", m, extra, defaultConfig)).toBeNull();
  });
  it("exclut une ferme à 24 tx par wallet", () => {
    const m = { ...emptyMetrics(), wash_tx_per_wallet: 24.1 };
    expect(judgeCriterion("wash_trading", m, extra, defaultConfig)?.code).toBe("wash_trading");
  });
});
