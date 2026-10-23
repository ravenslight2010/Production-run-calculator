/** Bounded, short-lived evidence only. Rejected reads must never become evidence. */
export function createStationActivityCache<T>(
  load: (scope: "live" | "sandbox", date: string, runId: string) => Promise<T>,
  now: () => number = Date.now,
) {
  const entries = new Map<string, { expiresAt: number; rows: T }>();
  let invalidationGeneration = 0;
  return {
    async read(scope: "live" | "sandbox", date: string, runId: string): Promise<T> {
      const key = `${scope}:${date}:${runId}`;
      const startedAt = now();
      const cached = entries.get(key);
      if (cached && cached.expiresAt > startedAt) return cached.rows;
      const generation = invalidationGeneration;
      const rows = await load(scope, date, runId);
      // An accepted event/reset can invalidate while the query is in flight.
      // The original request may finish, but must not repopulate stale evidence.
      if (generation !== invalidationGeneration) return rows;
      entries.set(key, { expiresAt: startedAt + 1_000, rows });
      if (entries.size > 256) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      return rows;
    },
    invalidate(scope: "live" | "sandbox", date: string): void {
      invalidationGeneration += 1;
      const prefix = `${scope}:${date}:`;
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
    clear(): void {
      invalidationGeneration += 1;
      entries.clear();
    },
  };
}
