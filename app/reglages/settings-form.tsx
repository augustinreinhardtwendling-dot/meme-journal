"use client";

import { useActionState } from "react";
import type { Config } from "@/lib/config";
import { SETTINGS_FIELDS } from "@/lib/settings-fields";
import { saveSettings } from "./actions";

export function SettingsForm({ config }: { config: Config }) {
  const [state, action, pending] = useActionState(saveSettings, undefined);
  const values = config as unknown as Record<string, Record<string, number | boolean>>;
  return (
    <form action={action} className="space-y-5">
      {SETTINGS_FIELDS.map((s) => (
        <fieldset key={s.section} className="rounded-2xl border border-line bg-surface p-4">
          <legend className="px-1 text-sm font-medium">{s.title}</legend>
          <div className="space-y-2.5">
            {s.fields.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">{f.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <input
                    name={`${s.section}.${f.key}`}
                    type="number"
                    inputMode="decimal"
                    step={f.step ?? 1}
                    defaultValue={String(values[s.section][f.key])}
                    className="tabular w-24 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-right"
                  />
                  {f.unit && <span className="w-10 text-xs text-muted">{f.unit}</span>}
                </span>
              </label>
            ))}
            {s.section === "stage_b" && (
              <>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">Arrêter l&apos;analyse à la 1re exclusion (économise des crédits)</span>
                  <input type="checkbox" name="stage_b.short_circuit" defaultChecked={config.stage_b.short_circuit} className="h-5 w-5 accent-[var(--accent)]" />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">CTO seulement s&apos;il est validé sur DexScreener</span>
                  <input type="checkbox" name="stage_b.cto_requires_dexscreener" defaultChecked={config.stage_b.cto_requires_dexscreener} className="h-5 w-5 accent-[var(--accent)]" />
                </label>
              </>
            )}
          </div>
        </fieldset>
      ))}
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.message && <p className="text-sm text-accent">{state.message}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2.5 font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}
