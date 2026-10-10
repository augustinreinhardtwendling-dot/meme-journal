import type { FicheContent } from "@/lib/queries";

const APRES_MIGRATION: Record<string, string> = {
  montee_progressive: "montée progressive",
  pump_and_dump: "pump and dump",
  plateau: "plateau",
  rebond: "rebond",
  declin_lent: "déclin lent",
};
const ROLE_DEV: Record<string, string> = { actif: "dev actif", absent: "dev absent", cto: "repris par la communauté (CTO)", inconnu: "rôle du dev inconnu" };
const CONFIANCE: Record<string, string> = { faible: "faible", moyen: "moyenne", eleve: "élevée" };
const VERDICT: Record<string, { label: string; tone: string }> = {
  oui: { label: "Oui", tone: "text-accent" },
  non: { label: "Non", tone: "text-danger" },
  incertain: { label: "Incertain", tone: "text-warn" },
};

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Verdict « peut remarcher ? », toujours visible sur la carte. */
export function RerunVerdict({ fiche }: { fiche: FicheContent }) {
  const v = VERDICT[fiche.peut_remarcher.verdict] ?? VERDICT.incertain;
  return (
    <div className="mt-3 rounded-xl border border-line p-3 text-sm">
      <div>
        <span className="font-medium">Un coin similaire peut remarcher ? </span>
        <span className={`font-semibold ${v.tone}`}>{v.label}</span>
        <span className="text-muted"> · confiance {CONFIANCE[fiche.peut_remarcher.confiance] ?? fiche.peut_remarcher.confiance}</span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{fiche.peut_remarcher.raisonnement}</p>
    </div>
  );
}

/** Fiche dépliable : catalyseur, pourquoi, dynamique, faits sourcés et hypothèses. */
export function FicheView({ fiche }: { fiche: FicheContent }) {
  const c = fiche.catalyseur;
  return (
    <details className="mt-3">
      <summary className="text-sm font-medium text-accent">Lire la fiche</summary>
      <div className="mt-2 space-y-4 text-sm leading-relaxed">
        <section>
          <h4 className="font-medium">Catalyseur {!c.identifie && <span className="text-xs font-normal text-warn">· non identifié</span>}</h4>
          <p className="text-muted">{c.resume}</p>
          {c.sources.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
              {c.sources.map((s) => (
                <li key={s.url}>
                  <a className="text-info" href={s.url} target="_blank" rel="noreferrer">
                    {s.titre ? s.titre.slice(0, 60) : host(s.url)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4 className="font-medium">Pourquoi les gens ont acheté</h4>
          <p className="text-muted">{fiche.pourquoi}</p>
        </section>
        <section>
          <h4 className="font-medium">Dynamique</h4>
          <p className="text-[12px] text-muted">
            {APRES_MIGRATION[fiche.dynamique.apres_migration] ?? fiche.dynamique.apres_migration} · {ROLE_DEV[fiche.dynamique.role_dev] ?? fiche.dynamique.role_dev}
          </p>
          <p className="text-muted">{fiche.dynamique.resume}</p>
          <p className="mt-1 text-muted">{fiche.dynamique.vitesse_bonding}</p>
          <p className="mt-1 text-muted">{fiche.dynamique.profil_acheteurs}</p>
        </section>
        {fiche.faits.length > 0 && (
          <section>
            <h4 className="font-medium">Faits vérifiés</h4>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              {fiche.faits.map((f, i) => (
                <li key={i}>
                  {f.texte}{" "}
                  {f.sources.map((u) => (
                    <a key={u} className="text-[12px] text-info" href={u} target="_blank" rel="noreferrer">
                      [{host(u)}]{" "}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}
        {fiche.hypotheses.length > 0 && (
          <section>
            <h4 className="font-medium">Hypothèses (non vérifiées)</h4>
            <ul className="list-disc space-y-1 pl-5 italic text-muted">
              {fiche.hypotheses.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </details>
  );
}
