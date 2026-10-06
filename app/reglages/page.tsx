import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { logout } from "@/app/connexion/actions";
import { loadConfig } from "@/lib/db";
import { duration, num } from "@/lib/format";
import { monthUsage } from "@/lib/queries";
import { SettingsForm } from "./settings-form";

const HELIUS_MONTHLY = 1_000_000;

export default async function SettingsPage() {
  await connection();
  const [config, usage] = await Promise.all([loadConfig(), monthUsage()]);
  const share = usage.credits / HELIUS_MONTHLY;

  return (
    <AppShell active="/reglages">
      <h1 className="mb-4 text-xl font-semibold">Réglages</h1>

      <section className="mb-5 rounded-2xl border border-line bg-surface p-4 text-sm">
        <h2 className="mb-3 font-medium">Consommation du mois</h2>
        <div className="mb-1 flex justify-between">
          <span className="text-muted">Crédits Helius</span>
          <span className="tabular">{num(usage.credits)} / {num(HELIUS_MONTHLY)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full ${share > 0.8 ? "bg-danger" : share > 0.6 ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
        </div>
        <div className="mt-3 flex justify-between">
          <span className="text-muted">Passages ce mois-ci</span>
          <span className="tabular">{num(usage.runs)}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-muted">Durée cumulée des passages Claude Code</span>
          <span className="tabular">{usage.claude_seconds ? duration(usage.claude_seconds) : "—"}</span>
        </div>
      </section>

      <SettingsForm config={config} />

      <form action={logout} className="mt-6">
        <button className="w-full rounded-lg border border-line px-3 py-2.5 text-sm text-muted">Se déconnecter</button>
      </form>
    </AppShell>
  );
}
