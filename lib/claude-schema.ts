// Formats imposés aux sorties de Claude Code, et règles éditoriales vérifiées automatiquement.
import { z } from "zod";

const url = z.string().url().refine((u) => /^https?:\/\//.test(u), "URL http(s) attendue");
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug en minuscules avec tirets");

export const nouvelleMetaSchema = z.object({
  slug,
  label: z.string().min(2).max(40),
  parent: slug.nullable().optional(),
  kind: z.enum(["theme", "mecanique"]).default("theme"),
  description: z.string().max(200).optional(),
});

export const ficheSchema = z.object({
  mint: z.string().min(32).max(44),
  catalyseur: z.object({
    identifie: z.boolean(),
    type: z.enum(["actualite", "tweet", "celebrite", "video", "evenement", "autre_coin", "communaute", "inconnu"]),
    resume: z.string().min(10).max(700),
    sources: z.array(z.object({ titre: z.string().max(200).optional(), url })).max(8),
  }),
  metas: z.array(slug).min(1).max(5),
  dynamique: z.object({
    vitesse_bonding: z.string().max(300),
    profil_acheteurs: z.string().max(400),
    apres_migration: z.enum(["montee_progressive", "pump_and_dump", "plateau", "rebond", "declin_lent"]),
    role_dev: z.enum(["actif", "absent", "cto", "inconnu"]),
    resume: z.string().max(600),
  }),
  pourquoi: z.string().min(40).max(900),
  peut_remarcher: z.object({
    verdict: z.enum(["oui", "non", "incertain"]),
    confiance: z.enum(["faible", "moyen", "eleve"]),
    raisonnement: z.string().min(20).max(700),
  }),
  faits: z.array(z.object({ texte: z.string().min(5).max(400), sources: z.array(url).min(1) })).max(10),
  hypotheses: z.array(z.string().min(5).max(400)).max(8),
});
export type Fiche = z.infer<typeof ficheSchema>;

export const fichesOutputSchema = z.object({
  fiches: z.array(z.unknown()),
  nouvelles_metas: z.array(z.unknown()).optional(),
});

export const classementOutputSchema = z.object({
  classement: z.record(z.string(), z.array(z.string())),
  nouvelles_metas: z.array(z.unknown()).optional(),
});

export const watchlistSchema = z.object({
  resume: z.string().min(20).max(1200),
  narratifs: z
    .array(
      z.object({
        titre: z.string().min(3).max(120),
        metas: z.array(slug).max(5),
        pourquoi: z.string().min(20).max(900),
        evenements: z
          .array(z.object({ date: z.string().max(40).optional(), titre: z.string().max(200), url: url.optional() }))
          .max(6),
        confiance: z.enum(["faible", "moyen", "eleve"]),
        sources: z.array(url).max(8),
      }),
    )
    .max(8),
  recap_hebdo: z
    .object({
      periode: z.string().max(80),
      faits_marquants: z.array(z.string().max(400)).max(8),
      metas_gagnantes: z.array(z.string().max(300)).max(6),
      metas_en_baisse: z.array(z.string().max(300)).max(6),
      coins_marquants: z.array(z.object({ symbol: z.string().max(30), pourquoi: z.string().max(400) })).max(8),
      lecons: z.array(z.string().max(400)).max(6),
    })
    .nullable()
    .optional(),
});
export type Watchlist = z.infer<typeof watchlistSchema>;

/**
 * Formulations de conseil d'investissement, interdites dans les fiches.
 * (Le descriptif « les gens ont acheté » reste autorisé : on vise l'impératif et le jargon de trading.)
 */
const ADVICE = [
  /\bachet(ez|e maintenant|er maintenant)\b/i,
  /\bvend(ez|s maintenant|re maintenant)\b/i,
  // Pas de \b devant « à » : en JavaScript, \b ne reconnaît pas les lettres accentuées.
  /(?:^|[\s,;:(])(à|a) (acheter|vendre)\b/i,
  /\b(moment|temps|heure) d['’](acheter|vendre|entrer)\b/i,
  /\bpoint d['’]entr[ée]e\b/i,
  /\bprise de (profit|bénéfices?)\b/i,
  /\bstop[- ]?loss\b/i,
  /\bobjectif de (prix|cours)\b/i,
  /\bprice target\b/i,
  /\b(buy|sell) (now|the dip)\b/i,
  /\bne ratez pas\b/i,
  /\b(x10|x100|100x|1000x) (garanti|assur)/i,
];

export function adviceViolations(text: string): string[] {
  return ADVICE.filter((re) => re.test(text)).map((re) => re.source);
}

/** Texte complet d'un objet (pour vérifier les règles éditoriales). */
export function allText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(allText).join(" ");
  if (v && typeof v === "object") return Object.values(v).map(allText).join(" ");
  return "";
}
