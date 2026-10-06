import type { Config } from "./config";

/** Date du jour (UTC) au format AAAA-MM-JJ. */
export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Fenêtre de bonding couverte par le journal du jour J.
 * Ancrée sur une heure fixe pour que deux journaux consécutifs se suivent sans trou ni doublon,
 * même si le cron GitHub part en retard.
 */
export function journalWindow(journalDate: string, cfg: Config) {
  const [y, m, d] = journalDate.split("-").map(Number);
  const anchor = Date.UTC(y, m - 1, d, cfg.window.anchor_utc_hour);
  return {
    start: new Date(anchor - cfg.window.start_hours_ago * 3600_000),
    end: new Date(anchor - cfg.window.end_hours_ago * 3600_000),
  };
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}
