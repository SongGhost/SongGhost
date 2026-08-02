const DEFAULT_CONCURRENCY = 10;

/**
 * Runs `resolver` over `items` with a bounded worker pool.
 *
 * Resolution is the expensive step in every catalog build (a YouTube search plus
 * embeddability checks per track), so it has to be parallel. Results are written
 * into indexed slots rather than pushed, which keeps the caller's ordering intact
 * — Artist Radio orders its pool *before* resolving and must not lose that order.
 *
 * `null` results are dropped. When `limit` is set, workers stop claiming new items
 * once enough have resolved, so an oversized candidate list costs nothing extra.
 */
export async function resolveInPool<TIn, TOut>(
  items: readonly TIn[],
  resolver: (item: TIn, index: number) => Promise<TOut | null>,
  options?: { concurrency?: number; limit?: number },
): Promise<TOut[]> {
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY);
  const limit = options?.limit;
  const slots = new Array<TOut | null>(items.length).fill(null);

  let cursor = 0;
  let resolved = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      if (limit !== undefined && resolved >= limit) return;

      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;

      try {
        const result = await resolver(item, index);
        if (result !== null) {
          slots[index] = result;
          resolved += 1;
        }
      } catch (error) {
        console.warn("[resolve-pool] Resolver failed:", error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  const out = slots.filter((value): value is TOut => value !== null);
  return limit !== undefined ? out.slice(0, limit) : out;
}
