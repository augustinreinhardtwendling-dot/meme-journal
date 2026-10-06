// Affiche les coins analysés à l'étape B d'un journal (calibrage).
import { closeDb, db } from "../lib/db";
const date = process.argv[2];
const rows = await db()`
  select c.symbol, c.name, c.mint, c.bonding_seconds, c.prebond_tx_count, round(c.migration_mcap_usd) as mig, round(e.mcap_usd) as mcap,
    round(e.volume_24h_usd) as vol, e.holders, e.top10_pct, e.bundle_pct, e.snipers_pct, e.insiders_pct, e.unique_buyers_prebond,
    e.wash_tx_per_wallet, e.wash_roundtrip_share, e.txns_24h, e.buyers_24h, e.sellers_24h, e.status, e.reasons, e.metrics, e.credits_used
  from evaluations e join runs r on r.id = e.run_id join coins c on c.mint = e.mint
  where r.journal_date = ${date} and e.stage = 'B' and e.status <> 'not_analyzed' order by e.mcap_usd desc`;
for (const r of rows) {
  console.log(`\n$${r.symbol} (${r.name}) ${r.mint}\n  ${r.status} — ${r.reasons.map((x: { detail: string }) => x.detail).join(" | ")}`);
  console.log(`  mig ${r.mig} $ → mcap ${r.mcap} $, vol ${r.vol} $, holders ${r.holders}, bonding ${r.bonding_seconds}s / ${r.prebond_tx_count} tx, crédits ${r.credits_used}`);
  console.log(`  top10 ${r.top10_pct} bundle ${r.bundle_pct} snipers ${r.snipers_pct} insiders ${r.insiders_pct} uniqBuyers ${r.unique_buyers_prebond}`);
  console.log(`  wash: tx/wallet ${r.wash_tx_per_wallet}, boucle ${r.wash_roundtrip_share}, tx24 ${r.txns_24h}, buyers ${r.buyers_24h}, sellers ${r.sellers_24h}`);
  console.log(`  détails: ${JSON.stringify(r.metrics).slice(0, 400)}`);
}
await closeDb();
