import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../lib/config";
import { analyzeDevSell } from "../../lib/detection/devsell";
import { isCto, judgeCriterion } from "../../lib/detection/judge";
import { emptyMetrics } from "../../lib/types";

const T = 1_790_000_000;
const prices = [
  { time: T - 600, price: 1.0 },
  { time: T - 60, price: 1.0 },
  { time: T + 60, price: 0.7 },
  { time: T + 600, price: 0.45 },
  { time: T + 3000, price: 0.5 },
  { time: T + 9000, price: 0.2 }, // hors fenêtre d'impact (60 min)
];
const extra = { bondingSeconds: 3600, prebondTxCount: 500 };

describe("dev sell", () => {
  it("mesure la part vendue et la chute dans l'heure qui suit la plus grosse vague", () => {
    const r = analyzeDevSell(
      [
        { wallet: "DEV", acquired: 100, sells: [{ time: T, tokens: 60 }, { time: T + 120, tokens: 20 }] },
        { wallet: "W1", acquired: 100, sells: [] },
      ],
      prices,
      { impactMinutes: 60, currentPrice: 0.9 },
    );
    expect(r.soldPct).toBeCloseTo(40);
    expect(r.dropPct).toBeCloseTo(55);
    expect(r.lowAfterDump).toBeCloseTo(0.45);
    expect(r.recoveryMultiple).toBeCloseTo(2);
  });

  it("aucune vente → rien à signaler", () => {
    const r = analyzeDevSell([{ wallet: "DEV", acquired: 100, sells: [] }], prices, { impactMinutes: 60, currentPrice: 1 });
    expect(r.soldPct).toBe(0);
    expect(r.dropPct).toBeNull();
  });

  it("exclut quand le dev a vendu ≥ 50 % et que le prix a chuté de ≥ 40 %", () => {
    const m = { ...emptyMetrics(), dev_sold_pct: 80, dev_sell_drop_pct: 55 };
    expect(judgeCriterion("dev_sell", m, extra, defaultConfig)?.code).toBe("dev_sell");
  });

  it("n'exclut pas une vente sans impact", () => {
    const m = { ...emptyMetrics(), dev_sold_pct: 90, dev_sell_drop_pct: 12 };
    expect(judgeCriterion("dev_sell", m, extra, defaultConfig)).toBeNull();
  });

  it("garde le coin avec le tag CTO si la reprise est officielle et le prix reparti", () => {
    const m = { ...emptyMetrics(), dev_sold_pct: 95, dev_sell_drop_pct: 70, cto_official: true, cto_recovery_multiple: 3 };
    expect(isCto(m, defaultConfig)).toBe(true);
    expect(judgeCriterion("dev_sell", m, extra, defaultConfig)).toBeNull();
  });

  it("exclut malgré une reprise si le CTO n'est pas officiel (réglage par défaut)", () => {
    const m = { ...emptyMetrics(), dev_sold_pct: 95, dev_sell_drop_pct: 70, cto_official: false, cto_recovery_multiple: 5 };
    expect(isCto(m, defaultConfig)).toBe(false);
    expect(judgeCriterion("dev_sell", m, extra, defaultConfig)?.code).toBe("dev_sell");
  });

  it("exclut un CTO officiel qui n'est pas reparti", () => {
    const m = { ...emptyMetrics(), dev_sold_pct: 95, dev_sell_drop_pct: 70, cto_official: true, cto_recovery_multiple: 1.2 };
    expect(isCto(m, defaultConfig)).toBe(false);
  });
});
