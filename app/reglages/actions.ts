"use server";

import { revalidatePath } from "next/cache";
import { configSchema, defaultConfig } from "@/lib/config";
import { db, loadConfig } from "@/lib/db";
import { SETTINGS_FIELDS } from "@/lib/settings-fields";

export async function saveSettings(_prev: { message?: string; error?: string } | undefined, formData: FormData) {
  const current = (await loadConfig()) as unknown as Record<string, Record<string, unknown>>;
  const next: Record<string, Record<string, unknown>> = structuredClone(current);
  for (const s of SETTINGS_FIELDS) {
    for (const f of s.fields) {
      const raw = formData.get(`${s.section}.${f.key}`);
      if (raw == null || raw === "") continue;
      const n = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n)) return { error: `Valeur invalide pour « ${f.label} ».` };
      next[s.section][f.key] = n;
    }
  }
  next.stage_b.short_circuit = formData.get("stage_b.short_circuit") === "on";
  next.stage_b.cto_requires_dexscreener = formData.get("stage_b.cto_requires_dexscreener") === "on";
  const parsed = configSchema.safeParse(next);
  if (!parsed.success) return { error: `Réglages refusés : ${parsed.error.issues[0]?.message ?? "valeur hors limites"}` };
  await db()`update settings set config = ${db().json(parsed.data as never)}, updated_at = now() where id = 1`;
  revalidatePath("/reglages");
  return { message: "Réglages enregistrés. Ils s'appliqueront au prochain passage." };
}

export async function resetSettings() {
  await db()`update settings set config = ${db().json(defaultConfig as never)}, updated_at = now() where id = 1`;
  revalidatePath("/reglages");
}
