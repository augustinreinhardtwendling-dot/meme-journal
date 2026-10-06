/** Applique `fn` à chaque élément avec au plus `limit` appels en parallèle (ordre conservé). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const started = Date.now();
export function log(...args: unknown[]) {
  const s = ((Date.now() - started) / 1000).toFixed(0).padStart(4);
  console.log(`[${s}s]`, ...args);
}
