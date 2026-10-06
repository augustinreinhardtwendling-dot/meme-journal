// Applique, dans l'ordre, les fichiers db/migrations/*.sql pas encore appliqués.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const dir = join(import.meta.dirname, "migrations");
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });

try {
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table _migrations enable row level security`;
  const done = new Set((await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const body = readFileSync(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _migrations (name) values (${file})`;
    });
    console.log(`appliquée : ${file}`);
  }
  console.log("schéma à jour");
} finally {
  await sql.end({ timeout: 5 });
}
