import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { BrainGraph } from "@/components/brain-graph";
import { brainData } from "@/lib/queries";

export default async function BrainPage() {
  await connection();
  const { coins, metas, links } = await brainData();
  const semantic = links.filter((l) => l.source === "claude").length;

  return (
    <AppShell active="/cerveau" wide>
      <h1 className="text-xl font-semibold">Second cerveau</h1>
      <p className="mb-4 mt-1 text-xs leading-relaxed text-muted">
        {coins.length} coins retenus, reliés à leurs metas et entre eux : {links.length} liens, dont {semantic} analysés par Claude
        (même catalyseur, même écosystème, même narratif…) et {links.length - semantic} calculés (même équipe, copie, même vague).
      </p>
      {coins.length ? (
        <BrainGraph coins={coins} metas={metas} links={links} />
      ) : (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">Aucun coin retenu pour l&apos;instant.</p>
      )}
    </AppShell>
  );
}
