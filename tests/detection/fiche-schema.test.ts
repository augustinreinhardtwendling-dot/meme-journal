import { describe, expect, it } from "vitest";
import { adviceViolations, allText, ficheSchema, watchlistSchema } from "../../lib/claude-schema";

const fiche = {
  mint: "Y9ccqrALa5Yr3Bxzv8NQe37KP1Yy9uTCSJuap4Cpump",
  catalyseur: { identifie: true, type: "tweet", resume: "Un tweet viral d'un compte animalier a lancé le thème.", sources: [{ titre: "Article", url: "https://example.com/a" }] },
  metas: ["animal-chien"],
  dynamique: { vitesse_bonding: "46 min", profil_acheteurs: "2 038 holders", apres_migration: "rebond", role_dev: "absent", resume: "Montée puis repli." },
  pourquoi: "Les gens ont acheté parce que le thème était drôle et que la distribution était propre, sans bundle.",
  peut_remarcher: { verdict: "incertain", confiance: "faible", raisonnement: "La meta animal est très copiée cette semaine." },
  faits: [{ texte: "Le tweet a dépassé 1 million de vues.", sources: ["https://example.com/b"] }],
  hypotheses: ["Le dev pourrait être lié au compte qui a tweeté."],
};

describe("format des fiches", () => {
  it("accepte une fiche complète", () => {
    expect(ficheSchema.safeParse(fiche).success).toBe(true);
  });
  it("refuse un fait sans source", () => {
    const bad = { ...fiche, faits: [{ texte: "Fait sans preuve.", sources: [] }] };
    expect(ficheSchema.safeParse(bad).success).toBe(false);
  });
  it("refuse un verdict hors liste", () => {
    const bad = { ...fiche, peut_remarcher: { ...fiche.peut_remarcher, verdict: "peut-être" } };
    expect(ficheSchema.safeParse(bad).success).toBe(false);
  });
  it("refuse une source qui n'est pas une URL web", () => {
    const bad = { ...fiche, catalyseur: { ...fiche.catalyseur, sources: [{ url: "ftp://exemple" }] } };
    expect(ficheSchema.safeParse(bad).success).toBe(false);
  });
});

describe("conseil d'investissement interdit", () => {
  it("laisse passer une explication", () => {
    expect(adviceViolations(allText(fiche))).toEqual([]);
    expect(adviceViolations("Les gens ont acheté après le tweet ; beaucoup ont vendu le lendemain.")).toEqual([]);
  });
  it.each(["Achetez avant qu'il ne soit trop tard", "bon point d'entrée sous 50 k$", "objectif de prix 1 M$", "mettez un stop loss", "c'est le moment à acheter"])(
    "rejette « %s »",
    (t) => expect(adviceViolations(t).length).toBeGreaterThan(0),
  );
});

describe("« À surveiller »", () => {
  it("accepte une liste de narratifs sourcés", () => {
    const w = {
      resume: "Semaine dominée par les metas animales, IA en recul.",
      narratifs: [{ titre: "OP_CAT", metas: ["crypto-meta"], pourquoi: "Trois coins OP_CAT ont bondé le même jour après une actualité Bitcoin.", evenements: [], confiance: "moyen", sources: ["https://example.com"] }],
      recap_hebdo: null,
    };
    expect(watchlistSchema.safeParse(w).success).toBe(true);
  });
});
