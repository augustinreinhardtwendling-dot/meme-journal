import { AppShell } from "@/components/app-shell";

export default function TrendsPage() {
  return (
    <AppShell active="/tendances">
      <h1 className="mb-3 text-xl font-semibold">Tendances</h1>
      <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
        Les graphiques des metas (7 et 30 jours) et les taux de réussite arriveront avec le classement par Claude Code
        (étape 4). Les données des journaux sont déjà conservées pour les calculer.
      </p>
    </AppShell>
  );
}
