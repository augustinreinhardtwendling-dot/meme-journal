// Dernière étape du passage : journal marqué « publié » et résumé envoyé sur Telegram.
// Usage : tsx pipeline/publish.ts [--date AAAA-MM-JJ] [--dry]
import { parseArgs } from "node:util";
import { closeDb, db } from "../lib/db";
import { dateLong, num, usd } from "../lib/format";
import { todayUtc } from "../lib/window";
import { escapeHtml, resolveChatId, sendTelegram, telegramToken } from "./telegram";

const { values: args } = parseArgs({ options: { date: { type: "string" }, dry: { type: "boolean", default: false } } });
const date = args.date ?? (process.env.JOURNAL_DATE || todayUtc());
const appUrl = (process.env.APP_URL ?? "https://meme-journal.vercel.app").replace(/\/$/, "");
const sql = db();

try {
  const [run] = await sql<{ id: number; counts: Record<string, number> | null; summary: { dominant_meta?: string | null } | null; sol_price_usd: number | null; claude_status: string | null; telegram_sent_at: Date | null }[]>`
    select id, counts, summary, sol_price_usd, claude_status, telegram_sent_at from runs
    where journal_date = ${date} and status in ('collected', 'published') order by (kind = 'daily') desc, started_at desc limit 1`;
  if (!run) throw new Error(`pas de journal pour le ${date}`);
  if (!args.dry) await sql`update runs set status = 'published', finished_at = coalesce(finished_at, now()) where id = ${run.id}`;

  const retained = await sql<{ symbol: string | null; score: number | null; tags: string[]; ath: number | null; mig: number | null; verdict: string | null }[]>`
    select c.symbol, e.score, e.tags, e.ath_mcap_usd as ath, c.migration_mcap_usd as mig, f.content->'peut_remarcher'->>'verdict' as verdict
    from evaluations e join coins c on c.mint = e.mint left join fiches f on f.mint = e.mint and f.status = 'done'
    where e.run_id = ${run.id} and e.status = 'retained' order by e.score desc nulls last limit 6`;
  const [watch] = await sql<{ content: { narratifs?: { titre: string; confiance: string }[] } }[]>`
    select content from insights where kind = 'watchlist' and journal_date = ${date}`;

  const c = run.counts ?? {};
  const lines = [
    `<b>📓 Meme Journal — ${escapeHtml(dateLong(date))}</b>`,
    `SOL ${usd(run.sol_price_usd)}`,
    `${num(c.bonded)} bondés → ${num(c.stage_a)} encore vivants → <b>${num(c.retained)} retenus</b>${c.runners ? ` (${c.runners} runner${c.runners > 1 ? "s" : ""})` : ""}`,
  ];
  if (run.summary?.dominant_meta) lines.push(`Meta dominante : ${escapeHtml(run.summary.dominant_meta)}`);
  if (retained.length) {
    lines.push("", "<b>Retenus</b>");
    for (const r of retained) {
      const mult = r.ath && r.mig ? ` · ATH ×${Math.round(r.ath / r.mig)}` : "";
      const verdict = r.verdict ? ` · remarcher : ${r.verdict}` : "";
      lines.push(`• $${escapeHtml(r.symbol ?? "?")} — score ${r.score ?? "—"}${mult}${verdict}`);
    }
  }
  const narratifs = watch?.content?.narratifs ?? [];
  if (narratifs.length) {
    lines.push("", "<b>À surveiller</b>");
    for (const n of narratifs.slice(0, 3)) lines.push(`• ${escapeHtml(n.titre)} (confiance ${n.confiance})`);
  }
  if (["pending", "failed", "quota", null].includes(run.claude_status) && retained.length) {
    lines.push("", run.claude_status === "quota" ? "⏳ Fiches reportées (quota Claude atteint)." : "⏳ Fiches en attente, réessai au prochain passage.");
  }
  lines.push("", `👉 <a href="${appUrl}/journal/${date}">Ouvrir le journal</a>`);
  const html = lines.join("\n");

  const token = telegramToken();
  if (args.dry || !token) {
    console.log(args.dry ? "Message (aperçu) :" : "Telegram non configuré (TELEGRAM_BOT_TOKEN absent). Message :");
    console.log(html);
  } else {
    const chatId = await resolveChatId(sql, token);
    if (!chatId) console.log("Telegram : aucune conversation trouvée. Envoie /start à ton bot puis relance.");
    else {
      await sendTelegram(token, chatId, html);
      await sql`update runs set telegram_sent_at = now() where id = ${run.id}`;
      console.log("Telegram : résumé envoyé.");
    }
  }
  console.log(`Journal du ${date} publié.`);
} catch (e) {
  console.log(`publication : ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
