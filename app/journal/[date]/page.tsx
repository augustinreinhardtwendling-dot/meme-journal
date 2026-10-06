import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { JournalView } from "@/components/journal-view";
import { dateLong } from "@/lib/format";
import { runByDate } from "@/lib/queries";

export default async function JournalPage({ params }: PageProps<"/journal/[date]">) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  await connection();
  const run = await runByDate(date);
  return (
    <AppShell active="/">
      {run ? (
        <JournalView run={run} />
      ) : (
        <div className="space-y-3 text-sm">
          <p>Pas de journal pour le <span className="capitalize">{dateLong(date)}</span>.</p>
          <Link className="text-info" href="/archives">Voir les archives</Link>
        </div>
      )}
    </AppShell>
  );
}
