import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { JournalView } from "@/components/journal-view";
import { latestRun } from "@/lib/queries";

export default async function Home() {
  await connection();
  const run = await latestRun();
  return (
    <AppShell active="/">
      {run ? (
        <JournalView run={run} />
      ) : (
        <p className="text-sm text-muted">Aucun journal pour l&apos;instant : le premier passage n&apos;a pas encore tourné.</p>
      )}
    </AppShell>
  );
}
