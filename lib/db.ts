import postgres from "postgres";
import { parseConfig, type Config } from "./config";

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { __memeJournalSql?: Sql };

/**
 * Client Postgres unique par processus. Pooler Supabase en mode transaction :
 * pas de requêtes préparées, peu de connexions (serverless).
 */
export function db(): Sql {
  if (!globalForDb.__memeJournalSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL manquante");
    globalForDb.__memeJournalSql = postgres(url, {
      prepare: false,
      max: Number(process.env.DB_POOL_MAX ?? 3),
      idle_timeout: 20,
      connect_timeout: 15,
      onnotice: () => {},
      types: {
        numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
        // Les dates (sans heure) restent des chaînes AAAA-MM-JJ : pas de décalage de fuseau.
        date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
      },
    });
  }
  return globalForDb.__memeJournalSql;
}

export async function closeDb() {
  await globalForDb.__memeJournalSql?.end({ timeout: 5 });
  globalForDb.__memeJournalSql = undefined;
}

export async function loadConfig(): Promise<Config> {
  const rows = await db()<{ config: unknown }[]>`select config from settings where id = 1`;
  return parseConfig(rows[0]?.config);
}
