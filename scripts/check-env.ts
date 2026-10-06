// Vérifie les variables d'environnement et les connexions, sans jamais afficher de secret.
import postgres from "postgres";

function describeDbUrl(raw: string | undefined): string {
  if (!raw) return "ABSENTE";
  try {
    const u = new URL(raw);
    const issues: string[] = [];
    if (raw.includes("[YOUR-PASSWORD]")) issues.push("le mot de passe n'a pas été remplacé");
    if (!u.hostname.includes("pooler.supabase.com")) issues.push("ce n'est pas l'URI du pooler");
    if (u.port !== "6543") issues.push(`port ${u.port || "?"} au lieu de 6543 (Transaction pooler)`);
    return `hôte ${u.hostname}, port ${u.port}, utilisateur ${u.username.split(".")[0]}.***` +
      (issues.length ? ` ⚠ ${issues.join(" ; ")}` : " ✓ format correct");
  } catch {
    return "illisible (vérifie qu'il n'y a ni espace ni guillemet, et que les caractères spéciaux du mot de passe sont encodés)";
  }
}

async function checkDb() {
  const url = process.env.DATABASE_URL;
  console.log("DATABASE_URL :", describeDbUrl(url));
  if (!url) return;
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    const [row] = await sql`select current_setting('server_version') as v, now() as now`;
    console.log(`  → connexion OK (Postgres ${row.v})`);
  } catch (e) {
    console.log(`  → échec de connexion : ${(e as Error).message}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function checkHelius() {
  const key = process.env.HELIUS_API_KEY;
  console.log("HELIUS_API_KEY :", key ? `présente (${key.length} caractères)` : "ABSENTE");
  if (!key) return;
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: number; error?: { message: string } };
  if (res.ok && body.result) console.log(`  → Helius OK (slot ${body.result})`);
  else console.log(`  → échec Helius : HTTP ${res.status} ${body.error?.message ?? ""}`);
}

await checkDb();
await checkHelius();
