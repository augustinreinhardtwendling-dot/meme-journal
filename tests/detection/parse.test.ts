import { describe, expect, it } from "vitest";
import { extractCurveTrades, parseMigration, tokenDeltasByOwner } from "../../lib/onchain/parse";
import { PUMP_MIGRATION_AUTHORITY, PUMP_PROGRAM, WSOL_MINT } from "../../lib/solana";
import { tx } from "./helpers";

const MINT = "MINT";
const CURVE = "CURVE";

describe("lecture des transactions", () => {
  it("calcule les variations de tokens par propriétaire, comptes créés inclus", () => {
    const t = tx({
      keys: ["BUYER", CURVE, "ataCurve", "ataBuyer"],
      tokens: [
        { idx: 2, mint: MINT, owner: CURVE, pre: 800_000_000, post: 790_000_000 },
        { idx: 3, mint: MINT, owner: "BUYER", post: 10_000_000 },
      ],
    });
    const d = tokenDeltasByOwner(t, MINT);
    expect(d.get(CURVE)).toBe(-10_000_000);
    expect(d.get("BUYER")).toBe(10_000_000);
  });

  it("répartit la quote entre plusieurs acheteurs d'une même tx (bundle multi-signataires)", () => {
    const t = tx({
      keys: ["B1", CURVE, "a1", "a2", "a3", "B2"],
      sol: [[10, 7], [50, 54], [0, 0], [0, 0], [0, 0], [10, 9]],
      tokens: [
        { idx: 2, mint: MINT, owner: CURVE, pre: 800_000_000, post: 770_000_000 },
        { idx: 3, mint: MINT, owner: "B1", post: 20_000_000 },
        { idx: 4, mint: MINT, owner: "B2", post: 10_000_000 },
      ],
    });
    const trades = extractCurveTrades(t, { mint: MINT, bondingCurve: CURVE, quoteMint: WSOL_MINT });
    expect(trades).toHaveLength(2);
    const b1 = trades.find((x) => x.wallet === "B1")!;
    expect(b1.side).toBe("buy");
    expect(b1.quote).toBeCloseTo((4 * 2) / 3);
  });

  const migrationLogs = [`Program ${PUMP_PROGRAM} invoke [1]`, "Program log: Instruction: MigrateV2", `Program ${PUMP_PROGRAM} success`];
  const migrationIx = [{ programId: PUMP_PROGRAM, accounts: ["GLOBAL", PUMP_MIGRATION_AUTHORITY, MINT, WSOL_MINT, CURVE] }];

  it("reconnaît une vraie migration et lit la pool", () => {
    const t = tx({
      keys: ["PAYER", CURVE, "ataCurve", "POOL", "poolBase", "poolQuote"],
      tokens: [
        { idx: 2, mint: MINT, owner: CURVE, pre: 206_900_000, post: 0 },
        { idx: 4, mint: MINT, owner: "POOL", post: 206_900_000 },
        { idx: 5, mint: WSOL_MINT, owner: "POOL", post: 67.4 },
      ],
      logs: migrationLogs,
      instructions: migrationIx,
    });
    const m = parseMigration(t)!;
    expect(m).not.toBeNull();
    expect(m.mint).toBe(MINT);
    expect(m.bondingCurve).toBe(CURVE);
    expect(m.pool).toBe("POOL");
    expect(m.poolQuote).toBeCloseTo(67.4);
    expect(m.quoteMint).toBe(WSOL_MINT);
  });

  it("ignore un appel à vide sur une curve déjà migrée", () => {
    const t = tx({
      keys: ["BOT"],
      logs: [`Program ${PUMP_PROGRAM} invoke [1]`, "Program log: Instruction: Migrate", "Program log: Bonding curve already migrated", `Program ${PUMP_PROGRAM} success`],
      instructions: migrationIx,
    });
    expect(parseMigration(t)).toBeNull();
  });
});
