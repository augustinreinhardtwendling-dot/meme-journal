// Petit utilitaire HTTP : file d'attente à débit limité + relances.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RateLimitedClient {
  private chain: Promise<void> = Promise.resolve();
  private last = 0;
  calls = 0;
  rateLimited = 0;

  /**
   * `minIntervalMs` : délai minimal entre deux requêtes.
   * `penaltyMs` : pause après un refus 429 (les limites « par minute » demandent souvent d'attendre la minute suivante).
   */
  constructor(readonly name: string, private readonly minIntervalMs: number, private readonly penaltyMs = 2000) {}

  private slot(): Promise<void> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
    });
    this.chain = next.catch(() => {});
    return next;
  }

  async getJson<T>(url: string, opts: { allow404?: boolean; headers?: Record<string, string> } = {}): Promise<T | null> {
    let lastError = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      await this.slot();
      this.calls++;
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json", ...opts.headers },
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 404 && opts.allow404) return null;
        if (res.status === 429) {
          lastError = "HTTP 429";
          this.rateLimited++;
          // Toute la file attend : inutile que les requêtes suivantes se fassent refuser aussi.
          const pause = this.penaltyMs * (attempt + 1);
          this.last = Date.now() + pause;
          await sleep(pause);
          continue;
        }
        if (res.status >= 500) {
          lastError = `HTTP ${res.status}`;
          await sleep(Math.min(60_000, 2000 * 2 ** attempt));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (e) {
        lastError = (e as Error).message;
        if (lastError.startsWith("HTTP 4")) break;
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`${this.name} ${url} : ${lastError}`);
  }
}
